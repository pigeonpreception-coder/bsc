"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function addTeamMember(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }

  const email = String(formData.get("email") ?? "").trim();
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "staff");
  const positionId = String(formData.get("position_id") ?? "").trim();
  let department = String(formData.get("department") ?? "").trim();

  if (!email || !department) {
    throw new Error("Email and department are required");
  }
  if (!["manager", "staff", "viewer"].includes(role)) {
    throw new Error("Invalid role");
  }

  const admin = createAdminClient();

  // org_positions.office_department_name is the org chart's real
  // department — when a position is chosen, it overrides whatever was
  // separately typed/selected above rather than letting the two disagree
  // (see the current-state assessment's duplicate-department finding).
  if (positionId) {
    const { data: position } = await admin
      .from("org_positions")
      .select("office_department_name, section_name")
      .eq("id", positionId)
      .eq("tenant_id", user.tenant_id)
      .maybeSingle();
    if (position) department = position.section_name || position.office_department_name;
  }

  const origin = (await headers()).get("origin");

  // inviteUserByEmail doesn't support PKCE (the invite is opened by the
  // invitee, not the admin who sent it, so there's no shared code_verifier
  // between the two) — it delivers tokens as a URL hash fragment instead,
  // which the browser client auto-detects on load. Redirect straight to the
  // set-password page rather than through the /auth/callback ?code= route
  // the password-reset flow uses.
  const { data: authUser, error: authError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${origin}/auth/reset-password`,
  });
  if (authError) throw authError;

  const { error: profileError } = await admin.from("users").insert({
    id: authUser.user.id,
    email,
    full_name: fullName || null,
    role,
    tenant_id: user.tenant_id,
    department,
  });
  if (profileError) {
    // Don't leave an orphaned login behind — that email becomes permanently
    // unusable for future signups otherwise, with no UI to find or fix it.
    await admin.auth.admin.deleteUser(authUser.user.id);
    throw profileError;
  }

  await admin.from("audit_log").insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "invite_team_member",
    resource_type: "user",
    resource_id: authUser.user.id,
    old_value: null,
    new_value: { email, full_name: fullName || null, role, department },
  });

  if (positionId) {
    const { data: linked, error: linkError } = await admin
      .from("org_positions")
      .update({ user_id: authUser.user.id })
      .eq("id", positionId)
      .eq("tenant_id", user.tenant_id)
      .is("user_id", null)
      .select("id");
    if (linkError) throw linkError;
    if (!linked || linked.length === 0) {
      throw new Error(
        "The team member was created, but that position was just taken by someone else — link them to a different position from the Team page.",
      );
    }
  }

  revalidatePath("/dashboard/team");
}

// Links (or unlinks, when positionId is empty) an existing team member to an
// org position. Clears any other position this user currently holds first,
// so a user is never linked to more than one position at a time.
export async function assignPosition(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }

  const targetUserId = String(formData.get("user_id") ?? "").trim();
  const positionId = String(formData.get("position_id") ?? "").trim();
  if (!targetUserId) throw new Error("Missing team member");

  const admin = createAdminClient();

  let department: string | null = null;
  if (positionId) {
    const { data: targetPosition } = await admin
      .from("org_positions")
      .select("user_id, office_department_name, section_name")
      .eq("id", positionId)
      .eq("tenant_id", user.tenant_id)
      .single();

    if (targetPosition?.user_id && targetPosition.user_id !== targetUserId) {
      throw new Error("That position is already held by someone else — unassign them first.");
    }
    department = targetPosition?.section_name || targetPosition?.office_department_name || null;
  }

  const { error: clearError } = await admin
    .from("org_positions")
    .update({ user_id: null })
    .eq("tenant_id", user.tenant_id)
    .eq("user_id", targetUserId);
  if (clearError) throw clearError;

  if (positionId) {
    const { error: assignError } = await admin
      .from("org_positions")
      .update({ user_id: targetUserId })
      .eq("id", positionId)
      .eq("tenant_id", user.tenant_id);
    if (assignError) throw assignError;

    // Keep users.department in sync with the org chart going forward.
    // Only touched on assignment, not on unassignment, so someone between
    // positions still shows a sensible last-known label instead of blank.
    if (department) {
      await admin.from("users").update({ department }).eq("id", targetUserId).eq("tenant_id", user.tenant_id);
    }
  }

  revalidatePath("/dashboard/team");
}

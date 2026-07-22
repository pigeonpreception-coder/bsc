"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

export async function addTeamMember(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const role = String(formData.get("role") ?? "staff");
  const department = String(formData.get("department") ?? "").trim();
  const positionId = String(formData.get("position_id") ?? "").trim();

  if (!email || !password || !department) {
    throw new Error("Email, password, and department are required");
  }
  if (!["manager", "staff", "viewer"].includes(role)) {
    throw new Error("Invalid role");
  }

  const admin = createAdminClient();

  const { data: authUser, error: authError } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
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

  if (positionId) {
    const { data: targetPosition } = await admin
      .from("org_positions")
      .select("user_id")
      .eq("id", positionId)
      .eq("tenant_id", user.tenant_id)
      .single();

    if (targetPosition?.user_id && targetPosition.user_id !== targetUserId) {
      throw new Error("That position is already held by someone else — unassign them first.");
    }
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
  }

  revalidatePath("/dashboard/team");
}

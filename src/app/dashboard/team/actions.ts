"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { inviteUserAccount, type UserRole } from "@/lib/user-invite";
import { createNotification } from "@/lib/notifications";
import { writeAuditLog } from "@/lib/audit-log";

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

  const invited = await inviteUserAccount({
    email,
    fullName: fullName || null,
    role: role as UserRole,
    tenantId: user.tenant_id,
    department,
    origin,
  });

  await writeAuditLog(admin, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "invite_team_member",
    resource_type: "user",
    resource_id: invited.id,
    old_value: null,
    new_value: { email, full_name: fullName || null, role, department },
  });

  if (positionId) {
    const { data: linked, error: linkError } = await admin
      .from("org_positions")
      .update({ user_id: invited.id })
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

const STATUS_MESSAGES: Record<"suspended" | "deactivated", string> = {
  suspended: "Your account has been suspended. Contact your administrator for details.",
  deactivated: "Your account has been deactivated. Contact your administrator for details.",
};

// A company_admin can only manage status for the same role set they can
// already invite/assign — manager/staff/viewer. Deliberately cannot touch
// another company_admin (super_admin-only, via admin/actions.ts) or
// themselves (self-lockout).
export async function setTeamMemberStatus(userId: string, status: "active" | "suspended" | "deactivated") {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) {
    throw new Error("Not authorized");
  }
  if (userId === user.id) throw new Error("You can't change your own account status.");

  const admin = createAdminClient();

  const { data: target } = await admin
    .from("users")
    .select("email, role, status")
    .eq("id", userId)
    .eq("tenant_id", user.tenant_id)
    .maybeSingle();
  if (!target || !["manager", "staff", "viewer"].includes(target.role)) {
    throw new Error("Not authorized");
  }

  const { error } = await admin.from("users").update({ status }).eq("id", userId).eq("tenant_id", user.tenant_id);
  if (error) throw error;

  await writeAuditLog(admin, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "set_user_status",
    resource_type: "user",
    resource_id: userId,
    old_value: { status: target.status },
    new_value: { status },
  });

  if (status === "suspended" || status === "deactivated") {
    // Security-relevant — bypasses the recipient's own email-notification
    // preference (see notifications.ts) since they need to know regardless,
    // and can't see the in-app bell once blocked from logging in.
    await createNotification(admin, {
      tenantId: user.tenant_id,
      userId,
      type: "account_status_changed",
      message: STATUS_MESSAGES[status],
      email: target.email ? { to: target.email, subject: "Your Safina account status has changed" } : null,
    });
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

  // targetUserId is caller-supplied; nothing downstream otherwise checks it
  // belongs to this tenant (the admin client bypasses RLS), so without this
  // a company_admin could link a position — and its assignment email — to
  // a user account in a completely different tenant.
  const { data: targetUser } = await admin
    .from("users")
    .select("email")
    .eq("id", targetUserId)
    .eq("tenant_id", user.tenant_id)
    .maybeSingle();
  if (!targetUser) throw new Error("Not authorized");

  let department: string | null = null;
  let alreadyAssignedHere = false;
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
    // Re-submitting the same user/position pair is a no-op change, not a
    // real assignment — without this, a company_admin could re-trigger the
    // "you've been assigned" email to one specific employee indefinitely,
    // with no cooldown.
    alreadyAssignedHere = targetPosition?.user_id === targetUserId;
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

    if (!alreadyAssignedHere) {
      const message = department ? `You've been assigned to ${department}.` : "You've been assigned to a new position.";

      await createNotification(admin, {
        tenantId: user.tenant_id,
        userId: targetUserId,
        type: "position_assigned",
        message,
        link: "/dashboard",
        email: targetUser?.email ? { to: targetUser.email, subject: "You've been assigned a new position" } : null,
      });
    }
  }

  revalidatePath("/dashboard/team");
}

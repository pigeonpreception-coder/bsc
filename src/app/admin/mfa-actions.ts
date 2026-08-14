"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit-log";

async function requireSuperAdmin() {
  const user = await getCurrentUser();
  if (!user || user.role !== "super_admin") {
    throw new Error("Not authorized");
  }
  return user;
}

// Recovery path for a locked-out user (lost authenticator device). Wipes
// every MFA factor so they can log in with just their password and
// re-enroll from /account.
//
// auth.admin.mfa is flagged @expermental in @supabase/auth-js's own JSDoc —
// if a future SDK bump changes this API's shape, this is the one place
// it'll break.
export async function resetUserMfaFactors(userId: string) {
  const currentUser = await requireSuperAdmin();
  const admin = createAdminClient();

  const { data: target } = await admin.from("users").select("tenant_id").eq("id", userId).single();
  if (!target) throw new Error("User not found");

  const { data } = await admin.auth.admin.mfa.listFactors({ userId });
  for (const factor of data?.factors ?? []) {
    await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId });
  }

  await writeAuditLog(admin, {
    tenant_id: target.tenant_id,
    user_id: currentUser.id,
    action: "reset_user_mfa",
    resource_type: "user",
    resource_id: userId,
    old_value: { factor_count: data?.factors?.length ?? 0 },
    new_value: null,
  });

  revalidatePath(`/admin/tenants/${target.tenant_id}`);
}

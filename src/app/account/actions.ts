"use server";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-log";

export async function enrollMfaFactor(): Promise<{ factorId: string; qrCode: string; secret: string }> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp" });
  if (error) throw error;

  return { factorId: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret };
}

export async function verifyMfaEnrollment(factorId: string, code: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "enroll_mfa_factor",
    resource_type: "user",
    resource_id: user.id,
    old_value: null,
    new_value: { factor_id: factorId },
  });
}

export async function unenrollMfaFactor(factorId: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authorized");

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "unenroll_mfa_factor",
    resource_type: "user",
    resource_id: user.id,
    old_value: { factor_id: factorId },
    new_value: null,
  });
}

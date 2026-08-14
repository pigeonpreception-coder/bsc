"use server";

import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-log";
import { checkMfaChallengeRateLimit, recordMfaChallengeAttempt } from "@/lib/rate-limit";

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

  // Same "guessing a 6-digit TOTP code" risk as the login challenge
  // (src/app/auth/mfa-challenge/actions.ts) — reuses the same rate-limit
  // bucket rather than inventing a separate one for what's the same attack
  // shape against the same user.
  const rateLimit = await checkMfaChallengeRateLimit(user.id, null);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  await recordMfaChallengeAttempt(user.id, null, !error);
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

  // GoTrue's unenroll() only issues a DELETE — unlike verify(), it never
  // refreshes the session, so the browser's cookie keeps its stale aal2
  // claim and cached factor list until the next token refresh. For a role
  // where MFA is mandatory (see needsMandatoryMfaEnrollment in
  // src/lib/supabase/middleware.ts), that would silently defeat
  // enforcement for the rest of the session — the admin keeps full access
  // with zero enrolled factors. Blocking removal of the last factor here
  // avoids relying on exactly when/whether a refresh recomputes AAL.
  if (user.role === "company_admin" || user.role === "super_admin") {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verifiedTotp = (factors?.all ?? []).filter((f) => f.factor_type === "totp" && f.status === "verified");
    if (verifiedTotp.length <= 1 && verifiedTotp.some((f) => f.id === factorId)) {
      throw new Error(
        "Your role requires two-factor authentication. Add another authenticator app before removing this one.",
      );
    }
  }

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

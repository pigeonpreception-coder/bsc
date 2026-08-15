"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkPasswordResetRateLimit, recordPasswordResetAttempt } from "@/lib/rate-limit";
import { resolveAppUrl } from "@/lib/site-url";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) throw new Error("Email is required");

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const rateLimit = await checkPasswordResetRateLimit(email, ip);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  // Not requestHeaders.get("origin") directly — this action is unauthenticated,
  // and a client-supplied Origin header can differ from the app's real
  // domain (Next's CSRF check only compares Origin against Host, both from
  // the same untrusted request). Trusting it here would let an attacker
  // point a real, victim-addressed reset email at a phishing domain. See
  // resolveAppUrl's own comment for the full reasoning.
  const origin = resolveAppUrl(requestHeaders.get("origin"));
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  });

  await recordPasswordResetAttempt(email, ip, !error);

  if (error) throw error;
}

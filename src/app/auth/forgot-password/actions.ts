"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkPasswordResetRateLimit, recordPasswordResetAttempt } from "@/lib/rate-limit";

export async function requestPasswordReset(formData: FormData) {
  const email = String(formData.get("email") ?? "").trim();
  if (!email) throw new Error("Email is required");

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const rateLimit = await checkPasswordResetRateLimit(email, ip);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  const origin = requestHeaders.get("origin");
  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${origin}/auth/callback?next=/auth/reset-password`,
  });

  await recordPasswordResetAttempt(email, ip, !error);

  if (error) throw error;
}

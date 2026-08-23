"use server";

import { headers } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { checkSignupRateLimit, recordSignupAttempt } from "@/lib/rate-limit";
import { signUpNewTenant, type SignUpNewTenantResult } from "@/lib/signup";
import { resolveAppUrl } from "@/lib/site-url";

const MIN_PASSWORD_LENGTH = 8;

export async function signUp(formData: FormData): Promise<SignUpNewTenantResult> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const fullName = String(formData.get("full_name") ?? "").trim();
  const companyName = String(formData.get("company_name") ?? "").trim();

  if (!email || !password || !fullName || !companyName) {
    throw new Error("All fields are required.");
  }
  // Genuinely new for this codebase: the password-reset flow (§19 of the
  // assessment doc) has no app-owned server code in its path to enforce
  // this against, since it goes straight through the browser SDK. Signup is
  // orchestrated by this Server Action, so it can actually be enforced here.
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters.`);
  }

  const requestHeaders = await headers();
  const ip = requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const rateLimit = await checkSignupRateLimit(email, ip);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  // Not requestHeaders.get("origin") directly — same reasoning as
  // forgot-password/actions.ts: this is an unauthenticated action, and a
  // client-supplied Origin header can't be trusted to build a link that
  // gets emailed out.
  const origin = resolveAppUrl(requestHeaders.get("origin"));

  const supabase = await createClient();

  let result: SignUpNewTenantResult;
  try {
    result = await signUpNewTenant(supabase, {
      email,
      password,
      fullName,
      companyName,
      emailRedirectTo: origin ? `${origin}/auth/callback?next=/dashboard` : null,
    });
  } catch (err) {
    await recordSignupAttempt(email, ip, false);
    throw err instanceof Error ? err : new Error("Something went wrong. Please try again.");
  }
  await recordSignupAttempt(email, ip, true);

  return result;
}

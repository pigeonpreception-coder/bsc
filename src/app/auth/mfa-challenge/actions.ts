"use server";

import { headers } from "next/headers";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { checkMfaChallengeRateLimit, recordMfaChallengeAttempt } from "@/lib/rate-limit";

export async function verifyLoginMfaChallenge(factorId: string, code: string): Promise<void> {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authorized");

  const ip = (await headers()).get("x-forwarded-for")?.split(",")[0]?.trim() || null;

  const rateLimit = await checkMfaChallengeRateLimit(user.id, ip);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  const supabase = await createClient();
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });

  await recordMfaChallengeAttempt(user.id, ip, !error);

  if (error) throw new Error("That code didn't work. Please try again.");
}

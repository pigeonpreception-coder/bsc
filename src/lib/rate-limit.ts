import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// No Redis/KV is available in this deployment (see
// SAFINA_CURRENT_STATE_ASSESSMENT.md — nothing speculative added just for
// this), and in-memory counters don't work across separate serverless
// invocations. Postgres (already the system of record for everything else
// here) doubles as the rate-limit store instead — see migration 0017.

export const WINDOW_MINUTES = 15;
export const MAX_ATTEMPTS_PER_EMAIL = 5;
export const MAX_ATTEMPTS_PER_IP = 20;
const RETENTION_HOURS = 24;

export type RateLimitResult = { allowed: true } | { allowed: false; reason: string };

/**
 * The actual threshold decision, pulled out as a pure function so it's
 * unit-testable without a live Postgres connection (see rate-limit.test.ts).
 * `ipAttempts` is null when no IP was resolvable — that check is skipped
 * rather than failing open or closed on missing data.
 */
export function evaluateRateLimit(emailAttempts: number, ipAttempts: number | null): RateLimitResult {
  if (emailAttempts >= MAX_ATTEMPTS_PER_EMAIL) {
    return { allowed: false, reason: "Too many login attempts for this account. Try again in a few minutes." };
  }
  if (ipAttempts !== null && ipAttempts >= MAX_ATTEMPTS_PER_IP) {
    return { allowed: false, reason: "Too many login attempts from this network. Try again in a few minutes." };
  }
  return { allowed: true };
}

async function countSince(
  admin: ReturnType<typeof createAdminClient>,
  column: "email" | "ip_address",
  value: string,
  since: string,
): Promise<number> {
  const { count } = await admin
    .from("login_attempts")
    .select("id", { count: "exact", head: true })
    .eq(column, value)
    .gte("attempted_at", since);
  return count ?? 0;
}

/** Checked before attempting a password verification, not after. */
export async function checkLoginRateLimit(email: string, ip: string | null): Promise<RateLimitResult> {
  const admin = createAdminClient();
  const windowStart = new Date(Date.now() - WINDOW_MINUTES * 60 * 1000).toISOString();

  const emailAttempts = await countSince(admin, "email", email, windowStart);
  const ipAttempts = ip ? await countSince(admin, "ip_address", ip, windowStart) : null;

  return evaluateRateLimit(emailAttempts, ipAttempts);
}

/** Records every attempt (success or failure) so both counters above stay accurate. */
export async function recordLoginAttempt(email: string, ip: string | null, success: boolean): Promise<void> {
  const admin = createAdminClient();
  await admin.from("login_attempts").insert({ email, ip_address: ip, success });

  // Opportunistic cleanup instead of a dedicated cron job — cheap at this
  // table's expected volume, and keeps it from growing unbounded.
  if (Math.random() < 0.05) {
    const cutoff = new Date(Date.now() - RETENTION_HOURS * 60 * 60 * 1000).toISOString();
    await admin.from("login_attempts").delete().lt("attempted_at", cutoff);
  }
}

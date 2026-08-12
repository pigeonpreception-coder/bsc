import "server-only";
import { timingSafeEqual } from "crypto";

/** Constant-time check of the cron route's bearer token against CRON_SECRET. */
export function isValidCronRequest(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const authHeader = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;

  const a = Buffer.from(authHeader);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

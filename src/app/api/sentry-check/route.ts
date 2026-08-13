import { timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";

// GET /api/sentry-check?secret=<CRON_SECRET>
// Throws a harmless, generic error on purpose. Hit this once after setting
// NEXT_PUBLIC_SENTRY_DSN to confirm errors actually reach your Sentry
// project before relying on it in production — then feel free to delete
// this route, it serves no purpose afterward.
//
// Gated behind a secret (reusing CRON_SECRET rather than adding a new env
// var) — this always throws with no auth check otherwise, so it'd
// otherwise be a standing, unauthenticated way for anyone on the internet
// to burn through Sentry's event quota or trigger alert fatigue.
function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const provided = request.nextUrl.searchParams.get("secret") ?? "";
  const a = Buffer.from(provided);
  const b = Buffer.from(secret);
  if (a.length !== b.length) return false;

  return timingSafeEqual(a, b);
}

export async function GET(request: NextRequest): Promise<Response> {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
  throw new Error("Sentry verification check — this error is expected, not a bug.");
}

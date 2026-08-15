import "server-only";

// Prefers a fixed, deployment-known origin over anything request-supplied.
// The Origin/Host headers on an incoming request are client-controlled —
// Next's own CSRF check only compares them against each other, not against
// a server-known canonical domain, so a direct (non-browser) HTTP client can
// send whatever it wants for both. That's fine for same-origin form
// submission, but not safe to embed in a link mailed out to someone else
// (password reset, team invite) — see forgot-password/actions.ts and
// user-invite.ts, the two places this actually matters.
//
// VERCEL_URL is set automatically on every Vercel deployment (no manual
// config needed); NEXT_PUBLIC_APP_URL lets a custom domain override it.
// requestOrigin is only used as a last resort — local dev without either
// env var set, where there's no real trust boundary being crossed.
export function resolveAppUrl(requestOrigin?: string | null): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return requestOrigin ?? null;
}

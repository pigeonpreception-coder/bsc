import * as Sentry from "@sentry/nextjs";

// Server + Edge runtime init. Inert until NEXT_PUBLIC_SENTRY_DSN is set —
// safe to deploy before a Sentry project exists, reports nothing until one
// does. The DSN is not a secret (it only allows sending events, not reading
// them), so one variable is reused for client/server/edge rather than
// needing separate public/private versions.
export async function register() {
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    // Conservative default — no real traffic to size this against yet.
    // Errors are always captured regardless of this setting; this only
    // controls performance-trace volume.
    tracesSampleRate: 0.1,
  });
}

// Reports errors from Server Components, Route Handlers, Server Actions,
// and middleware to Sentry — see the Next.js instrumentation.js docs for
// the onRequestError hook this satisfies. A no-op if Sentry was never
// initialized above (unset DSN).
export const onRequestError = Sentry.captureRequestError;

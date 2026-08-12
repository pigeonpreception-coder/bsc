import * as Sentry from "@sentry/nextjs";

// Client-side init — see src/instrumentation.ts for the server/edge half
// and why NEXT_PUBLIC_SENTRY_DSN is safe to share across both. Runs before
// hydration per Next.js's instrumentation-client.js convention, which is
// early enough to catch errors from the very start of the page lifecycle.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    tracesSampleRate: 0.1,
  });
}

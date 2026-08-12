// GET /api/sentry-check
// Throws a harmless, generic error on purpose. Hit this once after setting
// NEXT_PUBLIC_SENTRY_DSN to confirm errors actually reach your Sentry
// project before relying on it in production — then feel free to delete
// this route, it serves no purpose afterward.
export async function GET(): Promise<never> {
  throw new Error("Sentry verification check — this error is expected, not a bug.");
}

import "server-only";
import { Resend } from "resend";

const DEFAULT_FROM = "Safina BSC Platform <onboarding@resend.dev>";

let client: Resend | null = null;

// Inert until RESEND_API_KEY is configured — same gating pattern as Sentry
// in src/instrumentation.ts, so this is safe to deploy before the account exists.
function getClient(): Resend | null {
  if (!process.env.RESEND_API_KEY) return null;
  if (!client) client = new Resend(process.env.RESEND_API_KEY);
  return client;
}

function resolveAppUrl(): string | null {
  if (process.env.NEXT_PUBLIC_APP_URL) return process.env.NEXT_PUBLIC_APP_URL;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return null;
}

// Fire-and-forget, like createNotification() — a failed email send shouldn't
// break the action (position assignment, advisory generation) that triggered it.
export async function sendNotificationEmail(to: string, subject: string, message: string, link?: string | null): Promise<void> {
  const resend = getClient();
  if (!resend) return;

  const appUrl = resolveAppUrl();
  const absoluteLink = link && appUrl ? `${appUrl}${link}` : null;

  await resend.emails.send({
    from: process.env.NOTIFICATION_EMAIL_FROM || DEFAULT_FROM,
    to,
    subject,
    html: absoluteLink
      ? `<p>${message}</p><p><a href="${absoluteLink}">Open Safina BSC Platform</a></p>`
      : `<p>${message}</p>`,
  });
}

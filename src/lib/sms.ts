import "server-only";
import * as Sentry from "@sentry/nextjs";
import twilio from "twilio";

let client: ReturnType<typeof twilio> | null = null;

// Inert until TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN/TWILIO_FROM_NUMBER are
// configured — same gating pattern as email.ts's Resend client and Sentry
// in src/instrumentation.ts, so this is safe to deploy before the account
// exists.
function getClient(): twilio.Twilio | null {
  if (!process.env.TWILIO_ACCOUNT_SID || !process.env.TWILIO_AUTH_TOKEN) return null;
  if (!client) client = twilio(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
  return client;
}

// Fire-and-forget, like sendNotificationEmail() — a failed SMS send
// shouldn't break the action that triggered it. Unlike Resend's send(),
// Twilio's messages.create() rejects on API failure rather than returning
// an { error } field, so the try/catch here is the only failure signal.
export async function sendNotificationSms(to: string, message: string): Promise<void> {
  const twilioClient = getClient();
  const from = process.env.TWILIO_FROM_NUMBER;
  if (!twilioClient || !from) return;

  try {
    await twilioClient.messages.create({ to, from, body: message });
  } catch (err) {
    Sentry.captureException(err, { extra: { to } });
  }
}

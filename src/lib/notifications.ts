import "server-only";
import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "./email";

export type NotificationType =
  | "position_assigned"
  | "weekly_advisory_ready"
  | "account_created"
  | "plan_approved"
  | "account_status_changed"
  | "score_pending_review"
  | "score_approved"
  | "score_rejected";

export type CreateNotificationParams = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  message: string;
  link?: string | null;
  /** When set, also emails the notification (no-ops if RESEND_API_KEY isn't configured). */
  email?: { to: string; subject: string } | null;
};

// Security-relevant account events bypass the recipient's own
// email-notification preference — same reasoning real systems use for
// account-security emails vs. routine/activity ones. Everything else
// respects the opt-out set in /account.
const BYPASS_EMAIL_PREFERENCE: ReadonlySet<NotificationType> = new Set(["account_status_changed"]);

// Fire-and-forget, like the audit_log inserts elsewhere in this codebase —
// a failure to write a notification (or its email) shouldn't break the
// action that triggered it.
export async function createNotification(supabase: SupabaseClient, params: CreateNotificationParams): Promise<void> {
  const { error } = await supabase.from("notifications").insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    notification_type: params.type,
    message: params.message,
    link: params.link ?? null,
  });
  if (error) {
    // Same gap writeAuditLog() closed for audit_log — a failed insert here
    // was previously invisible, with no signal anywhere it hadn't happened.
    Sentry.captureException(error, { extra: { createNotificationParams: params } });
  }

  if (params.email) {
    let shouldSend = true;
    if (!BYPASS_EMAIL_PREFERENCE.has(params.type)) {
      // Checked here, once, rather than pushed onto every one of this
      // function's four call sites — a single enforcement point for the
      // preference set in /account. Defaults to sending if the lookup
      // itself fails (recipient null/undefined) rather than silently
      // dropping a notification over a transient read error.
      const { data: recipient } = await supabase
        .from("users")
        .select("email_notifications_enabled")
        .eq("id", params.userId)
        .maybeSingle();
      shouldSend = recipient?.email_notifications_enabled !== false;
    }

    if (shouldSend) {
      try {
        // sendNotificationEmail already reports a Resend-level { error } to
        // Sentry itself; this catch is for the network/throw case (a fetch
        // failure, DNS error) — without it, that class of failure would
        // propagate up and fail the calling action outright, the opposite of
        // "fire-and-forget" this function's own comment promises.
        await sendNotificationEmail(params.email.to, params.email.subject, params.message, params.link);
      } catch (err) {
        Sentry.captureException(err, { extra: { createNotificationParams: params } });
      }
    }
  }
}

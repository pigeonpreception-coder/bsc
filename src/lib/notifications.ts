import "server-only";
import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "./email";
import { sendNotificationSms } from "./sms";

export type NotificationType =
  | "position_assigned"
  | "weekly_advisory_ready"
  | "account_created"
  | "plan_approved"
  | "account_status_changed"
  | "task_assigned"
  | "bsc_pending_manager_review"
  | "bsc_pending_final_review"
  | "bsc_finally_approved"
  | "bsc_returned_for_correction"
  | "bsc_unlocked"
  | "approval_hierarchy_not_configured";

export type CreateNotificationParams = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  message: string;
  link?: string | null;
  /** When set, also emails the notification (no-ops if RESEND_API_KEY isn't configured). */
  email?: { to: string; subject: string } | null;
  /** When set, also texts the notification (no-ops if TWILIO_* env vars
   * aren't configured). `to` must already be in the phone number's E.164
   * format Twilio expects — this function doesn't normalize it. */
  sms?: { to: string } | null;
};

// Security-relevant account events bypass the recipient's own
// email/SMS-notification preference — same reasoning real systems use for
// account-security messages vs. routine/activity ones. Everything else
// respects the opt-out/opt-in set in /account.
const BYPASS_EMAIL_PREFERENCE: ReadonlySet<NotificationType> = new Set(["account_status_changed"]);
const BYPASS_SMS_PREFERENCE: ReadonlySet<NotificationType> = new Set(["account_status_changed"]);

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

  if (params.email || params.sms) {
    // One shared lookup for both channels' preferences rather than a
    // separate query each — checked here, once, rather than pushed onto
    // every one of this function's call sites. The two channels default
    // oppositely on a failed/empty lookup, matching their own opt-out vs.
    // opt-in defaults: email defaults to sending (email_notifications_enabled
    // itself defaults true), SMS defaults to NOT sending (it's opt-in and
    // costs money per message, so an unconfirmed preference should never
    // fire a text) — see the `!== false` vs `=== true` checks below.
    const needsEmailCheck = !!params.email && !BYPASS_EMAIL_PREFERENCE.has(params.type);
    const needsSmsCheck = !!params.sms && !BYPASS_SMS_PREFERENCE.has(params.type);
    let recipient: { email_notifications_enabled?: boolean; sms_notifications_enabled?: boolean } | null = null;
    if (needsEmailCheck || needsSmsCheck) {
      const { data } = await supabase
        .from("users")
        .select("email_notifications_enabled, sms_notifications_enabled")
        .eq("id", params.userId)
        .maybeSingle();
      recipient = data;
    }

    if (params.email && (!needsEmailCheck || recipient?.email_notifications_enabled !== false)) {
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

    if (params.sms && (!needsSmsCheck || recipient?.sms_notifications_enabled === true)) {
      try {
        await sendNotificationSms(params.sms.to, params.message);
      } catch (err) {
        Sentry.captureException(err, { extra: { createNotificationParams: params } });
      }
    }
  }
}

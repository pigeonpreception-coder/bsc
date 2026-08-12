import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import { sendNotificationEmail } from "./email";

export type NotificationType = "position_assigned" | "weekly_advisory_ready" | "account_created" | "plan_approved";

export type CreateNotificationParams = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  message: string;
  link?: string | null;
  /** When set, also emails the notification (no-ops if RESEND_API_KEY isn't configured). */
  email?: { to: string; subject: string } | null;
};

// Fire-and-forget, like the audit_log inserts elsewhere in this codebase —
// a failure to write a notification (or its email) shouldn't break the
// action that triggered it.
export async function createNotification(supabase: SupabaseClient, params: CreateNotificationParams): Promise<void> {
  await supabase.from("notifications").insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    notification_type: params.type,
    message: params.message,
    link: params.link ?? null,
  });

  if (params.email) {
    await sendNotificationEmail(params.email.to, params.email.subject, params.message, params.link);
  }
}

import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";

export type NotificationType = "position_assigned" | "weekly_advisory_ready";

export type CreateNotificationParams = {
  tenantId: string;
  userId: string;
  type: NotificationType;
  message: string;
  link?: string | null;
};

// Fire-and-forget, like the audit_log inserts elsewhere in this codebase —
// a failure to write a notification shouldn't break the action that triggered it.
export async function createNotification(supabase: SupabaseClient, params: CreateNotificationParams): Promise<void> {
  await supabase.from("notifications").insert({
    tenant_id: params.tenantId,
    user_id: params.userId,
    notification_type: params.type,
    message: params.message,
    link: params.link ?? null,
  });
}

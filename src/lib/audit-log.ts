import "server-only";
import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";

export type AuditLogEntry = {
  tenant_id: string;
  user_id: string;
  action: string;
  resource_type: string;
  resource_id: string;
  old_value?: unknown;
  new_value?: unknown;
};

// Every call site used to insert into audit_log directly and discard the
// result — a failed write was invisible, with no signal anywhere that the
// audit trail had a gap. This doesn't retry or block the caller (the
// action that triggered it should still succeed), it just makes the
// failure visible instead of silent.
export async function writeAuditLog(supabase: SupabaseClient, entry: AuditLogEntry): Promise<void> {
  const { error } = await supabase.from("audit_log").insert(entry);
  if (error) {
    Sentry.captureException(error, { extra: { auditLogEntry: entry } });
  }
}

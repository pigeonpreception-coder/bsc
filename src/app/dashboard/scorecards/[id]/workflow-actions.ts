"use server";

import { revalidatePath } from "next/cache";
import { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { writeAuditLog } from "@/lib/audit-log";
import { createNotification, type NotificationType } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { resolveApprovalChain, HIERARCHY_NOT_CONFIGURED_MESSAGE } from "@/lib/approval-hierarchy";

const NOTIFICATION_CONCURRENCY = 5;

async function notifyRecipients(
  supabase: SupabaseClient,
  tenantId: string,
  recipientIds: (string | null | undefined)[],
  type: NotificationType,
  message: string,
  link: string,
  emailSubject: string,
) {
  const uniqueIds = [...new Set(recipientIds.filter((id): id is string => Boolean(id)))];
  if (uniqueIds.length === 0) return;
  const { data: recipients } = await supabase.from("users").select("id, email").in("id", uniqueIds);
  const emailById = new Map((recipients ?? []).map((r) => [r.id, r.email as string | null]));
  await mapWithConcurrency(uniqueIds, NOTIFICATION_CONCURRENCY, (id) =>
    createNotification(supabase, {
      tenantId,
      userId: id,
      type,
      message,
      link,
      email: emailById.get(id) ? { to: emailById.get(id)!, subject: emailSubject } : null,
    }),
  );
}

type ScorecardVersionEvent = "agreed" | "first_approved" | "finally_approved" | "rejected" | "unlocked";

// One row per workflow event, each carrying a full snapshot of the
// scorecard's rows at that moment — the "final approved snapshot" and
// "compare original vs proposed version" requirements share this one
// structure rather than needing a separate diff table.
async function recordScorecardVersion(
  supabase: SupabaseClient,
  scorecard: { id: string; tenant_id: string },
  versionMajor: number,
  versionMinor: number,
  workflowStatus: string,
  event: ScorecardVersionEvent,
  actorId: string,
  comments?: string | null,
) {
  const { data: rows } = await supabase.from("scorecard_rows").select("*").eq("scorecard_id", scorecard.id);
  await supabase.from("scorecard_versions").insert({
    tenant_id: scorecard.tenant_id,
    scorecard_id: scorecard.id,
    version_major: versionMajor,
    version_minor: versionMinor,
    workflow_status: workflowStatus,
    event,
    actor_id: actorId,
    comments: comments ?? null,
    snapshot: rows ?? [],
  });
}

async function loadScorecardContext(scorecardId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authorized");

  // Writing to scorecards requires the service-role key (see
  // 0033_lock_down_scorecard_writes.sql — RLS no longer trusts an ordinary
  // authenticated session to write these rows, since the real authorization
  // here is the dynamic owner/resolved-manager/locked logic below, which
  // SQL can't express). The explicit tenant check below is what makes that
  // safe, the same pattern every other admin-client caller in this codebase
  // already follows.
  const supabase = createAdminClient();
  const { data: scorecard } = await supabase.from("scorecards").select("*").eq("id", scorecardId).single();
  if (!scorecard || scorecard.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  return { user, scorecard, supabase };
}

const PLACEHOLDER_OBJECTIVE = /^New objective( \d+)?$/;

export async function agreeAndSubmitScorecard(scorecardId: string) {
  const { user, scorecard, supabase } = await loadScorecardContext(scorecardId);
  if (scorecard.owner_user_id !== user.id) throw new Error("Not authorized");
  if (scorecard.workflow_status !== "owner_editing") {
    throw new Error("This BSC isn't open for review right now.");
  }

  // "No incomplete BSC should be finalized" — a minimal completeness gate,
  // reusing the same placeholder-row detection addScorecardRow already
  // enforces rather than inventing a second notion of "complete."
  const { data: rows } = await supabase
    .from("scorecard_rows")
    .select("strategic_objective, kpi")
    .eq("scorecard_id", scorecardId);
  if (!rows || rows.length === 0) throw new Error("Add at least one KPI before submitting.");
  if (rows.some((r) => PLACEHOLDER_OBJECTIVE.test(r.strategic_objective ?? "") || r.kpi === "New KPI")) {
    throw new Error("Finish filling out every row before submitting — some still have placeholder text.");
  }

  const nextMinor = scorecard.version_minor + 1;
  const { error } = await supabase
    .from("scorecards")
    .update({
      workflow_status: "pending_manager_review",
      agreed_by: user.id,
      agreed_at: new Date().toISOString(),
      version_minor: nextMinor,
      rejected_by: null,
      rejected_at: null,
      rejected_level: null,
      rejection_reason: null,
    })
    .eq("id", scorecardId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: scorecard.tenant_id,
    user_id: user.id,
    action: "agree_and_submit_bsc",
    resource_type: "scorecard",
    resource_id: scorecardId,
    old_value: { workflow_status: scorecard.workflow_status },
    new_value: { workflow_status: "pending_manager_review" },
  });

  await recordScorecardVersion(supabase, scorecard, scorecard.version_major, nextMinor, "pending_manager_review", "agreed", user.id);

  const chain = await resolveApprovalChain(supabase, scorecard.tenant_id, scorecard.owner_user_id);
  if (!chain.blockedReason && chain.firstApproverId) {
    await notifyRecipients(
      supabase,
      scorecard.tenant_id,
      [chain.firstApproverId],
      "bsc_pending_manager_review",
      `${user.full_name || user.email} submitted their Balanced Scorecard "${scorecard.name}" for your review.`,
      "/dashboard/approvals",
      "A BSC needs your first-level review",
    );
  } else {
    const { data: admins } = await supabase
      .from("users")
      .select("id")
      .eq("tenant_id", scorecard.tenant_id)
      .eq("role", "company_admin");
    await notifyRecipients(
      supabase,
      scorecard.tenant_id,
      (admins ?? []).map((a) => a.id),
      "approval_hierarchy_not_configured",
      `${HIERARCHY_NOT_CONFIGURED_MESSAGE} (BSC: "${scorecard.name}")`,
      `/dashboard/scorecards/${scorecardId}`,
      "BSC approval routing needs attention",
    );
  }

  revalidatePath(`/dashboard/scorecards/${scorecardId}`);
  revalidatePath("/dashboard/approvals");
}

export async function submitManagerFirstApproval(scorecardId: string, decision: "approved" | "rejected", comments?: string) {
  const { user, scorecard, supabase } = await loadScorecardContext(scorecardId);
  if (scorecard.workflow_status !== "pending_manager_review") return;
  if (!scorecard.owner_user_id) throw new Error("Not authorized");
  if (scorecard.owner_user_id === user.id) throw new Error("You can't approve your own BSC.");

  const chain = await resolveApprovalChain(supabase, scorecard.tenant_id, scorecard.owner_user_id);
  if (chain.blockedReason || chain.firstApproverId !== user.id) throw new Error("Not authorized");

  const trimmedComments = (comments ?? "").trim();
  if (decision === "rejected" && !trimmedComments) {
    throw new Error("A reason is required when returning a BSC for correction.");
  }

  const nextMinor = scorecard.version_minor + 1;
  const update: Record<string, unknown> =
    decision === "approved"
      ? {
          workflow_status: "pending_final_review",
          first_approved_by: user.id,
          first_approved_at: new Date().toISOString(),
          first_approval_comments: trimmedComments || null,
          version_minor: nextMinor,
        }
      : {
          workflow_status: "owner_editing",
          rejected_by: user.id,
          rejected_at: new Date().toISOString(),
          rejected_level: "first",
          rejection_reason: trimmedComments,
          version_minor: nextMinor,
        };

  const { error } = await supabase.from("scorecards").update(update).eq("id", scorecardId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: scorecard.tenant_id,
    user_id: user.id,
    action: decision === "approved" ? "first_approve_bsc" : "reject_bsc_first_level",
    resource_type: "scorecard",
    resource_id: scorecardId,
    old_value: { workflow_status: scorecard.workflow_status },
    new_value: update,
  });

  await recordScorecardVersion(
    supabase,
    scorecard,
    scorecard.version_major,
    nextMinor,
    update.workflow_status as string,
    decision === "approved" ? "first_approved" : "rejected",
    user.id,
    trimmedComments || null,
  );

  if (decision === "approved") {
    await notifyRecipients(
      supabase,
      scorecard.tenant_id,
      [chain.finalApproverId],
      "bsc_pending_final_review",
      `"${scorecard.name}" was approved at the first level and needs your final approval.`,
      "/dashboard/approvals",
      "A BSC needs your final approval",
    );
  } else {
    await notifyRecipients(
      supabase,
      scorecard.tenant_id,
      [scorecard.owner_user_id],
      "bsc_returned_for_correction",
      `Your Balanced Scorecard "${scorecard.name}" was returned for correction: ${trimmedComments}`,
      `/dashboard/scorecards/${scorecardId}`,
      "Your BSC was returned for correction",
    );
  }

  revalidatePath(`/dashboard/scorecards/${scorecardId}`);
  revalidatePath("/dashboard/approvals");
}

export async function submitDivisionHeadFinalApproval(scorecardId: string, decision: "approved" | "rejected", comments?: string) {
  const { user, scorecard, supabase } = await loadScorecardContext(scorecardId);
  if (scorecard.workflow_status !== "pending_final_review") return;
  if (!scorecard.owner_user_id) throw new Error("Not authorized");
  if (scorecard.owner_user_id === user.id) throw new Error("You can't approve your own BSC.");

  const chain = await resolveApprovalChain(supabase, scorecard.tenant_id, scorecard.owner_user_id);
  if (chain.blockedReason || chain.finalApproverId !== user.id) throw new Error("Not authorized");

  const trimmedComments = (comments ?? "").trim();
  if (decision === "rejected" && !trimmedComments) {
    throw new Error("A reason is required when returning a BSC for correction.");
  }

  const nextMinor = scorecard.version_minor + 1;
  const now = new Date().toISOString();
  const update: Record<string, unknown> =
    decision === "approved"
      ? {
          workflow_status: "locked",
          final_approved_by: user.id,
          final_approved_at: now,
          final_approval_comments: trimmedComments || null,
          locked_at: now,
          version_minor: nextMinor,
        }
      : {
          workflow_status: "owner_editing",
          rejected_by: user.id,
          rejected_at: now,
          rejected_level: "final",
          rejection_reason: trimmedComments,
          version_minor: nextMinor,
        };

  const { error } = await supabase.from("scorecards").update(update).eq("id", scorecardId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: scorecard.tenant_id,
    user_id: user.id,
    action: decision === "approved" ? "final_approve_bsc" : "reject_bsc_final_level",
    resource_type: "scorecard",
    resource_id: scorecardId,
    old_value: { workflow_status: scorecard.workflow_status },
    new_value: update,
  });

  await recordScorecardVersion(
    supabase,
    scorecard,
    scorecard.version_major,
    nextMinor,
    update.workflow_status as string,
    decision === "approved" ? "finally_approved" : "rejected",
    user.id,
    trimmedComments || null,
  );

  const recipients = [scorecard.owner_user_id, scorecard.first_approved_by];
  if (decision === "approved") {
    await notifyRecipients(
      supabase,
      scorecard.tenant_id,
      recipients,
      "bsc_finally_approved",
      `"${scorecard.name}" received final approval and is now locked.`,
      `/dashboard/scorecards/${scorecardId}`,
      "A BSC was finally approved",
    );
  } else {
    await notifyRecipients(
      supabase,
      scorecard.tenant_id,
      recipients,
      "bsc_returned_for_correction",
      `"${scorecard.name}" was returned for correction at final review: ${trimmedComments}`,
      `/dashboard/scorecards/${scorecardId}`,
      "A BSC was returned for correction",
    );
  }

  revalidatePath(`/dashboard/scorecards/${scorecardId}`);
  revalidatePath("/dashboard/approvals");
}

// Company-admin power only, deliberately role-gated rather than resolved
// from the org hierarchy — the spec's central correction: unlock authority
// belongs to the administrator, but only unlocks the workflow, it never
// approves anything itself.
export async function unlockScorecard(scorecardId: string, reason: string) {
  const { user, scorecard, supabase } = await loadScorecardContext(scorecardId);
  if (user.role !== "company_admin") throw new Error("Not authorized");
  if (scorecard.workflow_status !== "locked") throw new Error("Only a locked BSC can be unlocked.");

  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("A reason is required to unlock a BSC.");

  const nextMajor = scorecard.version_major + 1;
  const now = new Date().toISOString();

  const { error } = await supabase
    .from("scorecards")
    .update({
      workflow_status: "owner_editing",
      unlocked_by: user.id,
      unlocked_at: now,
      unlock_reason: trimmedReason,
      version_major: nextMajor,
      version_minor: 0,
      // A fresh revision cycle starts clean — the prior cycle's decisions
      // are preserved forever in scorecard_versions, never overwritten here.
      agreed_by: null,
      agreed_at: null,
      first_approved_by: null,
      first_approved_at: null,
      first_approval_comments: null,
      final_approved_by: null,
      final_approved_at: null,
      final_approval_comments: null,
      locked_at: null,
      rejected_by: null,
      rejected_at: null,
      rejected_level: null,
      rejection_reason: null,
    })
    .eq("id", scorecardId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: scorecard.tenant_id,
    user_id: user.id,
    action: "unlock_bsc",
    resource_type: "scorecard",
    resource_id: scorecardId,
    old_value: { workflow_status: "locked", version: `${scorecard.version_major}.${scorecard.version_minor}` },
    new_value: { workflow_status: "owner_editing", reason: trimmedReason, version: `${nextMajor}.0` },
  });

  await recordScorecardVersion(supabase, scorecard, nextMajor, 0, "owner_editing", "unlocked", user.id, trimmedReason);

  if (scorecard.owner_user_id) {
    await notifyRecipients(
      supabase,
      scorecard.tenant_id,
      [scorecard.owner_user_id],
      "bsc_unlocked",
      `"${scorecard.name}" was unlocked for a new review cycle: ${trimmedReason}`,
      `/dashboard/scorecards/${scorecardId}`,
      "Your BSC was unlocked for review",
    );
  }

  revalidatePath(`/dashboard/scorecards/${scorecardId}`);
  revalidatePath("/dashboard/scorecards");
}

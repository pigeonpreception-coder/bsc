"use server";

import { revalidatePath } from "next/cache";
import { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeAutoStatus } from "@/lib/scorecard";
import { calculatePerformanceScores } from "@/lib/performance";
import { writeAuditLog } from "@/lib/audit-log";
import { createNotification, type NotificationType } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { parseOwnWeightPercent } from "@/lib/cascade-weights";
import { resolveApprovalChain, HIERARCHY_NOT_CONFIGURED_MESSAGE, type ApprovalChain } from "@/lib/approval-hierarchy";

// See src/lib/concurrency.ts — same worker-pool pattern used elsewhere so
// notifying several people in a larger tenant can't stall a single edit.
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

type VersionEvent = "submitted" | "first_approved" | "finally_approved" | "rejected" | "amendment_requested" | "reopened";

// Version history through the approval chain — distinct from
// performance_snapshots, which only ever recorded the raw actual-value text
// with no link to which approval cycle it belonged to. Best-effort, like
// the performance_snapshots insert below it (not on the row's critical
// write path).
async function recordScoreVersion(
  supabase: SupabaseClient,
  row: { id: string; tenant_id: string },
  event: VersionEvent,
  fields: { actual: string | null; computedStatus: string; approvalStatus: string; actorId: string; comments?: string | null },
) {
  const { count } = await supabase
    .from("scorecard_row_versions")
    .select("id", { count: "exact", head: true })
    .eq("scorecard_row_id", row.id);
  await supabase.from("scorecard_row_versions").insert({
    tenant_id: row.tenant_id,
    scorecard_row_id: row.id,
    version_number: (count ?? 0) + 1,
    actual: fields.actual,
    computed_status: fields.computedStatus,
    approval_status: fields.approvalStatus,
    event,
    actor_id: fields.actorId,
    comments: fields.comments ?? null,
  });
}

const ADMIN_EDITABLE_FIELDS = [
  "perspective",
  "strategic_objective",
  "strategic_theme_alignment",
  "intended_result",
  "key_initiatives",
  "perspective_weight",
  "objective_weight",
  "kpi",
  "unit",
  "baseline",
  "target",
  "measurement_frequency",
  "actual",
  "responsible_person",
  "lower_is_better",
  "status",
] as const;

export type EditableField = (typeof ADMIN_EDITABLE_FIELDS)[number];

const NUMERIC_FIELDS: EditableField[] = ["perspective_weight", "objective_weight"];
const BOOLEAN_FIELDS: EditableField[] = ["lower_is_better"];
const STATUS_AFFECTING_FIELDS: EditableField[] = ["actual", "target", "lower_is_better"];

async function loadContext(rowId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: row } = await supabase.from("scorecard_rows").select("*").eq("id", rowId).single();
  if (!row || row.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  return { user, row, supabase };
}

export async function updateScorecardRow(rowId: string, field: EditableField, value: string) {
  if (!ADMIN_EDITABLE_FIELDS.includes(field)) throw new Error("Invalid field");

  const { user, row, supabase } = await loadContext(rowId);
  const isAdmin = user.role === "company_admin";

  let canEdit: boolean;
  let chain: ApprovalChain | null = null;
  if (field === "actual") {
    if (row.approval_status === "finally_approved") {
      throw new Error("This score is locked. Request an amendment to reopen it for correction.");
    }
    const isOwner = row.responsible_person === user.id;
    if (row.responsible_person) {
      // Governance principle: score-editing authority follows the org
      // hierarchy, not the company_admin role. A company_admin only
      // qualifies here if they independently occupy the resolved immediate
      // manager's position — the check below is role-agnostic on purpose.
      chain = await resolveApprovalChain(supabase, user.tenant_id!, row.responsible_person);
      const isResolvedManager = !!chain.firstApproverId && chain.firstApproverId === user.id;
      canEdit = isOwner || isResolvedManager;
    } else {
      // No owner assigned — there's no hierarchy to derive authority from,
      // so this stays company_admin-editable until someone assigns an
      // owner via the responsible_person field below.
      canEdit = isAdmin;
    }
  } else {
    // Every other field is scorecard *design* (KPI definition, target,
    // weights, etc.) — company_admin authority there is unrelated to
    // performance-score governance and unchanged by this workflow.
    canEdit = isAdmin;
  }
  if (!canEdit) throw new Error("Not authorized to edit this field");

  // perspective_weight/objective_weight feed directly into weightedAverage()
  // (src/lib/performance.ts) with no clamping downstream — an unvalidated
  // negative or non-finite weight there can produce a nonsensical score
  // (e.g. a negative percentage) rendered tenant-wide on the dashboard.
  // Reuses the same 0-100 whole-number validation already built for the
  // sibling cascade-weight concept rather than duplicating it.
  const update: Record<string, unknown> = {
    [field]:
      value === ""
        ? null
        : NUMERIC_FIELDS.includes(field)
          ? parseOwnWeightPercent(value)
          : BOOLEAN_FIELDS.includes(field)
            ? value === "true"
            : value,
  };

  if (STATUS_AFFECTING_FIELDS.includes(field)) {
    const nextActual = field === "actual" ? value : row.actual;
    const nextTarget = field === "target" ? value : row.target;
    const nextLowerIsBetter = field === "lower_is_better" ? value === "true" : (row.lower_is_better ?? false);
    update.status = computeAutoStatus(nextActual, nextTarget, nextLowerIsBetter);
  }

  if (field === "actual") {
    // Every actual edit re-enters the workflow at the top and clears any
    // prior decision — a correction is a new submission, not a continuation
    // of the old one.
    update.approval_status = "submitted";
    update.edited_by = user.id;
    update.first_approved_by = null;
    update.first_approved_at = null;
    update.first_approval_comments = null;
    update.final_approved_by = null;
    update.final_approved_at = null;
    update.final_approval_comments = null;
    update.rejected_by = null;
    update.rejected_at = null;
    update.rejected_level = null;
    update.rejection_reason = null;
    update.amendment_requested_by = null;
    update.amendment_requested_at = null;
    update.amendment_reason = null;

    if (!row.responsible_person) {
      // An unowned row has no employee/hierarchy for this workflow to
      // govern — a company_admin's edit here finalizes directly rather than
      // routing to an approval chain that can't exist.
      update.approval_status = "finally_approved";
      update.final_approved_by = user.id;
      update.final_approved_at = new Date().toISOString();
    }
  }

  // responsible_person is a user id with no enum/FK check at the DB level
  // reachable from here (the column's own FK just requires *some* row in
  // public.users, any tenant) — without this, an admin could point a row
  // at a nonexistent or wrong-tenant user, silently breaking the isOwner
  // check above for whoever it should have pointed to.
  if (field === "responsible_person" && update.responsible_person) {
    const { data: candidate } = await supabase
      .from("users")
      .select("id")
      .eq("id", update.responsible_person)
      .eq("tenant_id", user.tenant_id)
      .maybeSingle();
    if (!candidate) throw new Error("That person isn't part of this organization.");
  }

  const { error } = await supabase.from("scorecard_rows").update(update).eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: "update_row",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: { [field]: row[field] },
    new_value: update,
  });

  if (field === "actual") {
    await supabase.from("performance_snapshots").insert({
      scorecard_row_id: rowId,
      tenant_id: user.tenant_id,
      actual_value: value,
      updated_by: user.id,
    });

    // Recalculate performance scores cascade — a governance/audit layer sits
    // on top of live scoring here, it does not gate it (unresolved question
    // the underlying spec didn't answer: does a rejected value revert? to
    // what? — deferred rather than guessed).
    await calculatePerformanceScores(supabase, user.tenant_id!);

    await recordScoreVersion(supabase, row, update.approval_status === "finally_approved" ? "finally_approved" : "submitted", {
      actual: value,
      computedStatus: String(update.status ?? row.status),
      approvalStatus: update.approval_status as string,
      actorId: user.id,
    });

    if (row.responsible_person && update.approval_status === "submitted") {
      if (chain && !chain.blockedReason && chain.firstApproverId) {
        await notifyRecipients(
          supabase,
          user.tenant_id!,
          [chain.firstApproverId],
          "score_submitted_for_review",
          `${user.full_name || user.email} submitted a new value for "${row.kpi}" — awaiting your review.`,
          "/dashboard/approvals",
          "A KPI score needs your review",
        );
      } else {
        // Only a company_admin can fix org structure — tell them rather
        // than stranding the submission with no reviewer (spec's own
        // required message).
        const { data: admins } = await supabase
          .from("users")
          .select("id")
          .eq("tenant_id", user.tenant_id)
          .eq("role", "company_admin");
        await notifyRecipients(
          supabase,
          user.tenant_id!,
          (admins ?? []).map((a) => a.id),
          "approval_hierarchy_not_configured",
          `${HIERARCHY_NOT_CONFIGURED_MESSAGE} (KPI: "${row.kpi}")`,
          `/dashboard/scorecards/${row.scorecard_id}`,
          "KPI approval routing needs attention",
        );
      }
    }
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
  revalidatePath("/dashboard/approvals");
}

export async function submitFirstApproval(rowId: string, decision: "approved" | "rejected", comments?: string) {
  const { user, row, supabase } = await loadContext(rowId);

  // A client replay/direct call against a row that already moved on is a
  // no-op, not an error — same idempotency stance as the rest of this file.
  if (row.approval_status !== "submitted") return;

  const chain = await resolveApprovalChain(supabase, user.tenant_id!, row.responsible_person ?? "");
  if (chain.blockedReason || chain.firstApproverId !== user.id) throw new Error("Not authorized");
  if (row.edited_by && row.edited_by === user.id) {
    throw new Error("You can't approve a score you edited yourself.");
  }

  const trimmedComments = (comments ?? "").trim();
  if (decision === "rejected" && !trimmedComments) {
    throw new Error("A reason is required when returning a score for correction.");
  }

  const update: Record<string, unknown> =
    decision === "approved"
      ? {
          approval_status: "first_approved",
          first_approved_by: user.id,
          first_approved_at: new Date().toISOString(),
          first_approval_comments: trimmedComments || null,
        }
      : {
          approval_status: "correction_required",
          rejected_by: user.id,
          rejected_at: new Date().toISOString(),
          rejected_level: "first",
          rejection_reason: trimmedComments,
        };

  const { error } = await supabase.from("scorecard_rows").update(update).eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: decision === "approved" ? "first_approve_score" : "reject_score_first_level",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: { approval_status: row.approval_status },
    new_value: update,
  });

  await recordScoreVersion(supabase, row, decision === "approved" ? "first_approved" : "rejected", {
    actual: row.actual,
    computedStatus: row.status,
    approvalStatus: update.approval_status as string,
    actorId: user.id,
    comments: trimmedComments || null,
  });

  if (decision === "approved") {
    await notifyRecipients(
      supabase,
      row.tenant_id,
      [chain.finalApproverId],
      "score_pending_final_review",
      `"${row.kpi}" was approved at the first level and needs your final approval.`,
      "/dashboard/approvals",
      "A KPI score needs your final approval",
    );
  } else {
    await notifyRecipients(
      supabase,
      row.tenant_id,
      [row.responsible_person, row.edited_by],
      "score_returned_for_correction",
      `Your submitted value for "${row.kpi}" was returned for correction: ${trimmedComments}`,
      `/dashboard/scorecards/${row.scorecard_id}`,
      "A KPI score was returned for correction",
    );
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
  revalidatePath("/dashboard/approvals");
}

export async function submitFinalApproval(rowId: string, decision: "approved" | "rejected", comments?: string) {
  const { user, row, supabase } = await loadContext(rowId);
  if (row.approval_status !== "first_approved") return;

  const chain = await resolveApprovalChain(supabase, user.tenant_id!, row.responsible_person ?? "");
  if (chain.blockedReason || chain.finalApproverId !== user.id) throw new Error("Not authorized");
  if (row.edited_by && row.edited_by === user.id) {
    throw new Error("You can't approve a score you edited yourself.");
  }

  const trimmedComments = (comments ?? "").trim();
  if (decision === "rejected" && !trimmedComments) {
    throw new Error("A reason is required when returning a score for correction.");
  }

  const update: Record<string, unknown> =
    decision === "approved"
      ? {
          approval_status: "finally_approved",
          final_approved_by: user.id,
          final_approved_at: new Date().toISOString(),
          final_approval_comments: trimmedComments || null,
        }
      : {
          approval_status: "correction_required",
          rejected_by: user.id,
          rejected_at: new Date().toISOString(),
          rejected_level: "final",
          rejection_reason: trimmedComments,
        };

  const { error } = await supabase.from("scorecard_rows").update(update).eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: decision === "approved" ? "final_approve_score" : "reject_score_final_level",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: { approval_status: row.approval_status },
    new_value: update,
  });

  await recordScoreVersion(supabase, row, decision === "approved" ? "finally_approved" : "rejected", {
    actual: row.actual,
    computedStatus: row.status,
    approvalStatus: update.approval_status as string,
    actorId: user.id,
    comments: trimmedComments || null,
  });

  const recipients = [row.responsible_person, row.edited_by, row.first_approved_by];
  if (decision === "approved") {
    await notifyRecipients(
      supabase,
      row.tenant_id,
      recipients,
      "score_finally_approved",
      `"${row.kpi}" received final approval and is now locked.`,
      `/dashboard/scorecards/${row.scorecard_id}`,
      "A KPI score was finally approved",
    );
  } else {
    await notifyRecipients(
      supabase,
      row.tenant_id,
      recipients,
      "score_returned_for_correction",
      `"${row.kpi}" was returned for correction at final review: ${trimmedComments}`,
      `/dashboard/scorecards/${row.scorecard_id}`,
      "A KPI score was returned for correction",
    );
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
  revalidatePath("/dashboard/approvals");
}

export async function requestAmendment(rowId: string, reason: string) {
  const { user, row, supabase } = await loadContext(rowId);
  if (row.approval_status !== "finally_approved") {
    throw new Error("Only a locked, finally approved score can have an amendment requested.");
  }

  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("A reason is required to request an amendment.");

  const isAdmin = user.role === "company_admin";
  const isOwner = row.responsible_person === user.id;
  let isInChain = false;
  if (row.responsible_person) {
    const chain = await resolveApprovalChain(supabase, user.tenant_id!, row.responsible_person);
    isInChain = chain.firstApproverId === user.id || chain.finalApproverId === user.id;
  }
  if (!isAdmin && !isOwner && !isInChain) throw new Error("Not authorized");

  const { error } = await supabase
    .from("scorecard_rows")
    .update({
      approval_status: "amendment_requested",
      amendment_requested_by: user.id,
      amendment_requested_at: new Date().toISOString(),
      amendment_reason: trimmedReason,
    })
    .eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: "request_score_amendment",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: null,
    new_value: { amendment_reason: trimmedReason },
  });

  await recordScoreVersion(supabase, row, "amendment_requested", {
    actual: row.actual,
    computedStatus: row.status,
    approvalStatus: "amendment_requested",
    actorId: user.id,
    comments: trimmedReason,
  });

  // The final approver is the natural authorizer of reopening a locked
  // score — the highest authority in this row's own chain (the spec's
  // "Authorized Review" step). If the chain can no longer resolve (e.g. the
  // position's since gone vacant), company_admins are told instead so a
  // human can intervene — there's no admin override of the reopen decision
  // itself, consistent with keeping admin out of the approval chain.
  if (row.responsible_person) {
    const chain = await resolveApprovalChain(supabase, row.tenant_id, row.responsible_person);
    if (!chain.blockedReason && chain.finalApproverId) {
      await notifyRecipients(
        supabase,
        row.tenant_id,
        [chain.finalApproverId],
        "score_amendment_requested",
        `An amendment was requested for "${row.kpi}": ${trimmedReason}`,
        `/dashboard/scorecards/${row.scorecard_id}`,
        "A locked KPI score needs your review",
      );
    } else {
      const { data: admins } = await supabase
        .from("users")
        .select("id")
        .eq("tenant_id", row.tenant_id)
        .eq("role", "company_admin");
      await notifyRecipients(
        supabase,
        row.tenant_id,
        (admins ?? []).map((a) => a.id),
        "approval_hierarchy_not_configured",
        `An amendment was requested for "${row.kpi}" but no final approver could be resolved to authorize it. ${HIERARCHY_NOT_CONFIGURED_MESSAGE}`,
        `/dashboard/scorecards/${row.scorecard_id}`,
        "KPI amendment needs administrator attention",
      );
    }
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
}

export async function reopenScore(rowId: string, approve: boolean, comments?: string) {
  const { user, row, supabase } = await loadContext(rowId);
  if (row.approval_status !== "amendment_requested") return;

  const chain = row.responsible_person ? await resolveApprovalChain(supabase, user.tenant_id!, row.responsible_person) : null;
  if (!chain || chain.blockedReason || chain.finalApproverId !== user.id) throw new Error("Not authorized");

  const trimmedComments = (comments ?? "").trim();

  const update: Record<string, unknown> = approve
    ? { approval_status: "reopened" }
    : { approval_status: "finally_approved", amendment_requested_by: null, amendment_requested_at: null, amendment_reason: null };

  const { error } = await supabase.from("scorecard_rows").update(update).eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: approve ? "reopen_score" : "deny_score_amendment",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: { approval_status: row.approval_status },
    new_value: update,
  });

  await recordScoreVersion(supabase, row, "reopened", {
    actual: row.actual,
    computedStatus: row.status,
    approvalStatus: update.approval_status as string,
    actorId: user.id,
    comments: trimmedComments || null,
  });

  if (approve) {
    await notifyRecipients(
      supabase,
      row.tenant_id,
      [row.responsible_person, row.edited_by, row.first_approved_by],
      "score_reopened",
      `"${row.kpi}" was reopened for correction${trimmedComments ? `: ${trimmedComments}` : "."}`,
      `/dashboard/scorecards/${row.scorecard_id}`,
      "A KPI score was reopened for correction",
    );
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
}

export async function addScorecardRow(scorecardId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();

  // scorecardId is caller-supplied — same class of gap already fixed in
  // column-actions.ts (addScorecardColumn/updateCellValue) and
  // team/actions.ts (assignPosition): without this, a company_admin could
  // insert a row against another tenant's scorecard.
  const { data: scorecard } = await supabase
    .from("scorecards")
    .select("id")
    .eq("id", scorecardId)
    .eq("tenant_id", user.tenant_id)
    .maybeSingle();
  if (!scorecard) throw new Error("Not authorized");

  const { data: existing } = await supabase
    .from("scorecard_rows")
    .select("sort_order, strategic_objective, kpi")
    .eq("scorecard_id", scorecardId)
    .eq("tenant_id", user.tenant_id)
    .order("sort_order", { ascending: false });

  const rows = existing ?? [];

  const isPlaceholderObjective = (text: string | null) => /^New objective( \d+)?$/.test(text ?? "");
  const unfinished = rows.find((r) => isPlaceholderObjective(r.strategic_objective) || r.kpi === "New KPI");
  if (unfinished) {
    throw new Error("Fill out the Strategic Objective and KPI on the row you already added before adding another.");
  }

  const nextSortOrder = (rows[0]?.sort_order ?? -1) + 1;

  // Give each placeholder objective a distinct label so a freshly-added row
  // is never mistaken for a "continuation" of the previous freshly-added
  // row (the grouping logic keys off perspective+objective text matching).
  const placeholderCount = rows.filter((r) => isPlaceholderObjective(r.strategic_objective)).length;
  const objectiveText = placeholderCount === 0 ? "New objective" : `New objective ${placeholderCount + 1}`;

  const { data: newRow, error } = await supabase
    .from("scorecard_rows")
    .insert({
      scorecard_id: scorecardId,
      tenant_id: user.tenant_id,
      perspective: "Financial",
      strategic_objective: objectiveText,
      kpi: "New KPI",
      status: "not_yet_measured",
      sort_order: nextSortOrder,
    })
    .select()
    .single();
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "add_row",
    resource_type: "scorecard_row",
    resource_id: newRow.id,
    new_value: newRow,
  });

  revalidatePath(`/dashboard/scorecards/${scorecardId}`);
}

export async function deleteScorecardRow(rowId: string) {
  const { user, row, supabase } = await loadContext(rowId);
  if (user.role !== "company_admin") throw new Error("Not authorized");
  if (row.approval_status === "finally_approved") {
    throw new Error("This score is locked and can't be deleted. Request an amendment first.");
  }

  const { error } = await supabase.from("scorecard_rows").delete().eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: "delete_row",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: row,
  });

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
}

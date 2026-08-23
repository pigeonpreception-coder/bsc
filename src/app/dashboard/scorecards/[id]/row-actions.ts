"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeAutoStatus } from "@/lib/scorecard";
import { calculatePerformanceScores } from "@/lib/performance";
import { writeAuditLog } from "@/lib/audit-log";
import { createNotification } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { parseOwnWeightPercent } from "@/lib/cascade-weights";

// See src/lib/concurrency.ts — same worker-pool pattern the plan-approval
// broadcast and cron routes use, so notifying every company_admin in a
// larger tenant can't stall a single KPI edit behind a serial email loop.
const NOTIFICATION_CONCURRENCY = 5;

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
  const isOwner = row.responsible_person === user.id;
  const canEdit = isAdmin || (isOwner && field === "actual" && ["manager", "staff"].includes(user.role));
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

  // A company_admin already has final sign-off authority on this scorecard,
  // so their own actual-value edit is auto-approved rather than requiring
  // them to separately approve themselves. A manager/staff edit (the only
  // other path that can reach here — see the canEdit check above) resets
  // any prior approval and puts the row up for review.
  if (field === "actual") {
    update.approval_status = isAdmin ? "approved" : "pending_approval";
    update.approved_by = isAdmin ? user.id : null;
    update.approved_at = isAdmin ? new Date().toISOString() : null;
    update.rejection_reason = null;
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

    // Recalculate performance scores cascade
    await calculatePerformanceScores(supabase, user.tenant_id!);

    if (!isAdmin) {
      const { data: admins } = await supabase
        .from("users")
        .select("id, email")
        .eq("tenant_id", user.tenant_id)
        .eq("role", "company_admin");

      const message = `${user.full_name || user.email} submitted a new value for "${row.kpi}" — awaiting your approval.`;
      await mapWithConcurrency(admins ?? [], NOTIFICATION_CONCURRENCY, (admin) =>
        createNotification(supabase, {
          tenantId: user.tenant_id!,
          userId: admin.id,
          type: "score_pending_review",
          message,
          link: "/dashboard/approvals",
          email: admin.email ? { to: admin.email, subject: "A KPI score needs your approval" } : null,
        }),
      );
    }
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
  revalidatePath("/dashboard/approvals");
}

export async function approveScorecardRow(rowId: string, decision: "approved" | "rejected", reason?: string) {
  const { user, row, supabase } = await loadContext(rowId);
  if (user.role !== "company_admin") throw new Error("Not authorized");

  // The UI only shows this control for rows still pending review, but that's
  // a client-side gate only — without this, a replayed/direct call could
  // re-decide an already-approved row and re-notify its owner for no reason.
  if (row.approval_status !== "pending_approval") return;

  const trimmedReason = (reason ?? "").trim();
  if (decision === "rejected" && !trimmedReason) {
    throw new Error("A reason is required when rejecting a submitted value.");
  }

  const { error } = await supabase
    .from("scorecard_rows")
    .update({
      approval_status: decision,
      approved_by: user.id,
      approved_at: new Date().toISOString(),
      rejection_reason: decision === "rejected" ? trimmedReason : null,
    })
    .eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: decision === "approved" ? "approve_score" : "reject_score",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: { approval_status: row.approval_status },
    new_value: { approval_status: decision, rejection_reason: decision === "rejected" ? trimmedReason : null },
  });

  if (row.responsible_person) {
    const { data: submitter } = await supabase
      .from("users")
      .select("email")
      .eq("id", row.responsible_person)
      .maybeSingle();

    const message =
      decision === "approved"
        ? `Your submitted value for "${row.kpi}" was approved.`
        : `Your submitted value for "${row.kpi}" was rejected: ${trimmedReason}`;

    await createNotification(supabase, {
      tenantId: row.tenant_id,
      userId: row.responsible_person,
      type: decision === "approved" ? "score_approved" : "score_rejected",
      message,
      link: `/dashboard/scorecards/${row.scorecard_id}`,
      email: submitter?.email ? { to: submitter.email, subject: "Your KPI submission was reviewed" } : null,
    });
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
  revalidatePath("/dashboard/approvals");
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

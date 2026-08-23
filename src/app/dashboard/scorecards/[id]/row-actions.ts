"use server";

import { revalidatePath } from "next/cache";
import { SupabaseClient } from "@supabase/supabase-js";
import { getCurrentUser } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { computeAutoStatus } from "@/lib/scorecard";
import { calculatePerformanceScores } from "@/lib/performance";
import { writeAuditLog } from "@/lib/audit-log";
import { parseOwnWeightPercent } from "@/lib/cascade-weights";
import { resolveApprovalChain } from "@/lib/approval-hierarchy";
import { isPathOwnedByTenant } from "@/lib/document-extract";

export type EvidenceEntry = { url: string; fileName: string; fileSize: number };
const MAX_EVIDENCE_ENTRIES = 10;

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

const LOCKED_MESSAGE = "This BSC is locked. A company_admin must unlock it before it can be edited.";

async function loadContext(rowId: string) {
  const user = await getCurrentUser();
  if (!user) throw new Error("Not authorized");

  // Writing to scorecard_rows requires the service-role key (see
  // 0033_lock_down_scorecard_writes.sql) — the real authorization here
  // (owner/resolved-manager/locked) is dynamic, TypeScript-side logic RLS
  // can't express, so the explicit tenant check below is what makes this
  // safe, same as every other admin-client caller in this codebase.
  const supabase = createAdminClient();
  const { data: row } = await supabase.from("scorecard_rows").select("*").eq("id", rowId).single();
  if (!row || row.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  const { data: scorecard } = await supabase
    .from("scorecards")
    .select("id, workflow_status, owner_user_id")
    .eq("id", row.scorecard_id)
    .single();
  if (!scorecard) throw new Error("Not authorized");

  return { user, row, scorecard, supabase };
}

type ScorecardWorkflowRow = { workflow_status: string; owner_user_id: string | null };
type CurrentUserLite = { id: string; tenant_id: string | null; role: string };

// Shared by updateScorecardRow's "actual" field and attachKpiEvidence — both
// are performance-data entry on the current submission, gated identically:
// owner during owner_editing (admin only if unowned), the resolved
// immediate manager during pending_manager_review (an explicit grant, not
// implied by role — company_admin only qualifies by independently
// occupying that position), no one during pending_final_review (the
// division head reviews and decides, doesn't edit — matches the spec's own
// role matrix), no one once locked.
async function canEditRowActual(supabase: SupabaseClient, scorecard: ScorecardWorkflowRow, user: CurrentUserLite): Promise<boolean> {
  if (scorecard.workflow_status === "locked") return false;
  if (scorecard.workflow_status === "owner_editing") {
    return scorecard.owner_user_id ? scorecard.owner_user_id === user.id : user.role === "company_admin";
  }
  if (scorecard.workflow_status === "pending_manager_review") {
    if (!scorecard.owner_user_id) return false;
    const chain = await resolveApprovalChain(supabase, user.tenant_id!, scorecard.owner_user_id);
    return chain.firstApproverId === user.id;
  }
  return false; // pending_final_review
}

export async function updateScorecardRow(rowId: string, field: EditableField, value: string) {
  if (!ADMIN_EDITABLE_FIELDS.includes(field)) throw new Error("Invalid field");

  const { user, row, scorecard, supabase } = await loadContext(rowId);
  const isAdmin = user.role === "company_admin";

  let canEdit: boolean;
  if (field === "actual") {
    if (scorecard.workflow_status === "locked") throw new Error(LOCKED_MESSAGE);
    canEdit = await canEditRowActual(supabase, scorecard, user);
  } else {
    // Every other field is scorecard *design* (KPI definition, target,
    // weights, etc.) — company_admin authority there is unrelated to
    // performance-score governance.
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

    await calculatePerformanceScores(supabase, user.tenant_id!);
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
}

// Sets the row's full evidence list (add or remove — the client always
// sends the complete resulting list, same as SupportingDocumentsList's
// pattern elsewhere in this app). Storage upload itself happens client-side
// directly against the company-documents bucket, same as that precedent —
// this action only ever trusts paths it re-verifies belong to the caller's
// own tenant.
export async function attachKpiEvidence(rowId: string, evidence: EvidenceEntry[]) {
  const { user, row, scorecard, supabase } = await loadContext(rowId);
  if (scorecard.workflow_status === "locked") throw new Error(LOCKED_MESSAGE);
  if (!(await canEditRowActual(supabase, scorecard, user))) throw new Error("Not authorized to edit this field");

  if (evidence.length > MAX_EVIDENCE_ENTRIES) {
    throw new Error(`No more than ${MAX_EVIDENCE_ENTRIES} evidence files per KPI.`);
  }
  for (const item of evidence) {
    if (!isPathOwnedByTenant(item.url, user.tenant_id!)) throw new Error("Not authorized");
  }

  const { error } = await supabase.from("scorecard_rows").update({ evidence }).eq("id", rowId);
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: row.tenant_id,
    user_id: user.id,
    action: "attach_kpi_evidence",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: { evidence: row.evidence },
    new_value: { evidence },
  });

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
}

export async function addScorecardRow(scorecardId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  // See loadContext's comment — writing scorecard_rows now requires the
  // service-role key; the explicit tenant check just below is what makes
  // this safe.
  const supabase = createAdminClient();

  // scorecardId is caller-supplied — same class of gap already fixed in
  // column-actions.ts (addScorecardColumn/updateCellValue) and
  // team/actions.ts (assignPosition): without this, a company_admin could
  // insert a row against another tenant's scorecard.
  const { data: scorecard } = await supabase
    .from("scorecards")
    .select("id, workflow_status")
    .eq("id", scorecardId)
    .eq("tenant_id", user.tenant_id)
    .maybeSingle();
  if (!scorecard) throw new Error("Not authorized");
  if (scorecard.workflow_status === "locked") throw new Error(LOCKED_MESSAGE);

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
  const { user, row, scorecard, supabase } = await loadContext(rowId);
  if (user.role !== "company_admin") throw new Error("Not authorized");
  if (scorecard.workflow_status === "locked") throw new Error(LOCKED_MESSAGE);

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

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeAutoStatus } from "@/lib/scorecard";
import { calculatePerformanceScores } from "@/lib/performance";
import { writeAuditLog } from "@/lib/audit-log";

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

  const update: Record<string, unknown> = {
    [field]:
      value === ""
        ? null
        : NUMERIC_FIELDS.includes(field)
          ? Number(value)
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

    // Recalculate performance scores cascade
    await calculatePerformanceScores(supabase, user.tenant_id!);
  }

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
}

export async function addScorecardRow(scorecardId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("scorecard_rows")
    .select("sort_order, strategic_objective, kpi")
    .eq("scorecard_id", scorecardId)
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

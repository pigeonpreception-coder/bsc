"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeAutoStatus } from "@/lib/scorecard";
import { calculatePerformanceScores } from "@/lib/performance";

const ADMIN_EDITABLE_FIELDS = [
  "perspective",
  "strategic_objective",
  "intended_result",
  "kpi",
  "baseline",
  "target",
  "actual",
  "unit",
  "weight",
  "initiative",
  "responsible_person",
  "timeline",
  "status",
  "notes",
] as const;

export type EditableField = (typeof ADMIN_EDITABLE_FIELDS)[number];

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
    [field]: field === "weight" ? (value === "" ? null : Number(value)) : value,
  };

  if (field === "actual") {
    const autoStatus = computeAutoStatus(value, row.target);
    if (autoStatus) update.status = autoStatus;
  }

  const { error } = await supabase.from("scorecard_rows").update(update).eq("id", rowId);
  if (error) throw error;

  await supabase.from("audit_log").insert({
    tenant_id: user.tenant_id,
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
    .select("sort_order")
    .eq("scorecard_id", scorecardId)
    .order("sort_order", { ascending: false })
    .limit(1);

  const nextSortOrder = (existing?.[0]?.sort_order ?? -1) + 1;

  const { data: newRow, error } = await supabase
    .from("scorecard_rows")
    .insert({
      scorecard_id: scorecardId,
      tenant_id: user.tenant_id,
      perspective: "Financial",
      strategic_objective: "New objective",
      kpi: "New KPI",
      sort_order: nextSortOrder,
    })
    .select()
    .single();
  if (error) throw error;

  await supabase.from("audit_log").insert({
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

  await supabase.from("audit_log").insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "delete_row",
    resource_type: "scorecard_row",
    resource_id: rowId,
    old_value: row,
  });

  revalidatePath(`/dashboard/scorecards/${row.scorecard_id}`);
}

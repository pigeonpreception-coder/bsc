"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function addScorecardColumn(scorecardId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id)
    throw new Error("Not authorized");

  const supabase = await createClient();

  // Get next column_order
  const { data: existing } = await supabase
    .from("scorecard_columns")
    .select("column_order")
    .eq("scorecard_id", scorecardId)
    .order("column_order", { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.column_order ?? -1) + 1;

  const columnKey = `custom_${Date.now()}`;
  const { data: newCol, error } = await supabase
    .from("scorecard_columns")
    .insert({
      scorecard_id: scorecardId,
      tenant_id: user.tenant_id,
      column_key: columnKey,
      column_label: "New Column",
      column_order: nextOrder,
      is_visible: true,
    })
    .select()
    .single();
  if (error) throw error;

  await supabase.from("audit_log").insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "add_column",
    resource_type: "scorecard_column",
    resource_id: newCol.id,
    new_value: newCol,
  });

  revalidatePath(`/dashboard/scorecards/${scorecardId}`);
}

export async function deleteScorecardColumn(columnId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin")
    throw new Error("Not authorized");

  const supabase = await createClient();

  const { data: col } = await supabase
    .from("scorecard_columns")
    .select("*")
    .eq("id", columnId)
    .single();
  if (!col || col.tenant_id !== user.tenant_id)
    throw new Error("Not authorized");

  // Delete cell values for this column (cascade should handle, but be explicit)
  await supabase
    .from("scorecard_cell_values")
    .delete()
    .eq("column_id", columnId);

  const { error } = await supabase
    .from("scorecard_columns")
    .delete()
    .eq("id", columnId);
  if (error) throw error;

  await supabase.from("audit_log").insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "delete_column",
    resource_type: "scorecard_column",
    resource_id: columnId,
    old_value: col,
  });

  revalidatePath(`/dashboard/scorecards/${col.scorecard_id}`);
}

export async function renameScorecardColumn(
  columnId: string,
  newLabel: string
) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin")
    throw new Error("Not authorized");

  const supabase = await createClient();

  const { data: col } = await supabase
    .from("scorecard_columns")
    .select("*")
    .eq("id", columnId)
    .single();
  if (!col || col.tenant_id !== user.tenant_id)
    throw new Error("Not authorized");

  const { error } = await supabase
    .from("scorecard_columns")
    .update({ column_label: newLabel })
    .eq("id", columnId);
  if (error) throw error;

  await supabase.from("audit_log").insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "rename_column",
    resource_type: "scorecard_column",
    resource_id: columnId,
    old_value: { column_label: col.column_label },
    new_value: { column_label: newLabel },
  });

  revalidatePath(`/dashboard/scorecards/${col.scorecard_id}`);
}

export async function updateCellValue(
  scorecardId: string,
  rowId: string,
  columnId: string,
  value: string
) {
  const user = await getCurrentUser();
  if (!user || !user.tenant_id) throw new Error("Not authorized");
  if (user.role !== "company_admin") throw new Error("Not authorized");

  const supabase = await createClient();

  const { error } = await supabase.from("scorecard_cell_values").upsert(
    {
      scorecard_id: scorecardId,
      row_id: rowId,
      column_id: columnId,
      tenant_id: user.tenant_id,
      value,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "row_id,column_id" }
  );
  if (error) throw error;

  revalidatePath(`/dashboard/scorecards/${scorecardId}`);
}

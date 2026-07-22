"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FIXED_COLUMN_ORDER } from "@/lib/scorecard";

const FIXED_ORDERS = Object.values(FIXED_COLUMN_ORDER).sort((a, b) => a - b);

// insertBeforeOrder: the order value (a fixed column's constant, or an
// existing custom column's column_order) the new column should land just
// before. The new column's own order is the midpoint between that and
// whatever sits immediately before it in the combined fixed+custom
// sequence — so nothing else ever needs to shift. Omit to append at the end.
export async function addScorecardColumn(scorecardId: string, insertBeforeOrder?: number) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id)
    throw new Error("Not authorized");

  const supabase = await createClient();

  const { data: existing } = await supabase
    .from("scorecard_columns")
    .select("id, column_order, column_label")
    .eq("scorecard_id", scorecardId)
    .order("column_order", { ascending: true });

  const columns = existing ?? [];

  const unfinished = columns.find((c) => c.column_label === "New Column");
  if (unfinished) {
    throw new Error('Rename the "New Column" you already added before adding another one.');
  }

  const allOrders = [...FIXED_ORDERS, ...columns.map((c) => c.column_order)].sort((a, b) => a - b);

  let targetOrder: number;
  if (insertBeforeOrder === undefined) {
    targetOrder = (allOrders[allOrders.length - 1] ?? 0) + 10;
  } else {
    const before = [...allOrders].reverse().find((o) => o < insertBeforeOrder);
    targetOrder =
      before !== undefined ? Math.floor((before + insertBeforeOrder) / 2) : Math.floor(insertBeforeOrder / 2);
  }

  const columnKey = `custom_${Date.now()}`;
  const { data: newCol, error } = await supabase
    .from("scorecard_columns")
    .insert({
      scorecard_id: scorecardId,
      tenant_id: user.tenant_id,
      column_key: columnKey,
      column_label: "New Column",
      column_order: targetOrder,
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

"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export async function updateTaskStatus(
  taskId: string,
  status: "untouched" | "in_progress" | "completed",
  rating?: number,
  notes?: string
) {
  const user = await getCurrentUser();
  if (!user || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();

  const update: Record<string, unknown> = { status };
  if (status === "completed") {
    update.completed_at = new Date().toISOString();
    if (rating) update.completion_rating = rating;
    if (notes) update.completion_notes = notes;
  }

  const { error } = await supabase
    .from("daily_tasks")
    .update(update)
    .eq("id", taskId)
    .eq("user_id", user.id);

  if (error) throw error;

  revalidatePath("/dashboard");
}

export async function markAlertRead(alertId: string) {
  const user = await getCurrentUser();
  if (!user || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();

  let query = supabase
    .from("performance_alerts")
    .update({ is_read: true })
    .eq("id", alertId)
    .eq("tenant_id", user.tenant_id);

  if (user.role !== "company_admin") {
    const { data: myPosition } = await supabase
      .from("org_positions")
      .select("id")
      .eq("tenant_id", user.tenant_id)
      .eq("user_id", user.id)
      .maybeSingle();

    if (!myPosition) throw new Error("Not authorized");
    query = query.eq("position_id", myPosition.id);
  }

  const { error } = await query;
  if (error) throw error;

  revalidatePath("/dashboard");
}

export async function triggerTaskGeneration() {
  const user = await getCurrentUser();
  if (!user || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();

  const { data: myPosition } = await supabase
    .from("org_positions")
    .select("id")
    .eq("tenant_id", user.tenant_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!myPosition) return;

  const { generateDailyTasks } = await import("@/lib/tasks");
  await generateDailyTasks(supabase, user.id, user.tenant_id, myPosition.id);

  revalidatePath("/dashboard");
}

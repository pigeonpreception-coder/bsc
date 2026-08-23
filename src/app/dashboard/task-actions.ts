"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { writeAuditLog } from "@/lib/audit-log";
import { createNotification } from "@/lib/notifications";

const TASK_PRIORITIES = ["high", "medium", "low"] as const;

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

// Assignment authority mirrors the score-approval feature's own reasoning:
// this codebase has no org-chart-based "my direct reports" permission model
// (reports_to_id is only ever used for score-cascade math), so rather than
// invent one, company_admin/manager can assign to any manager/staff in the
// tenant — the same assignee pool the scorecard's responsible_person picker
// already draws from (see scorecards/[id]/page.tsx's teamOptions query).
export async function assignTask(formData: FormData) {
  const user = await getCurrentUser();
  if (!user || !user.tenant_id) throw new Error("Not authorized");
  if (!["company_admin", "manager"].includes(user.role)) throw new Error("Not authorized");

  const assigneeId = String(formData.get("assignee_id") ?? "");
  const title = String(formData.get("task_title") ?? "").trim();
  const description = String(formData.get("task_description") ?? "").trim();
  const priority = String(formData.get("task_priority") ?? "medium");
  const dueDate = String(formData.get("task_date") ?? "");

  if (!assigneeId) throw new Error("Choose who this task is for.");
  if (!title) throw new Error("A task title is required.");
  if (!TASK_PRIORITIES.includes(priority as (typeof TASK_PRIORITIES)[number])) {
    throw new Error("Invalid priority.");
  }

  const supabase = await createClient();

  // assigneeId is caller-supplied — same cross-tenant guard used everywhere
  // else a client-chosen user id gets trusted (updateScorecardRow's
  // responsible_person check, assignPosition's tenant re-check).
  const { data: assignee } = await supabase
    .from("users")
    .select("id, email, full_name")
    .eq("id", assigneeId)
    .eq("tenant_id", user.tenant_id)
    .in("role", ["manager", "staff"])
    .maybeSingle();
  if (!assignee) throw new Error("That person isn't a manager or staff member of this organization.");

  const taskDate = dueDate || new Date().toISOString().split("T")[0];

  const { data: task, error } = await supabase
    .from("daily_tasks")
    .insert({
      tenant_id: user.tenant_id,
      user_id: assigneeId,
      task_title: title,
      task_description: description || null,
      task_priority: priority,
      status: "untouched",
      task_date: taskDate,
      original_date: taskDate,
      rollover_count: 0,
      assigned_by: user.id,
    })
    .select()
    .single();
  if (error) throw error;

  await writeAuditLog(supabase, {
    tenant_id: user.tenant_id,
    user_id: user.id,
    action: "assign_task",
    resource_type: "daily_task",
    resource_id: task.id,
    old_value: null,
    new_value: { assignee_id: assigneeId, task_title: title, task_priority: priority, task_date: taskDate },
  });

  await createNotification(supabase, {
    tenantId: user.tenant_id,
    userId: assigneeId,
    type: "task_assigned",
    message: `${user.full_name || user.email} assigned you a task: "${title}"`,
    link: "/dashboard",
    email: assignee.email ? { to: assignee.email, subject: "You've been assigned a new task" } : null,
  });

  revalidatePath("/dashboard/tasks");
  revalidatePath("/dashboard");
}

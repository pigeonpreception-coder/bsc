import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import AssignTaskForm from "./AssignTaskForm";

const STATUS_LABELS: Record<string, string> = {
  untouched: "Not started",
  in_progress: "In progress",
  completed: "Completed",
};

export default async function TasksPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.tenant_id || !["company_admin", "manager"].includes(user.role)) redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: teamMembers }, { data: assignedTasks }] = await Promise.all([
    supabase
      .from("users")
      .select("id, full_name, email")
      .eq("tenant_id", user.tenant_id)
      .in("role", ["manager", "staff"]),
    supabase
      .from("daily_tasks")
      .select("id, task_title, task_priority, status, task_date, user_id")
      .eq("tenant_id", user.tenant_id)
      .eq("assigned_by", user.id)
      .order("task_date", { ascending: false })
      .limit(50),
  ]);

  const assignees = (teamMembers ?? []).map((m) => ({ value: m.id, label: m.full_name || m.email }));
  const assigneeNameById = new Map((teamMembers ?? []).map((m) => [m.id, m.full_name || m.email]));

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Task Assignment</h1>
        <p className="mt-1 text-sm text-gray-500">Assign a task directly to a manager or staff member.</p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Assign a task</h2>
        <div className="mt-3">
          {assignees.length === 0 ? (
            <p className="text-sm text-gray-400">No manager or staff members to assign to yet.</p>
          ) : (
            <AssignTaskForm assignees={assignees} />
          )}
        </div>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Tasks you&apos;ve assigned</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {(assignedTasks ?? []).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
              <div>
                <span className="text-gray-800">{t.task_title}</span>
                <span className="ml-2 text-xs text-gray-400">
                  for {assigneeNameById.get(t.user_id ?? "") ?? "Unknown"} · due {t.task_date}
                </span>
              </div>
              <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                {STATUS_LABELS[t.status] ?? t.status}
              </span>
            </li>
          ))}
          {(assignedTasks ?? []).length === 0 && (
            <li className="py-2 text-sm text-gray-400">You haven&apos;t assigned any tasks yet.</li>
          )}
        </ul>
      </div>
    </div>
  );
}

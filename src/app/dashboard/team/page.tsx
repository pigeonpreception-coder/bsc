import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import AddTeamMemberForm, { type UnfilledPosition } from "./AddTeamMemberForm";
import AssignPositionForm from "./AssignPositionForm";

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin") redirect("/dashboard");

  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("strategic_plans")
    .select("questionnaire_answers")
    .eq("tenant_id", user.tenant_id)
    .limit(1)
    .maybeSingle();
  const departments: string[] = plan?.questionnaire_answers?.departments ?? [];

  const { data: members } = await supabase
    .from("users")
    .select("id, email, full_name, role, department")
    .eq("tenant_id", user.tenant_id)
    .order("created_at", { ascending: true });

  const { data: positions } = await supabase
    .from("org_positions")
    .select("id, office_department_name, section_name, job_title, first_name, surname, user_id")
    .eq("tenant_id", user.tenant_id)
    .order("sort_order", { ascending: true });

  const positionLabel = (p: { job_title: string; office_department_name: string; section_name: string | null }) =>
    `${p.job_title} — ${p.section_name || p.office_department_name}`;

  const unfilledPositions: UnfilledPosition[] = (positions ?? [])
    .filter((p) => !p.user_id)
    .map((p) => ({ id: p.id, label: positionLabel(p) }));

  const positionIdByUserId = new Map((positions ?? []).filter((p) => p.user_id).map((p) => [p.user_id as string, p.id]));
  const positionLabelById = new Map((positions ?? []).map((p) => [p.id, positionLabel(p)]));

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-navy">Team</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Team members</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {(members ?? []).map((m) => {
            const currentPositionId = positionIdByUserId.get(m.id) ?? null;
            const options = currentPositionId
              ? [{ id: currentPositionId, label: positionLabelById.get(currentPositionId) ?? "" }, ...unfilledPositions]
              : unfilledPositions;
            return (
              <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm">
                <span>{m.full_name || m.email}</span>
                <span className="flex flex-wrap items-center gap-2">
                  {m.department && (
                    <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{m.department}</span>
                  )}
                  <span className="rounded bg-navy/10 px-2 py-0.5 text-xs capitalize text-navy">
                    {m.role.replace("_", " ")}
                  </span>
                  <AssignPositionForm userId={m.id} currentPositionId={currentPositionId} options={options} />
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Add team member</h2>
        <AddTeamMemberForm departments={departments} positions={unfilledPositions} />
      </div>
    </div>
  );
}

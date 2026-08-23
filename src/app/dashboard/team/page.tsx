import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import UserStatusControl from "@/components/UserStatusControl";
import AddTeamMemberForm, { type UnfilledPosition } from "./AddTeamMemberForm";
import AssignPositionForm from "./AssignPositionForm";
import { setTeamMemberStatus } from "./actions";

export default async function TeamPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin") redirect("/dashboard");

  const supabase = await createClient();

  const { data: members } = await supabase
    .from("users")
    .select("id, email, full_name, role, department, status")
    .eq("tenant_id", user.tenant_id)
    .order("created_at", { ascending: true });

  const { data: positions } = await supabase
    .from("org_positions")
    .select("id, position_type, office_department_name, section_name, job_title, first_name, surname, user_id")
    .eq("tenant_id", user.tenant_id)
    .order("sort_order", { ascending: true });

  // The org chart is the real source of department/section names — not the
  // onboarding questionnaire's free-text departments list, which can go
  // stale or disagree with what was actually set up in the Org Wizard (see
  // the current-state assessment's duplicate-department finding).
  const DEPARTMENT_POSITION_TYPES = new Set(["non_executive", "section_supervisor"]);
  const departments = [
    ...new Set(
      (positions ?? [])
        .filter((p) => DEPARTMENT_POSITION_TYPES.has(p.position_type))
        .map((p) => (p.position_type === "section_supervisor" ? p.section_name : p.office_department_name))
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort();

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
                  {m.id !== user.id && ["manager", "staff", "viewer"].includes(m.role) && (
                    <UserStatusControl userId={m.id} currentStatus={m.status} updateStatus={setTeamMemberStatus} />
                  )}
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

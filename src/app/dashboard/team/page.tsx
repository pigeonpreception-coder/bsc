import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import AddTeamMemberForm from "./AddTeamMemberForm";

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

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="text-xl font-semibold text-navy">Team</h1>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Team members</h2>
        <ul className="mt-3 divide-y divide-gray-100">
          {(members ?? []).map((m) => (
            <li key={m.id} className="flex items-center justify-between py-2 text-sm">
              <span>{m.full_name || m.email}</span>
              <span className="flex gap-2">
                {m.department && (
                  <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{m.department}</span>
                )}
                <span className="rounded bg-navy/10 px-2 py-0.5 text-xs capitalize text-navy">
                  {m.role.replace("_", " ")}
                </span>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="text-sm font-semibold text-navy">Add team member</h2>
        <AddTeamMemberForm departments={departments} />
      </div>
    </div>
  );
}

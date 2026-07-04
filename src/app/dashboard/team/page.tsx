import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { addTeamMember } from "./actions";

const inputClass =
  "mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-gold focus:outline-none focus:ring-1 focus:ring-gold";

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
        <form action={addTeamMember} className="mt-4 space-y-4">
          <div>
            <label htmlFor="full_name" className="block text-sm font-medium text-gray-700">
              Full name
            </label>
            <input id="full_name" name="full_name" type="text" className={inputClass} />
          </div>
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-700">
              Email
            </label>
            <input id="email" name="email" type="email" required className={inputClass} />
          </div>
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-gray-700">
              Temporary password
            </label>
            <input id="password" name="password" type="text" required minLength={8} className={inputClass} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label htmlFor="role" className="block text-sm font-medium text-gray-700">
                Role
              </label>
              <select id="role" name="role" defaultValue="staff" className={inputClass}>
                <option value="manager">Manager</option>
                <option value="staff">Staff</option>
                <option value="viewer">Viewer</option>
              </select>
            </div>
            <div>
              <label htmlFor="department" className="block text-sm font-medium text-gray-700">
                Department
              </label>
              {departments.length > 0 ? (
                <select id="department" name="department" required className={inputClass}>
                  <option value="">Select…</option>
                  {departments.map((d) => (
                    <option key={d} value={d}>
                      {d}
                    </option>
                  ))}
                </select>
              ) : (
                <input id="department" name="department" type="text" required className={inputClass} />
              )}
            </div>
          </div>
          <button
            type="submit"
            className="w-full rounded-md bg-navy px-3 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            Add Team Member
          </button>
        </form>
      </div>
    </div>
  );
}

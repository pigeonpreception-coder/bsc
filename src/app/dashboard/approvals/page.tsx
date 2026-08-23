import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import ApprovalControls from "./ApprovalControls";

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin") redirect("/dashboard");

  const supabase = await createClient();

  const { data: rows } = await supabase
    .from("scorecard_rows")
    .select("id, scorecard_id, kpi, actual, unit, responsible_person")
    .eq("tenant_id", user.tenant_id)
    .eq("approval_status", "pending_approval")
    .order("id", { ascending: true });

  const pending = rows ?? [];

  const scorecardIds = [...new Set(pending.map((r) => r.scorecard_id))];
  const submitterIds = [...new Set(pending.map((r) => r.responsible_person).filter((id): id is string => Boolean(id)))];

  const [{ data: scorecards }, { data: submitters }] = await Promise.all([
    scorecardIds.length
      ? supabase.from("scorecards").select("id, name").in("id", scorecardIds)
      : Promise.resolve({ data: [] as { id: string; name: string }[] }),
    submitterIds.length
      ? supabase.from("users").select("id, full_name, email").in("id", submitterIds)
      : Promise.resolve({ data: [] as { id: string; full_name: string | null; email: string }[] }),
  ]);

  const scorecardNameById = new Map((scorecards ?? []).map((s) => [s.id, s.name]));
  const submitterById = new Map((submitters ?? []).map((s) => [s.id, s.full_name || s.email]));

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-navy">Score Approvals</h1>
        <p className="mt-1 text-sm text-gray-500">
          KPI values submitted by managers and staff wait here until you approve or reject them.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white">
        {pending.length === 0 ? (
          <p className="p-6 text-sm text-gray-400">Nothing waiting on review.</p>
        ) : (
          <ul className="divide-y divide-gray-100">
            {pending.map((row) => (
              <li key={row.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div>
                  <Link href={`/dashboard/scorecards/${row.scorecard_id}`} className="text-sm font-medium text-navy hover:underline">
                    {scorecardNameById.get(row.scorecard_id) ?? "Scorecard"}
                  </Link>
                  <p className="mt-0.5 text-sm text-gray-700">{row.kpi}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Submitted value: <span className="font-semibold text-gray-700">{row.actual ?? "—"}</span>
                    {row.unit ? ` ${row.unit}` : ""}
                    {row.responsible_person && ` · by ${submitterById.get(row.responsible_person) ?? "Unknown"}`}
                  </p>
                </div>
                <ApprovalControls rowId={row.id} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

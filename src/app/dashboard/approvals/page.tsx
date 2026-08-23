import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listPendingApprovalsForUser, type OrgPositionLite } from "@/lib/approval-hierarchy";
import ApprovalControls from "./ApprovalControls";

const PENDING_STATUSES = ["submitted", "first_approved", "amendment_requested"];

const SECTION_META = {
  first: { title: "Awaiting your first-level review", empty: "Nothing waiting on your first-level review." },
  final: { title: "Awaiting your final approval", empty: "Nothing waiting on your final approval." },
  reopen: { title: "Amendment requests awaiting your authorization", empty: "No amendment requests waiting on you." },
} as const;

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.tenant_id) redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: rows }, { data: positions }] = await Promise.all([
    supabase
      .from("scorecard_rows")
      .select("id, scorecard_id, kpi, actual, unit, responsible_person, approval_status, amendment_reason")
      .eq("tenant_id", user.tenant_id)
      .in("approval_status", PENDING_STATUSES)
      .order("id", { ascending: true }),
    supabase.from("org_positions").select("id, user_id, reports_to_id, position_type").eq("tenant_id", user.tenant_id),
  ]);

  const allRows = rows ?? [];
  // Score-approval authority is entirely position-based (see
  // src/lib/approval-hierarchy.ts) — this page shows only the rows the API
  // would actually accept from this specific user, not a role-gated view.
  const entries = listPendingApprovalsForUser((positions ?? []) as OrgPositionLite[], allRows, user.id);
  const rowById = new Map(allRows.map((r) => [r.id, r]));

  const scorecardIds = [...new Set(allRows.map((r) => r.scorecard_id))];
  const submitterIds = [...new Set(allRows.map((r) => r.responsible_person).filter((id): id is string => Boolean(id)))];

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

  const byLevel = { first: entries.filter((e) => e.level === "first"), final: entries.filter((e) => e.level === "final"), reopen: entries.filter((e) => e.level === "reopen") };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Score Approvals</h1>
        <p className="mt-1 text-sm text-gray-500">
          Approval follows your organization&apos;s reporting hierarchy — you&apos;ll only see items you&apos;re authorized to act on.
        </p>
      </div>

      {(["first", "final", "reopen"] as const).map((level) => {
        const meta = SECTION_META[level];
        const items = byLevel[level];
        return (
          <div key={level} className="rounded-lg border border-gray-200 bg-white">
            <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-navy">{meta.title}</h2>
            {items.length === 0 ? (
              <p className="p-6 text-sm text-gray-400">{meta.empty}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map(({ rowId }) => {
                  const row = rowById.get(rowId);
                  if (!row) return null;
                  return (
                    <li key={rowId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <Link href={`/dashboard/scorecards/${row.scorecard_id}`} className="text-sm font-medium text-navy hover:underline">
                          {scorecardNameById.get(row.scorecard_id) ?? "Scorecard"}
                        </Link>
                        <p className="mt-0.5 text-sm text-gray-700">{row.kpi}</p>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {level === "reopen" ? (
                            <>Amendment reason: {row.amendment_reason ?? "—"}</>
                          ) : (
                            <>
                              Submitted value: <span className="font-semibold text-gray-700">{row.actual ?? "—"}</span>
                              {row.unit ? ` ${row.unit}` : ""}
                            </>
                          )}
                          {row.responsible_person && ` · owner: ${submitterById.get(row.responsible_person) ?? "Unknown"}`}
                        </p>
                      </div>
                      <ApprovalControls rowId={row.id} kind={level} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

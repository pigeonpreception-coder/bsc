import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeProgressPercent, PERSPECTIVES } from "@/lib/scorecard";
import PerformanceTrendChart from "./PerformanceTrendChart";

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default async function DashboardHomePage() {
  const user = await getCurrentUser();
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("strategic_plans")
    .select("id, company_name")
    .eq("tenant_id", user?.tenant_id)
    .limit(1)
    .maybeSingle();

  if (!plan) {
    if (user?.role === "company_admin") {
      return (
        <div>
          <h1 className="text-xl font-semibold text-navy">Welcome{user.full_name ? `, ${user.full_name}` : ""}</h1>
          <p className="mt-2 text-sm text-gray-500">
            Let&apos;s set up your company&apos;s strategic plan. Answer a short guided questionnaire and our AI
            advisor will draft your Corporate Strategic Plan and Balanced Scorecards.
          </p>
          <Link
            href="/dashboard/questionnaire"
            className="mt-4 inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            Start Questionnaire
          </Link>
        </div>
      );
    }
    return (
      <div>
        <h1 className="text-xl font-semibold text-navy">Welcome{user?.full_name ? `, ${user.full_name}` : ""}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your strategic plan and scorecards will appear here once your company has completed setup.
        </p>
      </div>
    );
  }

  const { data: corporateScorecard } = await supabase
    .from("scorecards")
    .select("id, name")
    .eq("plan_id", plan.id)
    .eq("scorecard_type", "corporate")
    .maybeSingle();

  if (!corporateScorecard) {
    return (
      <div>
        <h1 className="text-xl font-semibold text-navy">{plan.company_name}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Strategic plan created. Balanced Scorecards haven&apos;t been generated yet.
        </p>
        {user?.role === "company_admin" && (
          <Link
            href={`/dashboard/plan/${plan.id}`}
            className="mt-4 inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            Go to Strategic Plan
          </Link>
        )}
      </div>
    );
  }

  const { data: corporateRows } = await supabase
    .from("scorecard_rows")
    .select("id, perspective, strategic_objective, kpi, actual, target, status")
    .eq("scorecard_id", corporateScorecard.id);

  const { data: departmentalScorecards } = await supabase
    .from("scorecards")
    .select("id, name, department_name, scorecard_rows(actual, target)")
    .eq("plan_id", plan.id)
    .eq("scorecard_type", "departmental");

  const { data: flaggedRows } = await supabase
    .from("scorecard_rows")
    .select("id, strategic_objective, kpi, actual, target, status, scorecards(name)")
    .eq("tenant_id", user!.tenant_id!)
    .in("status", ["at_risk", "off_track"]);

  const { data: snapshots } = await supabase
    .from("performance_snapshots")
    .select("snapshot_date, actual_value, scorecard_row_id, created_at")
    .in("scorecard_row_id", (corporateRows ?? []).map((r) => r.id))
    .order("created_at", { ascending: true });

  const rows = corporateRows ?? [];
  const rowProgress = rows
    .map((r) => computeProgressPercent(r.actual, r.target))
    .filter((p): p is number => p !== null)
    .map((p) => Math.min(p, 100));
  const overallCompletion = average(rowProgress);

  const perspectiveBreakdown = PERSPECTIVES.map((perspective) => {
    const perspectiveRows = rows.filter((r) => r.perspective === perspective);
    const progress = perspectiveRows
      .map((r) => computeProgressPercent(r.actual, r.target))
      .filter((p): p is number => p !== null)
      .map((p) => Math.min(p, 100));
    return { perspective, completion: average(progress), rowCount: perspectiveRows.length };
  });

  const departmentSummary = (departmentalScorecards ?? []).map((sc) => {
    const deptRows = (sc.scorecard_rows ?? []) as { actual: string | null; target: string | null }[];
    const progress = deptRows
      .map((r) => computeProgressPercent(r.actual, r.target))
      .filter((p): p is number => p !== null)
      .map((p) => Math.min(p, 100));
    return { name: sc.department_name ?? sc.name, completion: average(progress) };
  });

  const targetByRow = new Map(rows.map((r) => [r.id, r.target]));
  const byDate = new Map<string, number[]>();
  for (const snap of snapshots ?? []) {
    const target = targetByRow.get(snap.scorecard_row_id);
    const pct = computeProgressPercent(snap.actual_value, target ?? null);
    if (pct === null) continue;
    const list = byDate.get(snap.snapshot_date) ?? [];
    list.push(Math.min(pct, 100));
    byDate.set(snap.snapshot_date, list);
  }
  const trendData = Array.from(byDate.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, values]) => ({ date, completion: average(values) ?? 0 }));

  const lastUpdated = (snapshots ?? []).length > 0 ? snapshots![snapshots!.length - 1].created_at : null;

  return (
    <div className="space-y-6">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold text-navy">{plan.company_name} — Performance Dashboard</h1>
        {lastUpdated && (
          <span className="text-xs text-gray-400">Last updated {new Date(lastUpdated).toLocaleString()}</span>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-lg border border-gray-200 bg-white p-4">
          <p className="text-xs uppercase text-gray-500">Overall Completion</p>
          <p className="mt-1 text-2xl font-bold text-navy">
            {overallCompletion !== null ? `${overallCompletion.toFixed(0)}%` : "—"}
          </p>
        </div>
        {perspectiveBreakdown.map((p) => (
          <div key={p.perspective} className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">{p.perspective}</p>
            <p className="mt-1 text-2xl font-bold text-navy">
              {p.completion !== null ? `${p.completion.toFixed(0)}%` : "—"}
            </p>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <h2 className="mb-3 text-sm font-semibold text-navy">Performance Trend</h2>
        <PerformanceTrendChart data={trendData} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-navy">Department Performance</h2>
          {departmentSummary.length > 0 ? (
            <ul className="space-y-2">
              {departmentSummary.map((d) => (
                <li key={d.name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{d.name}</span>
                  <span className="font-medium text-navy">
                    {d.completion !== null ? `${d.completion.toFixed(0)}%` : "No data"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">No departmental scorecards yet.</p>
          )}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-navy">
            KPIs Needing Attention ({(flaggedRows ?? []).length})
          </h2>
          {(flaggedRows ?? []).length > 0 ? (
            <ul className="space-y-3">
              {(flaggedRows ?? []).map((row) => (
                <li key={row.id} className="text-sm">
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">{row.kpi}</span>
                    <span
                      className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        row.status === "off_track" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                      }`}
                    >
                      {row.status.replace("_", " ")}
                    </span>
                  </div>
                  <p className="text-xs text-gray-400">
                    {(row.scorecards as unknown as { name: string } | null)?.name} — Actual: {row.actual ?? "—"} /
                    Target: {row.target ?? "—"}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">Nothing flagged — everything on track.</p>
          )}
        </div>
      </div>
    </div>
  );
}

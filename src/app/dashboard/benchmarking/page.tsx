import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { projectScore, trendDirection, computeLinearTrend, type TrendPoint } from "@/lib/benchmarking";

const TREND_WINDOW_DAYS = 30;
const PROJECTION_DAYS = 30;

const TREND_ICON: Record<string, string> = { up: "↑", down: "↓", flat: "→" };
const TREND_COLOR: Record<string, string> = { up: "text-green-600", down: "text-red-600", flat: "text-gray-400" };

export default async function BenchmarkingPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.role !== "company_admin" || !user.tenant_id) redirect("/dashboard");

  const supabase = await createClient();
  const tenantId = user.tenant_id;

  const windowStart = new Date();
  windowStart.setDate(windowStart.getDate() - TREND_WINDOW_DAYS);

  const [{ data: scores }, { data: positions }, { data: history }] = await Promise.all([
    supabase
      .from("performance_scores")
      .select("position_id, composite_performance_score, financial_score, customer_score, internal_process_score, learning_growth_score")
      .eq("tenant_id", tenantId),
    supabase
      .from("org_positions")
      .select("id, office_department_name, section_name, job_title, position_type")
      .eq("tenant_id", tenantId)
      .neq("position_type", "board"),
    supabase
      .from("performance_history")
      .select("position_id, snapshot_date, composite_performance_score")
      .eq("tenant_id", tenantId)
      .gte("snapshot_date", windowStart.toISOString().split("T")[0])
      .order("snapshot_date", { ascending: true }),
  ]);

  const historyByPosition = new Map<string, TrendPoint[]>();
  for (const h of history ?? []) {
    if (h.composite_performance_score === null) continue;
    const list = historyByPosition.get(h.position_id) ?? [];
    list.push({ date: h.snapshot_date, value: Number(h.composite_performance_score) });
    historyByPosition.set(h.position_id, list);
  }

  const positionById = new Map((positions ?? []).map((p) => [p.id, p]));

  const rows = (scores ?? [])
    .filter((s) => s.position_id && positionById.has(s.position_id))
    .map((s) => {
      const position = positionById.get(s.position_id!)!;
      const points = historyByPosition.get(s.position_id!) ?? [];
      const trend = computeLinearTrend(points);
      return {
        positionId: s.position_id!,
        label: position.section_name || position.office_department_name,
        jobTitle: position.job_title,
        composite: Number(s.composite_performance_score ?? 0),
        financial: Number(s.financial_score ?? 0),
        customer: Number(s.customer_score ?? 0),
        internalProcess: Number(s.internal_process_score ?? 0),
        learningGrowth: Number(s.learning_growth_score ?? 0),
        direction: trend ? trendDirection(trend.slope) : "flat",
        projected: points.length >= 2 ? projectScore(points, PROJECTION_DAYS) : null,
      };
    })
    .sort((a, b) => b.composite - a.composite);

  const tenantAverage = rows.length > 0 ? rows.reduce((sum, r) => sum + r.composite, 0) / rows.length : 0;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">Benchmarking</h1>
        <p className="mt-1 text-sm text-gray-500">
          How every department and position compares on composite performance score, and where the last {TREND_WINDOW_DAYS} days of
          history point next.
        </p>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <p className="text-sm text-gray-700">
          Organisation average: <span className="font-semibold text-navy">{tenantAverage.toFixed(1)}%</span>
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
        <table className="w-full min-w-[720px] text-xs">
          <thead className="bg-gray-50 text-left uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">#</th>
              <th className="px-3 py-2">Position</th>
              <th className="px-3 py-2">Department</th>
              <th className="px-3 py-2">Composite</th>
              <th className="px-3 py-2">vs. average</th>
              <th className="px-3 py-2">Financial</th>
              <th className="px-3 py-2">Customer</th>
              <th className="px-3 py-2">Internal</th>
              <th className="px-3 py-2">Capacity</th>
              <th className="px-3 py-2">Trend</th>
              <th className="px-3 py-2">Projected (+{PROJECTION_DAYS}d)</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r, i) => {
              const delta = r.composite - tenantAverage;
              return (
                <tr key={r.positionId}>
                  <td className="px-3 py-2 text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2 text-gray-800">{r.jobTitle}</td>
                  <td className="px-3 py-2 text-gray-600">{r.label}</td>
                  <td className="px-3 py-2 font-semibold text-navy">{r.composite.toFixed(1)}%</td>
                  <td className={`px-3 py-2 ${delta >= 0 ? "text-green-600" : "text-red-600"}`}>
                    {delta >= 0 ? "+" : ""}
                    {delta.toFixed(1)}
                  </td>
                  <td className="px-3 py-2 text-gray-600">{r.financial.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-gray-600">{r.customer.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-gray-600">{r.internalProcess.toFixed(0)}%</td>
                  <td className="px-3 py-2 text-gray-600">{r.learningGrowth.toFixed(0)}%</td>
                  <td className={`px-3 py-2 text-sm font-semibold ${TREND_COLOR[r.direction]}`}>{TREND_ICON[r.direction]}</td>
                  <td className="px-3 py-2 text-gray-600">{r.projected === null ? "—" : `${r.projected.toFixed(1)}%`}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={11} className="px-3 py-6 text-center text-gray-400">
                  No scored positions yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-gray-400">
        Projections are a simple linear trend fitted to each position&apos;s last {TREND_WINDOW_DAYS} days of daily
        snapshots — a directional estimate, not a statistical forecast. Positions with fewer than 2 days of history
        show no projection.
      </p>
    </div>
  );
}

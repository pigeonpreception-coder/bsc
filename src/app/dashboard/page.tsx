import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { computeProgressPercent, perspectiveSortIndex } from "@/lib/scorecard";
import PerformanceTrendChart from "./PerformanceTrendChart";
import { PerformanceGauge, ScoreCard, KpiStatusSummary } from "./PerformanceWidgets";
import TaskList from "./TaskList";
import AlertsPanel from "./AlertsPanel";

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default async function DashboardHomePage() {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const { data: plan } = await supabase
    .from("strategic_plans")
    .select("id, company_name, status")
    .eq("tenant_id", user.tenant_id)
    .limit(1)
    .maybeSingle();

  // ─── No plan yet ────────────────────────────────────────
  if (!plan) {
    if (user.role === "company_admin") {
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
        <h1 className="text-xl font-semibold text-navy">Welcome{user.full_name ? `, ${user.full_name}` : ""}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Your strategic plan and scorecards will appear here once your company has completed setup.
        </p>
      </div>
    );
  }

  // ─── No corporate scorecard yet ─────────────────────────
  const { data: corporateScorecard } = await supabase
    .from("scorecards")
    .select("id, name")
    .eq("plan_id", plan.id)
    .eq("scorecard_type", "corporate")
    .maybeSingle();

  if (!corporateScorecard) {
    const { count: orgCount } = await supabase
      .from("org_positions")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", user.tenant_id!);

    return (
      <div>
        <h1 className="text-xl font-semibold text-navy">{plan.company_name}</h1>
        <p className="mt-2 text-sm text-gray-500">
          Strategic plan created. {!orgCount ? "Set up your organisational hierarchy to generate cascaded Balanced Scorecards." : "Balanced Scorecards haven't been generated yet."}
        </p>
        {user.role === "company_admin" && (
          <div className="mt-4 flex gap-3">
            <Link href={`/dashboard/plan/${plan.id}`} className="inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light">
              Go to Strategic Plan
            </Link>
            {plan.status === "active" && (
              <Link href="/dashboard/onboarding" className="inline-block rounded-md border border-gold bg-gold/10 px-4 py-2 text-sm font-semibold text-navy hover:bg-gold/20">
                Set Up Organisation
              </Link>
            )}
          </div>
        )}
      </div>
    );
  }

  // ─── Find user's position ───────────────────────────────
  // Try to find position via position_scorecards → match scorecard owner
  const { data: userPositionLink } = await supabase
    .from("position_scorecards")
    .select("position_id, scorecard_id, scorecard_scope")
    .eq("tenant_id", user.tenant_id!)
    .limit(100);

  // Match by finding a position whose name matches or a scorecard owned by this user
  const { data: userOwnedScorecard } = await supabase
    .from("scorecards")
    .select("id")
    .eq("owner_user_id", user.id)
    .eq("scorecard_type", "individual")
    .maybeSingle();

  let userPositionId: string | null = null;
  if (userOwnedScorecard && userPositionLink) {
    const link = userPositionLink.find((l) => l.scorecard_id === userOwnedScorecard.id);
    if (link) {
      userPositionId = link.position_id;
    }
  }

  // ─── Load performance data ─────────────────────────────
  // Load user's performance score
  const { data: myScore } = userPositionId
    ? await supabase
        .from("performance_scores")
        .select("*")
        .eq("position_id", userPositionId)
        .maybeSingle()
    : { data: null };

  // Load my position info
  const { data: myPosition } = userPositionId
    ? await supabase
        .from("org_positions")
        .select("*")
        .eq("id", userPositionId)
        .single()
    : { data: null };

  // ─── Levels below ──────────────────────────────────────
  type SubordinateScore = { name: string; score: number; positionType: string };
  const levelsBelow: SubordinateScore[] = [];

  if (userPositionId) {
    // Find direct children positions
    const { data: childPositions } = await supabase
      .from("org_positions")
      .select("id, office_department_name, section_name, position_type")
      .eq("reports_to_id", userPositionId);

    if (childPositions) {
      for (const child of childPositions) {
        const { data: childScore } = await supabase
          .from("performance_scores")
          .select("composite_performance_score")
          .eq("position_id", child.id)
          .maybeSingle();

        levelsBelow.push({
          name: child.section_name || child.office_department_name,
          score: childScore?.composite_performance_score ?? 0,
          positionType: child.position_type,
        });
      }
    }
  }

  // ─── Today's tasks ─────────────────────────────────────
  const today = new Date().toISOString().split("T")[0];
  const { data: todaysTasks } = await supabase
    .from("daily_tasks")
    .select("*")
    .eq("user_id", user.id)
    .eq("task_date", today)
    .order("task_priority", { ascending: true });

  // ─── Alerts ────────────────────────────────────────────
  const { data: alerts } = await supabase
    .from("performance_alerts")
    .select("*")
    .eq("tenant_id", user.tenant_id!)
    .eq("is_read", false)
    .order("created_at", { ascending: false })
    .limit(10);

  // Filter alerts: show only relevant ones
  // For non-admin users, show only their position's alerts
  const filteredAlerts = (alerts ?? []).filter((a) => {
    if (user.role === "company_admin") return true;
    return a.position_id === userPositionId;
  });

  // ─── Weekly advisory ───────────────────────────────────
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1);
  const weekStartStr = weekStart.toISOString().split("T")[0];
  const isMonday = new Date().getDay() === 1;

  const { data: advisory } = userPositionId
    ? await supabase
        .from("weekly_advisories")
        .select("advisory_text")
        .eq("position_id", userPositionId)
        .eq("week_start", weekStartStr)
        .maybeSingle()
    : { data: null };

  // ─── Performance trend (last 30 days) ──────────────────
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const { data: trendHistory } = userPositionId
    ? await supabase
        .from("performance_history")
        .select("snapshot_date, composite_performance_score")
        .eq("position_id", userPositionId)
        .gte("snapshot_date", thirtyDaysAgo.toISOString().split("T")[0])
        .order("snapshot_date", { ascending: true })
    : { data: null };

  const trendData = (trendHistory ?? []).map((h) => ({
    date: h.snapshot_date,
    completion: Number(h.composite_performance_score ?? 0),
  }));

  // ─── Fallback: Corporate-level dashboard for admins with no position ──
  if (!userPositionId && user.role === "company_admin") {
    // Show the old corporate dashboard
    const { data: corporateRows } = await supabase
      .from("scorecard_rows")
      .select("id, perspective, strategic_objective, kpi, actual, target, lower_is_better, status")
      .eq("scorecard_id", corporateScorecard.id);

    const { data: departmentalScorecards } = await supabase
      .from("scorecards")
      .select("id, name, department_name, scorecard_rows(actual, target, lower_is_better)")
      .eq("plan_id", plan.id)
      .in("scorecard_type", ["departmental", "executive"]);

    const rows = corporateRows ?? [];
    const rowProgress = rows
      .map((r) => computeProgressPercent(r.actual, r.target, r.lower_is_better ?? false))
      .filter((p): p is number => p !== null)
      .map((p) => Math.min(p, 100));
    const overallCompletion = average(rowProgress);

    const perspectivesInUse = [...new Set(rows.map((r) => r.perspective))].sort(
      (a, b) => perspectiveSortIndex(a) - perspectiveSortIndex(b),
    );
    const perspectiveBreakdown = perspectivesInUse.map((perspective) => {
      const perspectiveRows = rows.filter((r) => r.perspective === perspective);
      const progress = perspectiveRows
        .map((r) => computeProgressPercent(r.actual, r.target, r.lower_is_better ?? false))
        .filter((p): p is number => p !== null)
        .map((p) => Math.min(p, 100));
      return { perspective, completion: average(progress) };
    });

    const departmentSummary = (departmentalScorecards ?? []).map((sc) => {
      const deptRows = (sc.scorecard_rows ?? []) as {
        actual: string | null;
        target: string | null;
        lower_is_better: boolean | null;
      }[];
      const progress = deptRows
        .map((r) => computeProgressPercent(r.actual, r.target, r.lower_is_better ?? false))
        .filter((p): p is number => p !== null)
        .map((p) => Math.min(p, 100));
      return { name: sc.department_name ?? sc.name, completion: average(progress) };
    });

    return (
      <div className="space-y-6">
        <h1 className="text-xl font-semibold text-navy">{plan.company_name} — Corporate Performance Dashboard</h1>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <div className="rounded-lg border border-gray-200 bg-white p-4">
            <p className="text-xs uppercase text-gray-500">Overall</p>
            <p className="mt-1 text-2xl font-bold text-navy">{overallCompletion !== null ? `${overallCompletion.toFixed(0)}%` : "—"}</p>
          </div>
          {perspectiveBreakdown.map((p) => (
            <ScoreCard key={p.perspective} label={p.perspective} score={p.completion} />
          ))}
        </div>

        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-navy">Branch / Department Performance</h2>
          {departmentSummary.length > 0 ? (
            <ul className="space-y-2">
              {departmentSummary.map((d) => (
                <li key={d.name} className="flex items-center justify-between text-sm">
                  <span className="text-gray-700">{d.name}</span>
                  <span className={`font-medium ${(d.completion ?? 0) >= 90 ? "text-green-600" : (d.completion ?? 0) >= 70 ? "text-amber-600" : "text-red-600"}`}>
                    {d.completion !== null ? `${d.completion.toFixed(0)}%` : "No data"}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-gray-400">No scorecards generated yet.</p>
          )}
        </div>

        {filteredAlerts.length > 0 && <AlertsPanel alerts={filteredAlerts} />}
      </div>
    );
  }

  // ─── Full Role-Aware Dashboard ─────────────────────────

  const positionLabel = myPosition
    ? `${myPosition.first_name ?? ""} ${myPosition.surname ?? ""} — ${myPosition.job_title}`
    : user.full_name ?? user.email;

  const deptLabel = myPosition?.office_department_name ?? "";

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy">{positionLabel}</h1>
          <p className="text-sm text-gray-500">{deptLabel} — {new Date().toLocaleDateString("en-ZA", { weekday: "long", year: "numeric", month: "long", day: "numeric" })}</p>
        </div>
      </div>

      {/* Weekly Advisory */}
      {isMonday && advisory && (
        <div className="rounded-lg border-2 border-gold bg-gold/5 p-4">
          <h2 className="mb-2 text-sm font-semibold text-navy">📋 Weekly Performance Advisory</h2>
          <p className="text-sm text-gray-700">{advisory.advisory_text}</p>
        </div>
      )}

      {/* Performance Gauges */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-6">
          <PerformanceGauge
            score={myScore?.own_performance_score ?? 0}
            label="My Performance"
          />
        </div>
        {levelsBelow.length > 0 && (
          <div className="flex items-center justify-center rounded-lg border border-gray-200 bg-white p-6">
            <PerformanceGauge
              score={myScore?.composite_performance_score ?? 0}
              label="Team Composite"
            />
          </div>
        )}
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <KpiStatusSummary
            onTrack={myScore?.kpis_on_track ?? 0}
            atRisk={myScore?.kpis_at_risk ?? 0}
            offTrack={myScore?.kpis_off_track ?? 0}
          />
        </div>
      </div>

      {/* Perspective Breakdown */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <ScoreCard label="Financial" score={myScore?.financial_score ?? null} size="small" />
        <ScoreCard label="Customer" score={myScore?.customer_score ?? null} size="small" />
        <ScoreCard label="Internal Process" score={myScore?.internal_process_score ?? null} size="small" />
        <ScoreCard label="Learning & Growth" score={myScore?.learning_growth_score ?? null} size="small" />
      </div>

      {/* Performance Trend */}
      {trendData.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-navy">Performance Trend (Last 30 Days)</h2>
          <PerformanceTrendChart data={trendData} />
        </div>
      )}

      {/* Today's Tasks */}
      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-navy">
            Today&apos;s Tasks ({(todaysTasks ?? []).filter((t) => t.status !== "completed").length} pending)
          </h2>
          <span className="text-xs text-gray-400">
            {(todaysTasks ?? []).filter((t) => t.status === "completed").length} completed
          </span>
        </div>
        <TaskList tasks={(todaysTasks ?? []).map((t) => ({
          id: t.id,
          task_title: t.task_title,
          task_description: t.task_description,
          task_priority: t.task_priority,
          status: t.status,
          linked_objective: t.linked_objective,
          linked_kpi: t.linked_kpi,
          rollover_count: t.rollover_count,
          completed_at: t.completed_at,
          completion_rating: t.completion_rating,
        }))} />
      </div>

      {/* Levels Below */}
      {levelsBelow.length > 0 && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-navy">Levels Below</h2>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {levelsBelow.map((sub) => {
              const color = sub.score >= 90 ? "border-green-400 bg-green-50" : sub.score >= 70 ? "border-amber-400 bg-amber-50" : "border-red-400 bg-red-50";
              const textColor = sub.score >= 90 ? "text-green-700" : sub.score >= 70 ? "text-amber-700" : "text-red-700";
              return (
                <div key={sub.name} className={`rounded-lg border-l-4 p-3 ${color}`}>
                  <p className="text-sm font-medium text-gray-700">{sub.name}</p>
                  <p className={`text-lg font-bold ${textColor}`}>{sub.score.toFixed(0)}%</p>
                  <p className="text-xs text-gray-400 capitalize">{sub.positionType.replace("_", " ")}</p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Alerts */}
      {filteredAlerts.length > 0 && <AlertsPanel alerts={filteredAlerts} />}
    </div>
  );
}

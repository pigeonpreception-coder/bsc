import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import { computeAutoStatus, computeProgressPercent, perspectiveBucket } from "./scorecard";

// ─── Types ───────────────────────────────────────────────────

export type CascadeWeights = {
  section_own_weight: number;
  section_subordinate_weight: number;
  department_own_weight: number;
  department_subordinate_weight: number;
  executive_own_weight: number;
  executive_subordinate_weight: number;
  corporate_own_weight: number;
  corporate_subordinate_weight: number;
};

const DEFAULT_WEIGHTS: CascadeWeights = {
  section_own_weight: 0.4,
  section_subordinate_weight: 0.6,
  department_own_weight: 0.3,
  department_subordinate_weight: 0.7,
  executive_own_weight: 0.25,
  executive_subordinate_weight: 0.75,
  corporate_own_weight: 0.2,
  corporate_subordinate_weight: 0.8,
};

type ScorecardRow = {
  id: string;
  scorecard_id: string;
  perspective: string;
  actual: string | null;
  target: string | null;
  objective_weight: number | null;
  perspective_weight: number | null;
  lower_is_better: boolean | null;
  status: string;
};

type OrgPosition = {
  id: string;
  position_type: string;
  office_department_name: string;
  reports_to_id: string | null;
};

type PositionScorecard = {
  position_id: string;
  scorecard_id: string;
  scorecard_scope: string;
};

// ─── Performance Score Calculation ───────────────────────────

function computeKpiScore(actual: string | null, target: string | null, lowerIsBetter: boolean): number | null {
  const pct = computeProgressPercent(actual, target, lowerIsBetter);
  if (pct === null) return null;
  return Math.min(pct, 100);
}

export function weightedAverage(scores: { score: number; weight: number }[]): number {
  const totalWeight = scores.reduce((sum, s) => sum + s.weight, 0);
  if (totalWeight === 0) return 0;
  return scores.reduce((sum, s) => sum + s.score * s.weight, 0) / totalWeight;
}

export function computeScorecardScore(rows: ScorecardRow[]) {
  let onTrack = 0, atRisk = 0, offTrack = 0;

  const bucketScores: Record<string, { score: number; weight: number }[]> = {
    financial: [],
    customer: [],
    internal_process: [],
    learning_growth: [],
  };
  const bucketPerspectiveWeights: Record<string, number[]> = {
    financial: [],
    customer: [],
    internal_process: [],
    learning_growth: [],
  };

  for (const row of rows) {
    const lowerIsBetter = row.lower_is_better ?? false;
    const score = computeKpiScore(row.actual, row.target, lowerIsBetter);
    if (score === null) continue;
    const w = row.objective_weight ?? 1;
    const bucket = perspectiveBucket(row.perspective);
    if (bucket) {
      bucketScores[bucket].push({ score, weight: w });
      if (row.perspective_weight !== null && row.perspective_weight !== undefined) {
        bucketPerspectiveWeights[bucket].push(row.perspective_weight);
      }
    }

    const status = computeAutoStatus(row.actual, row.target, lowerIsBetter);
    if (status === "on_track") onTrack++;
    else if (status === "at_risk") atRisk++;
    else if (status === "off_track") offTrack++;
  }

  // Composite "own" score is a two-level weighted average: each perspective's
  // score (already objective_weight-weighted within the perspective) is then
  // weighted by that perspective's own perspective_weight. Falls back to an
  // equal 25% split for any perspective where nobody set a weight.
  const bucketKeys = ["financial", "customer", "internal_process", "learning_growth"] as const;
  const perspectiveWeightedScores = bucketKeys
    .map((bucket) => {
      const scores = bucketScores[bucket];
      if (scores.length === 0) return null;
      const weights = bucketPerspectiveWeights[bucket];
      const weight = weights.length > 0 ? weights.reduce((a, b) => a + b, 0) / weights.length : 25;
      return { score: weightedAverage(scores), weight };
    })
    .filter((b): b is { score: number; weight: number } => b !== null);

  return {
    ownScore: perspectiveWeightedScores.length > 0 ? weightedAverage(perspectiveWeightedScores) : 0,
    financialScore: weightedAverage(bucketScores.financial),
    customerScore: weightedAverage(bucketScores.customer),
    internalProcessScore: weightedAverage(bucketScores.internal_process),
    learningGrowthScore: weightedAverage(bucketScores.learning_growth),
    onTrack,
    atRisk,
    offTrack,
    total: rows.length,
  };
}

/**
 * The cascade rule itself: a position's composite score is its own score
 * for a leaf, or an own/subordinate-weighted blend (weight chosen by
 * position_type) once it has children. Extracted as a pure function so the
 * weighting rule can be unit-tested without a live org hierarchy in the DB.
 */
export function computeCompositeScore(
  positionType: string,
  ownScore: number,
  childComposites: number[],
  weights: CascadeWeights,
): number {
  if (childComposites.length === 0) return ownScore;

  const avgChild = childComposites.reduce((a, b) => a + b, 0) / childComposites.length;
  let ownWeight: number, subWeight: number;

  switch (positionType) {
    case "section_supervisor":
      ownWeight = weights.section_own_weight;
      subWeight = weights.section_subordinate_weight;
      break;
    case "non_executive":
      ownWeight = weights.department_own_weight;
      subWeight = weights.department_subordinate_weight;
      break;
    case "executive":
      ownWeight = weights.executive_own_weight;
      subWeight = weights.executive_subordinate_weight;
      break;
    default:
      ownWeight = 0.5;
      subWeight = 0.5;
  }
  return ownScore * ownWeight + avgChild * subWeight;
}

/**
 * Depth of a position in the reports_to_id chain, root = 0. Walked
 * iteratively with a visited set rather than recursed, so a corrupted
 * hierarchy (a reports_to_id cycle) can't stack-overflow or infinite-loop —
 * it just stops at the point the cycle is detected instead. The org chart
 * is meant to be a tree and nothing in the app can currently create a
 * cycle through normal use, but this is cheap insurance against bad data
 * (a bad migration, a manual DB edit) rather than a crash.
 */
export function computePositionDepth(posId: string, positionMap: Map<string, { reports_to_id: string | null }>): number {
  const visited = new Set<string>();
  let depth = 0;
  let currentId: string | null = posId;

  while (currentId) {
    if (visited.has(currentId)) break;
    visited.add(currentId);

    const pos = positionMap.get(currentId);
    if (!pos || !pos.reports_to_id) break;

    depth++;
    currentId = pos.reports_to_id;
  }

  return depth;
}

// ─── Main Calculation Function ───────────────────────────────

export async function calculatePerformanceScores(
  supabase: SupabaseClient,
  tenantId: string
) {
  // Load cascade weights
  const { data: weightsRow } = await supabase
    .from("cascade_weights")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const weights: CascadeWeights = weightsRow ?? DEFAULT_WEIGHTS;

  // Load org positions
  const { data: positions } = await supabase
    .from("org_positions")
    .select("id, position_type, office_department_name, reports_to_id")
    .eq("tenant_id", tenantId);

  if (!positions || positions.length === 0) return;

  // Load position → scorecard links
  const { data: positionScorecards } = await supabase
    .from("position_scorecards")
    .select("position_id, scorecard_id, scorecard_scope")
    .eq("tenant_id", tenantId);

  if (!positionScorecards) return;

  // Build lookup maps
  const childrenOf = new Map<string, OrgPosition[]>();
  const positionMap = new Map<string, OrgPosition>();
  for (const p of positions as OrgPosition[]) {
    positionMap.set(p.id, p);
    if (p.reports_to_id) {
      const list = childrenOf.get(p.reports_to_id) ?? [];
      list.push(p);
      childrenOf.set(p.reports_to_id, list);
    }
  }

  // Map position → office/dept scorecard and individual scorecard
  const officeScorecardOf = new Map<string, string>();
  const individualScorecardOf = new Map<string, string>();
  for (const ps of positionScorecards as PositionScorecard[]) {
    if (ps.scorecard_scope === "office_department") officeScorecardOf.set(ps.position_id, ps.scorecard_id);
    else individualScorecardOf.set(ps.position_id, ps.scorecard_id);
  }

  // Load all scorecard rows for this tenant at once
  const { data: allRows } = await supabase
    .from("scorecard_rows")
    .select("id, scorecard_id, perspective, actual, target, objective_weight, perspective_weight, lower_is_better, status")
    .eq("tenant_id", tenantId);

  const rowsByScorecardId = new Map<string, ScorecardRow[]>();
  for (const r of (allRows ?? []) as ScorecardRow[]) {
    const list = rowsByScorecardId.get(r.scorecard_id) ?? [];
    list.push(r);
    rowsByScorecardId.set(r.scorecard_id, list);
  }

  // Compute own scores for every position
  const ownScores = new Map<string, ReturnType<typeof computeScorecardScore>>();
  const ownScoreValues = new Map<string, number>();

  for (const pos of positions as OrgPosition[]) {
    if (pos.position_type === "board") continue;
    // Use the individual scorecard for own score if available, else office/dept
    const scId = individualScorecardOf.get(pos.id) ?? officeScorecardOf.get(pos.id);
    if (!scId) continue;
    const rows = rowsByScorecardId.get(scId) ?? [];
    const score = computeScorecardScore(rows);
    ownScores.set(pos.id, score);
    ownScoreValues.set(pos.id, score.ownScore);
  }

  // Compute composite scores bottom-up — sort positions by depth (deepest first)
  const sortedPositions = (positions as OrgPosition[])
    .filter((p) => p.position_type !== "board")
    .sort((a, b) => computePositionDepth(b.id, positionMap) - computePositionDepth(a.id, positionMap));

  const compositeScores = new Map<string, number>();

  for (const pos of sortedPositions) {
    const ownScore = ownScoreValues.get(pos.id) ?? 0;
    const children = childrenOf.get(pos.id) ?? [];
    const childComposites = children
      .map((c) => compositeScores.get(c.id))
      .filter((v): v is number => v !== undefined);

    compositeScores.set(pos.id, computeCompositeScore(pos.position_type, ownScore, childComposites, weights));
  }

  // Upsert performance_scores
  // Delete existing scores for this tenant, then insert fresh
  await supabase.from("performance_scores").delete().eq("tenant_id", tenantId);

  const scoresToInsert = sortedPositions.map((pos) => {
    const own = ownScores.get(pos.id);
    const scId = officeScorecardOf.get(pos.id) ?? individualScorecardOf.get(pos.id);
    return {
      tenant_id: tenantId,
      scorecard_id: scId ?? null,
      position_id: pos.id,
      position_type: pos.position_type,
      own_performance_score: own?.ownScore ?? 0,
      composite_performance_score: compositeScores.get(pos.id) ?? 0,
      financial_score: own?.financialScore ?? 0,
      customer_score: own?.customerScore ?? 0,
      internal_process_score: own?.internalProcessScore ?? 0,
      learning_growth_score: own?.learningGrowthScore ?? 0,
      kpis_on_track: own?.onTrack ?? 0,
      kpis_at_risk: own?.atRisk ?? 0,
      kpis_off_track: own?.offTrack ?? 0,
      total_kpis: own?.total ?? 0,
      last_calculated: new Date().toISOString(),
      snapshot_date: new Date().toISOString().split("T")[0],
    };
  });

  if (scoresToInsert.length > 0) {
    const { error } = await supabase.from("performance_scores").insert(scoresToInsert);
    if (error) throw error;
  }

  return { positionsProcessed: scoresToInsert.length };
}

// ─── Save Daily Snapshot ─────────────────────────────────────

export async function saveDailySnapshot(supabase: SupabaseClient, tenantId: string) {
  const today = new Date().toISOString().split("T")[0];

  // Check if already snapshotted today
  const { count } = await supabase
    .from("performance_history")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("snapshot_date", today);

  if (count && count > 0) return; // Already done

  const { data: scores } = await supabase
    .from("performance_scores")
    .select("scorecard_id, position_id, composite_performance_score, own_performance_score")
    .eq("tenant_id", tenantId);

  if (!scores || scores.length === 0) return;

  const historyRows = scores.map((s) => ({
    tenant_id: tenantId,
    scorecard_id: s.scorecard_id,
    position_id: s.position_id,
    composite_performance_score: s.composite_performance_score,
    own_performance_score: s.own_performance_score,
    snapshot_date: today,
  }));

  await supabase.from("performance_history").insert(historyRows);
}

// ─── Generate Alerts ─────────────────────────────────────────

export async function generatePerformanceAlerts(supabase: SupabaseClient, tenantId: string) {
  const { data: rows } = await supabase
    .from("scorecard_rows")
    .select("id, tenant_id, kpi, actual, target, status, scorecard_id")
    .eq("tenant_id", tenantId)
    .in("status", ["at_risk", "off_track"]);

  if (!rows || rows.length === 0) return;

  // Find position for each scorecard
  const { data: posLinks } = await supabase
    .from("position_scorecards")
    .select("position_id, scorecard_id")
    .eq("tenant_id", tenantId);

  const scorecardToPosition = new Map<string, string>();
  for (const pl of posLinks ?? []) scorecardToPosition.set(pl.scorecard_id, pl.position_id);

  const alerts = rows.map((r) => ({
    tenant_id: tenantId,
    position_id: scorecardToPosition.get(r.scorecard_id) ?? null,
    scorecard_row_id: r.id,
    alert_type: r.status === "off_track" ? "kpi_off_track" : "kpi_at_risk",
    alert_message: `KPI "${r.kpi}" is ${r.status.replace("_", " ")} — Actual: ${r.actual ?? "N/A"} / Target: ${r.target ?? "N/A"}`,
    is_read: false,
  }));

  // Only insert alerts that don't already exist (avoid duplicates)
  for (const alert of alerts) {
    const { count } = await supabase
      .from("performance_alerts")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("scorecard_row_id", alert.scorecard_row_id)
      .eq("alert_type", alert.alert_type)
      .eq("is_read", false);

    if (!count || count === 0) {
      await supabase.from("performance_alerts").insert(alert);
    }
  }
}

export type RowStatus = "not_yet_measured" | "on_track" | "at_risk" | "off_track";

/** The four Balanced Scorecard perspectives, GES canonical naming. */
export const CANONICAL_PERSPECTIVES = [
  "Financial",
  "Customer & Stakeholder",
  "Internal Processes",
  "Organisational Capacity",
] as const;

/**
 * Platform-standard perspectives. Both the classic four and the GES
 * expanded labels are accepted (see migration 0008); this list defines
 * the canonical display order — anything not listed sorts to the end.
 */
export const PERSPECTIVES = [
  ...CANONICAL_PERSPECTIVES,
  // Classic aliases still valid for older/other tenants:
  "Customer",
  "Internal Process",
  "Learning & Growth",
] as const;

const PERSPECTIVE_ORDER: Record<string, number> = {
  financial: 0,
  "customer & stakeholder": 1,
  customer: 1,
  "internal processes": 2,
  "internal process": 2,
  "organisational capacity": 3,
  "learning & growth": 3,
};

export function perspectiveSortIndex(perspective: string): number {
  return PERSPECTIVE_ORDER[perspective.trim().toLowerCase()] ?? 99;
}

/**
 * Buckets any perspective label (classic or GES) into one of the four
 * canonical performance-score columns. Used wherever per-perspective
 * scores get written to fixed DB columns (financial_score, etc.) rather
 * than kept as free-form per-tenant labels.
 */
export const PERSPECTIVE_BUCKETS = ["financial", "customer", "internal_process", "learning_growth"] as const;
export type PerspectiveBucket = (typeof PERSPECTIVE_BUCKETS)[number];

export function perspectiveBucket(perspective: string): PerspectiveBucket | null {
  const index = perspectiveSortIndex(perspective);
  return index >= 0 && index < PERSPECTIVE_BUCKETS.length ? PERSPECTIVE_BUCKETS[index] : null;
}

/**
 * Stable, code-level display order for the 16 fixed scorecard columns
 * (the 14-column template plus Responsible Person and the internal
 * Lower-is-Better toggle — see the bsc-generator skill for why those two
 * are practical additions beyond the strictly "printed" 14). These never
 * move relative to each other. Custom columns (scorecard_columns) can be
 * inserted anywhere in the gaps between them — 100 apart leaves plenty of
 * room; see migration 0014 for how existing custom columns were rescaled
 * to sit after all of these.
 */
export const FIXED_COLUMN_ORDER = {
  perspective: 100,
  strategic_objective: 200,
  strategic_theme_alignment: 300,
  intended_result: 400,
  key_initiatives: 500,
  perspective_weight: 600,
  objective_weight: 700,
  kpi: 800,
  unit: 900,
  lower_is_better: 1000,
  baseline: 1100,
  target: 1200,
  measurement_frequency: 1300,
  actual: 1400,
  responsible_person: 1500,
  status: 1600,
} as const;

export type FixedColumnKey = keyof typeof FIXED_COLUMN_ORDER;

export const FIXED_COLUMN_LABELS: Record<FixedColumnKey, string> = {
  perspective: "BSC Perspective",
  strategic_objective: "Strategic Objective",
  strategic_theme_alignment: "Strategic Theme Alignment",
  intended_result: "Intended Result",
  key_initiatives: "Key Initiatives & Intended Results",
  perspective_weight: "Persp. Wt (%)",
  objective_weight: "Obj. Wt (%)",
  kpi: "KPI / Measure",
  unit: "Unit",
  lower_is_better: "Lower is Better?",
  baseline: "Baseline",
  target: "Target",
  measurement_frequency: "Measurement Frequency",
  actual: "Actual Performance",
  responsible_person: "Responsible Person",
  status: "Status (RAG)",
};

/** Columns 1-7 of the template — shared across all of an objective's KPI rows. */
export const OBJECTIVE_SHARED_COLUMNS = new Set<FixedColumnKey>([
  "perspective",
  "strategic_objective",
  "strategic_theme_alignment",
  "intended_result",
  "key_initiatives",
  "perspective_weight",
  "objective_weight",
]);

export const FIXED_COLUMN_SEQUENCE = (Object.keys(FIXED_COLUMN_ORDER) as FixedColumnKey[]).sort(
  (a, b) => FIXED_COLUMN_ORDER[a] - FIXED_COLUMN_ORDER[b],
);

function parseNumeric(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Platform-standard 4-state RAG status (see bsc-generator skill):
 *   - Not Yet Measured: Actual blank / unparseable
 *   - On Track:  ratio ≥ 95%
 *   - At Risk:   ratio 80–94%
 *   - Off Track: ratio < 80%
 * `lowerIsBetter` flips the ratio for cost/error/days-type KPIs.
 */
export function computeAutoStatus(
  actual: string | null,
  target: string | null,
  lowerIsBetter = false,
): RowStatus {
  const pct = computeProgressPercent(actual, target, lowerIsBetter);
  if (pct === null) return "not_yet_measured";
  if (pct >= 95) return "on_track";
  if (pct >= 80) return "at_risk";
  return "off_track";
}

/** Best-effort progress percentage from free-text fields, or null if unparseable. */
export function computeProgressPercent(
  actual: string | null,
  target: string | null,
  lowerIsBetter = false,
): number | null {
  const actualNum = parseNumeric(actual);
  const targetNum = parseNumeric(target);
  if (actualNum === null || targetNum === null) return null;
  if (lowerIsBetter) {
    // Zero is the best possible result for a lower-is-better KPI (e.g. 0
    // complaints against a target of 5) — it's a real measurement, not a
    // missing one, so treat it as fully met rather than dividing by zero.
    if (actualNum === 0) return 100;
    return (targetNum / actualNum) * 100;
  }
  if (targetNum === 0) return null;
  return (actualNum / targetNum) * 100;
}

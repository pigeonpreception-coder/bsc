export type RowStatus = "not_yet_measured" | "on_track" | "at_risk" | "off_track";

/**
 * Platform-standard perspectives. Both the classic four and the GES
 * expanded labels are accepted (see migration 0008); this list defines
 * the canonical display order — anything not listed sorts to the end.
 */
export const PERSPECTIVES = [
  "Financial",
  "Customer & Stakeholder",
  "Internal Processes",
  "Organisational Capacity",
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
    if (actualNum === 0) return null;
    return (targetNum / actualNum) * 100;
  }
  if (targetNum === 0) return null;
  return (actualNum / targetNum) * 100;
}

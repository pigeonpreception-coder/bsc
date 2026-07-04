export type RowStatus = "on_track" | "at_risk" | "off_track";

export const PERSPECTIVES = ["Financial", "Customer", "Internal Process", "Learning & Growth"] as const;

function parseNumeric(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = value.replace(/,/g, "").match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

/**
 * Best-effort auto status from free-text actual/target fields (e.g. "$3.5B by FY2028").
 * Returns null when either side isn't parseable as a number, so callers can fall back
 * to leaving the status as manually set rather than guessing.
 */
export function computeAutoStatus(actual: string | null, target: string | null): RowStatus | null {
  const pct = computeProgressPercent(actual, target);
  if (pct === null) return null;
  if (pct >= 90) return "on_track";
  if (pct >= 70) return "at_risk";
  return "off_track";
}

/** Best-effort progress percentage (actual/target * 100) from free-text fields, or null if unparseable. */
export function computeProgressPercent(actual: string | null, target: string | null): number | null {
  const actualNum = parseNumeric(actual);
  const targetNum = parseNumeric(target);
  if (actualNum === null || targetNum === null || targetNum === 0) return null;
  return (actualNum / targetNum) * 100;
}

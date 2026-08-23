// Deliberately simple linear-regression trend projection, not a real
// forecasting model — there's no ML infrastructure in this app and building
// one just for this would be a much larger undertaking than "predictive
// analytics" as a single spec line item warrants. This is the same spirit
// as the "weekly advisory" feature it complements: a defensible, explainable
// estimate from the data actually on hand (performance_history's daily
// snapshots), not a black box.
export type TrendPoint = { date: string; value: number };

export function computeLinearTrend(points: TrendPoint[]): { slope: number; intercept: number } | null {
  if (points.length < 2) return null;

  const sorted = [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const originMs = new Date(sorted[0].date).getTime();
  const xs = sorted.map((p) => (new Date(p.date).getTime() - originMs) / (1000 * 60 * 60 * 24));
  const ys = sorted.map((p) => p.value);

  const n = xs.length;
  const sumX = xs.reduce((a, b) => a + b, 0);
  const sumY = ys.reduce((a, b) => a + b, 0);
  const sumXY = xs.reduce((acc, x, i) => acc + x * ys[i], 0);
  const sumXX = xs.reduce((acc, x) => acc + x * x, 0);

  const denominator = n * sumXX - sumX * sumX;
  // All points share the same x (e.g. every snapshot landed on one day) —
  // no meaningful trend direction, just the flat average.
  if (denominator === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;
  return { slope, intercept };
}

// Scores are 0-100 percentages — clamped so a strong trend never projects a
// nonsensical value outside that range.
export function projectScore(points: TrendPoint[], daysAhead: number): number | null {
  const trend = computeLinearTrend(points);
  if (!trend) return null;

  const sorted = [...points].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const originMs = new Date(sorted[0].date).getTime();
  const lastX = (new Date(sorted[sorted.length - 1].date).getTime() - originMs) / (1000 * 60 * 60 * 24);
  const projectedX = lastX + daysAhead;
  const projected = trend.intercept + trend.slope * projectedX;

  return Math.max(0, Math.min(100, projected));
}

export type TrendDirection = "up" | "down" | "flat";

// A slope under this magnitude (percentage points/day) reads as noise, not
// a real trend — avoids flip-flopping between up/down arrows on essentially
// flat data.
const FLAT_SLOPE_THRESHOLD = 0.05;

export function trendDirection(slope: number): TrendDirection {
  if (slope > FLAT_SLOPE_THRESHOLD) return "up";
  if (slope < -FLAT_SLOPE_THRESHOLD) return "down";
  return "flat";
}

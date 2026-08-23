// Simple calendar-day thresholds, deliberately not a working-day/holiday/
// timezone-aware calendar — that full complexity (financial-year config,
// per-tenant timezone, quarter/working-day math) was already explicitly
// deferred when the BSC governance workflow was built (see the current-state
// assessment's §34 quarterly-review-windows note) and remains out of scope
// here too. This is the pragmatic subset: a scorecard stuck in review for a
// few calendar days gets a reminder; stuck for over a week, an escalation.
export const REVIEW_REMINDER_DAYS = 3;
export const REVIEW_ESCALATION_DAYS = 7;

export function daysSince(timestamp: string, now: Date = new Date()): number {
  return (now.getTime() - new Date(timestamp).getTime()) / (1000 * 60 * 60 * 24);
}

export type SlaStatus = "ok" | "reminder" | "escalation";

export function classifyReviewAge(ageDays: number): SlaStatus {
  if (ageDays >= REVIEW_ESCALATION_DAYS) return "escalation";
  if (ageDays >= REVIEW_REMINDER_DAYS) return "reminder";
  return "ok";
}

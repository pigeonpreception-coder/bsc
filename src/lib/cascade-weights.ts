/**
 * Shared by the settings page, form, and server action for cascade weight
 * configuration. Only the three tiers computeCompositeScore() (see
 * performance.ts) actually branches on — section_supervisor, non_executive,
 * and executive — are exposed here. cascade_weights also has
 * corporate_own_weight/corporate_subordinate_weight columns, but no
 * position_type in this app's model ever reaches that branch (board is
 * always filtered out before scoring, and individual_staff never has
 * children) — exposing a control with zero effect on real scores would be
 * misleading, so it's intentionally left out of this UI.
 */
export const CASCADE_TIERS = [
  { key: "section", label: "Section Supervisor", ownColumn: "section_own_weight", subColumn: "section_subordinate_weight" },
  { key: "department", label: "Department Head", ownColumn: "department_own_weight", subColumn: "department_subordinate_weight" },
  { key: "executive", label: "Executive", ownColumn: "executive_own_weight", subColumn: "executive_subordinate_weight" },
] as const;

export type CascadeTierKey = (typeof CASCADE_TIERS)[number]["key"];

export const DEFAULT_OWN_WEIGHT_PERCENT: Record<CascadeTierKey, number> = {
  section: 40,
  department: 30,
  executive: 25,
};

/** Parses a form field into a validated whole-number 0-100 percentage. */
export function parseOwnWeightPercent(raw: FormDataEntryValue | null): number {
  // Number(null) is 0, not NaN — check explicitly so a missing field is
  // rejected rather than silently becoming a valid 0% weight.
  if (raw === null || raw === "") {
    throw new Error("Weights must be a number between 0 and 100.");
  }
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Weights must be a number between 0 and 100.");
  }
  return Math.round(value);
}

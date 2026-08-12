import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { perspectiveSortIndex } from "@/lib/scorecard";

// Section 5.4 must render the tenant's live Corporate BSC, not static AI
// text — this is the shared, non-React data shape both the web preview
// and the eventual PDF/Word export render from, so the two never drift
// apart.

export type CorporateBscRow = {
  id: string;
  strategicObjective: string;
  intendedResult: string | null;
  keyInitiatives: string | null;
  kpi: string;
  unit: string | null;
  baseline: string | null;
  target: string | null;
  measurementFrequency: string | null;
  ownerName: string | null;
};

export type CorporateBscPerspectiveGroup = {
  perspective: string;
  rows: CorporateBscRow[];
};

export type CorporateBscView = {
  scorecardId: string;
  scorecardName: string;
  perspectiveGroups: CorporateBscPerspectiveGroup[];
};

/**
 * Null if the tenant hasn't generated a Corporate scorecard for this plan yet.
 *
 * This uses the admin (RLS-bypassing) client, so `tenantId` must be asserted
 * here rather than left to the caller — a plan_id alone isn't enough to scope
 * the query safely.
 */
export async function getCorporateBscView(planId: string, tenantId: string): Promise<CorporateBscView | null> {
  const supabase = createAdminClient();

  const { data: scorecard } = await supabase
    .from("scorecards")
    .select("id, name")
    .eq("plan_id", planId)
    .eq("tenant_id", tenantId)
    .eq("scorecard_type", "corporate")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!scorecard) return null;

  const { data: rows } = await supabase
    .from("scorecard_rows")
    .select(
      "id, perspective, strategic_objective, intended_result, key_initiatives, kpi, unit, baseline, target, measurement_frequency, responsible_person, sort_order",
    )
    .eq("scorecard_id", scorecard.id)
    .order("sort_order", { ascending: true });

  const ownerIds = [...new Set((rows ?? []).map((r) => r.responsible_person).filter((id): id is string => Boolean(id)))];
  const ownerNameById = new Map<string, string>();
  if (ownerIds.length > 0) {
    const { data: owners } = await supabase.from("users").select("id, full_name, email").in("id", ownerIds);
    for (const owner of owners ?? []) {
      ownerNameById.set(owner.id, owner.full_name || owner.email);
    }
  }

  const rowsByPerspective = new Map<string, CorporateBscRow[]>();
  for (const row of rows ?? []) {
    const mapped: CorporateBscRow = {
      id: row.id,
      strategicObjective: row.strategic_objective,
      intendedResult: row.intended_result,
      keyInitiatives: row.key_initiatives,
      kpi: row.kpi,
      unit: row.unit,
      baseline: row.baseline,
      target: row.target,
      measurementFrequency: row.measurement_frequency,
      ownerName: row.responsible_person ? (ownerNameById.get(row.responsible_person) ?? null) : null,
    };
    const list = rowsByPerspective.get(row.perspective) ?? [];
    list.push(mapped);
    rowsByPerspective.set(row.perspective, list);
  }

  const perspectiveGroups: CorporateBscPerspectiveGroup[] = [...rowsByPerspective.entries()]
    .sort(([a], [b]) => perspectiveSortIndex(a) - perspectiveSortIndex(b))
    .map(([perspective, perspectiveRows]) => ({ perspective, rows: perspectiveRows }));

  return { scorecardId: scorecard.id, scorecardName: scorecard.name, perspectiveGroups };
}

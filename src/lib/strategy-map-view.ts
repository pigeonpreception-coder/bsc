import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { perspectiveMapLevel } from "@/lib/scorecard";

export type StrategyMapViewObjective = {
  id: string;
  text: string;
  perspective: string;
  level: number;
  order: number;
};

export type StrategyMapViewConnection = { from: string; to: string; type: "vertical" | "lateral" };

export type StrategyMapView = {
  objectives: StrategyMapViewObjective[];
  connections: StrategyMapViewConnection[];
};

/**
 * Null if a strategy map hasn't been generated for this plan yet (no
 * objective has a map_order). Same admin-client-plus-explicit-tenantId
 * pattern as getCorporateBscView/getOrgStructureView — tenantId must be
 * asserted here since the admin client bypasses RLS.
 */
export async function getStrategyMapView(planId: string, tenantId: string): Promise<StrategyMapView | null> {
  const supabase = createAdminClient();

  const { data: objectiveRows } = await supabase
    .from("strategic_objectives")
    .select("id, objective_text, perspective, map_order")
    .eq("plan_id", planId)
    .eq("tenant_id", tenantId);

  const generated = (objectiveRows ?? []).filter((o) => o.map_order !== null);
  if (generated.length === 0) return null;

  const objectives: StrategyMapViewObjective[] = generated
    .map((o) => {
      const level = perspectiveMapLevel(o.perspective);
      return level === null
        ? null
        : { id: o.id, text: o.objective_text, perspective: o.perspective, level, order: o.map_order as number };
    })
    .filter((o): o is StrategyMapViewObjective => o !== null);

  const { data: connectionRows } = await supabase
    .from("strategy_map_connections")
    .select("from_objective_id, to_objective_id, connection_type")
    .eq("plan_id", planId)
    .eq("tenant_id", tenantId);

  const connections: StrategyMapViewConnection[] = (connectionRows ?? []).map((c) => ({
    from: c.from_objective_id,
    to: c.to_objective_id,
    type: c.connection_type as "vertical" | "lateral",
  }));

  return { objectives, connections };
}

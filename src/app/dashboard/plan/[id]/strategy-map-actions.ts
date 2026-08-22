"use server";

import { revalidatePath } from "next/cache";
import { requireCompanyAdminForPlan } from "./shared";
import { generateStrategyMapConnections } from "@/lib/strategy-map-generation";
import { computeMapOrder, resolveConnections } from "@/lib/strategy-map-layout";
import { checkAiGenerationRateLimit, recordAiGenerationAttempt } from "@/lib/rate-limit";
import { createAdminClient } from "@/lib/supabase/admin";

export async function generateStrategyMap(planId: string) {
  const { user, plan } = await requireCompanyAdminForPlan(planId);

  const rateLimit = await checkAiGenerationRateLimit(user.id);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  try {
    const { objectives, connections } = await generateStrategyMapConnections(planId, plan.tenant_id);

    const rawOrder = computeMapOrder(objectives, connections);
    const levelById = new Map(objectives.map((o) => [o.id, o.level]));
    const resolved = resolveConnections(connections, rawOrder, levelById);

    const admin = createAdminClient();

    // resolveConnections may drop lateral edges whose endpoints didn't end
    // up adjacent (see strategy-map-layout.ts) — generateStrategyMapConnections
    // already persisted every candidate edge, so any dropped here must be
    // deleted too. Otherwise a stored-but-invalid lateral edge could get
    // rendered as an arc between non-adjacent objectives, breaking the
    // containment guarantee (§9) that lateral arcs never cross verticals.
    const resolvedKeys = new Set(resolved.map((c) => `${c.from}>${c.to}`));
    const dropped = connections.filter((c) => !resolvedKeys.has(`${c.from}>${c.to}`));
    for (const c of dropped) {
      const { error } = await admin
        .from("strategy_map_connections")
        .delete()
        .eq("plan_id", planId)
        .eq("tenant_id", plan.tenant_id)
        .eq("from_objective_id", c.from)
        .eq("to_objective_id", c.to);
      if (error) throw error;
    }

    for (const [objectiveId, order] of rawOrder) {
      const { error } = await admin
        .from("strategic_objectives")
        .update({ map_order: order })
        .eq("id", objectiveId)
        .eq("tenant_id", plan.tenant_id);
      if (error) throw error;
    }
  } finally {
    await recordAiGenerationAttempt(user.id);
  }

  revalidatePath(`/dashboard/plan/${planId}`);
}

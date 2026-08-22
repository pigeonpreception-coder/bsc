import "server-only";
import { createAnthropicClient, CLAUDE_MODEL, friendlyAnthropicError } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import { perspectiveMapLevel } from "@/lib/scorecard";
import { deriveConnectionType, type MapConnection } from "@/lib/strategy-map-layout";

const MIN_EDGES_PER_OBJECTIVE = 1;
const MAX_EDGES_PER_OBJECTIVE = 3;

const CONNECTIONS_TOOL = {
  name: "submit_strategy_map_connections",
  description:
    "Submit the cause-and-effect connections between the numbered strategic objectives, per the direction and arrow-count rules given.",
  input_schema: {
    type: "object" as const,
    properties: {
      connections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            from_objective_number: { type: "integer", description: "1-based number of the source objective." },
            to_objective_number: { type: "integer", description: "1-based number of the target objective." },
          },
          required: ["from_objective_number", "to_objective_number"],
        },
      },
    },
    required: ["connections"],
  },
};

type GeneratedConnection = { from_objective_number: number; to_objective_number: number };
export type StrategyMapObjective = { id: string; level: number };
export type StrategyMapResult = { objectives: StrategyMapObjective[]; connections: MapConnection[] };

// tenantId is asserted internally rather than trusted from the caller — see
// generateCorporateObjectives in strategic-theme-generation.ts for why.
export async function generateStrategyMapConnections(planId: string, tenantId: string): Promise<StrategyMapResult> {
  const supabase = createAdminClient();

  const { data: plan, error: planError } = await supabase
    .from("strategic_plans")
    .select("company_name, tenant_id")
    .eq("id", planId)
    .eq("tenant_id", tenantId)
    .single();
  if (planError || !plan) throw new Error("Strategic plan not found");

  const { data: objectiveRows, error: objectivesError } = await supabase
    .from("strategic_objectives")
    .select("id, objective_text, perspective")
    .eq("plan_id", planId);
  if (objectivesError) throw objectivesError;
  if (!objectiveRows || objectiveRows.length < 2) {
    throw new Error("Generate the plan's Corporate Strategic Objectives (Section 5) before generating a strategy map.");
  }

  const objectives: (StrategyMapObjective & { text: string })[] = objectiveRows.map((o) => {
    const level = perspectiveMapLevel(o.perspective);
    if (level === null) {
      throw new Error(`Objective "${o.objective_text}" has an unrecognized perspective "${o.perspective}".`);
    }
    return { id: o.id, level, text: o.objective_text };
  });

  const numberedList = objectives
    .map((o, i) => `${i + 1}. [Level ${o.level}] ${o.text}`)
    .join("\n");

  const prompt = `You are Safina AI, deciding the cause-and-effect connections for ${plan.company_name}'s Strategy Map — a Kaplan-Norton style Balanced Scorecard diagram.

NUMBERED OBJECTIVES (each tagged with its causal level — 0 = Learning & Growth/Organisational Capacity at the bottom, 1 = Internal Processes, 2 = Customer & Stakeholder, 3 = Financial at the top):
${numberedList}

RULES (all hard rules — every connection you submit must satisfy every one of them):
1. Direction: a connection may only point from an objective to another objective at the SAME level (lateral) or EXACTLY ONE level higher (vertical). Never point downward, never skip a level. An objective at level 0 must never point directly to a level-2 or level-3 objective — find the level-1 objective that sits between them instead.
2. Every objective must have between ${MIN_EDGES_PER_OBJECTIVE} and ${MAX_EDGES_PER_OBJECTIVE} outgoing connections, EXCEPT level-3 (Financial) objectives, which represent terminal outcomes and may have zero outgoing connections (only lateral ones are meaningful for them, since nothing sits above level 3).
3. Never connect an objective to itself. Never create both A→B and B→A between the same pair at the same level — pick the stronger direction only.
4. Prefer genuine causal logic: direct capability transfer (an objective that builds something the target explicitly consumes), named thematic overlap (compliance feeds quality assurance), and lateral links only between objectives that are mutually reinforcing with no natural "driver" direction. Avoid piling most connections onto a single target when multiple valid targets have a roughly equally strong causal case.

Call the submit_strategy_map_connections tool with your answer, referencing objectives by their number (1-${objectives.length}) from the list above.`;

  const anthropic = createAnthropicClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      tools: [CONNECTIONS_TOOL],
      tool_choice: { type: "tool", name: "submit_strategy_map_connections" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw friendlyAnthropicError(err);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("AI did not return structured strategy map connections");
  const { connections: rawConnections } = toolUse.input as { connections: GeneratedConnection[] };

  // Post-hoc validation — the tool schema can't express the direction/
  // arrow-count/no-self-loop/no-two-cycle rules by itself, same as every
  // other AI-generation function in this codebase (see e.g.
  // generateCorporateObjectives's per-perspective count check).
  const connections: MapConnection[] = [];
  const seenPairs = new Set<string>();
  const outgoingCount = new Map<string, number>();

  for (const raw of rawConnections) {
    const from = objectives[raw.from_objective_number - 1];
    const to = objectives[raw.to_objective_number - 1];
    if (!from || !to) {
      throw new Error(
        `AI referenced an objective number outside 1-${objectives.length} — please try regenerating.`,
      );
    }
    if (from.id === to.id) continue; // self-loop — drop silently, not a hard error
    const type = deriveConnectionType(from.level, to.level);
    if (type === null) {
      throw new Error(
        `AI proposed a connection from a level-${from.level} objective to a level-${to.level} objective, which skips or reverses a level — please try regenerating.`,
      );
    }

    const pairKey = from.level === to.level ? [from.id, to.id].sort().join("|") : `${from.id}>${to.id}`;
    if (from.level === to.level && seenPairs.has(pairKey)) continue; // two-node cycle — keep only the first direction seen
    seenPairs.add(pairKey);

    connections.push({ from: from.id, to: to.id, type });
    outgoingCount.set(from.id, (outgoingCount.get(from.id) ?? 0) + 1);
  }

  for (const o of objectives) {
    const count = outgoingCount.get(o.id) ?? 0;
    const isTerminal = o.level === 3;
    if (!isTerminal && (count < MIN_EDGES_PER_OBJECTIVE || count > MAX_EDGES_PER_OBJECTIVE)) {
      throw new Error(
        `AI gave "${o.text}" ${count} outgoing connection(s) — must be between ${MIN_EDGES_PER_OBJECTIVE} and ${MAX_EDGES_PER_OBJECTIVE}. Please try regenerating.`,
      );
    }
    if (isTerminal && count > MAX_EDGES_PER_OBJECTIVE) {
      throw new Error(`AI gave the terminal objective "${o.text}" too many connections — please try regenerating.`);
    }
  }

  // Regenerating replaces this plan's previous strategy map.
  const { error: deleteError } = await supabase.from("strategy_map_connections").delete().eq("plan_id", planId);
  if (deleteError) throw deleteError;

  if (connections.length > 0) {
    const { error: insertError } = await supabase.from("strategy_map_connections").insert(
      connections.map((c) => ({
        plan_id: planId,
        tenant_id: plan.tenant_id,
        from_objective_id: c.from,
        to_objective_id: c.to,
        connection_type: c.type,
      })),
    );
    if (insertError) throw insertError;
  }

  return {
    objectives: objectives.map((o) => ({ id: o.id, level: o.level })),
    connections,
  };
}

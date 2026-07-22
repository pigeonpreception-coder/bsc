import "server-only";
import { createAnthropicClient, CLAUDE_MODEL, friendlyAnthropicError } from "@/lib/anthropic";

/**
 * Single source of truth for the platform-standard 14-column BSC template
 * (see the bsc-generator skill). Every scorecard-generation call site —
 * corporate, departmental, org-cascade — must go through this module so
 * the AI tool schema and the DB insert shape can never drift apart again.
 */
export const PERSPECTIVES = [
  "Financial",
  "Customer & Stakeholder",
  "Internal Processes",
  "Organisational Capacity",
] as const;

export type ScorecardRowInput = {
  perspective: (typeof PERSPECTIVES)[number];
  strategic_objective: string;
  strategic_theme_alignment: string;
  intended_result: string;
  key_initiatives: string;
  perspective_weight: number;
  objective_weight: number;
  kpi: string;
  unit: string;
  baseline: string;
  target: string;
  measurement_frequency: string;
  lower_is_better?: boolean;
};

const SCORECARD_TOOL = {
  name: "submit_scorecard",
  description: "Submit Balanced Scorecard rows in the platform-standard 14-column template.",
  input_schema: {
    type: "object" as const,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            perspective: { type: "string", enum: PERSPECTIVES },
            strategic_objective: { type: "string" },
            strategic_theme_alignment: {
              type: "string",
              description: "Which corporate strategic theme/pillar this objective ladders up to",
            },
            intended_result: { type: "string" },
            key_initiatives: {
              type: "string",
              description:
                "The action(s) driving the objective, each with its own intended result — a rich multi-item field",
            },
            perspective_weight: {
              type: "number",
              description:
                "This perspective's share of the total scorecard (%); the four perspective weights sum to 100",
            },
            objective_weight: {
              type: "number",
              description:
                "This objective's share within its perspective (%); objective weights sum to 100 within each perspective",
            },
            kpi: { type: "string" },
            unit: { type: "string" },
            baseline: { type: "string" },
            target: { type: "string" },
            measurement_frequency: { type: "string", description: "Quarterly, Annually, Monthly, etc." },
            lower_is_better: {
              type: "boolean",
              description: "true for cost/error/days-type KPIs where a lower actual is better",
            },
          },
          required: [
            "perspective",
            "strategic_objective",
            "strategic_theme_alignment",
            "intended_result",
            "key_initiatives",
            "perspective_weight",
            "objective_weight",
            "kpi",
            "unit",
            "baseline",
            "target",
            "measurement_frequency",
          ],
        },
      },
    },
    required: ["rows"],
  },
};

export async function generateRows(prompt: string): Promise<ScorecardRowInput[]> {
  const anthropic = createAnthropicClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      tools: [SCORECARD_TOOL],
      tool_choice: { type: "tool", name: "submit_scorecard" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw friendlyAnthropicError(err);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return scorecard rows");
  }
  return (toolUse.input as { rows: ScorecardRowInput[] }).rows;
}

export function rowsToInsert(rows: ScorecardRowInput[], scorecardId: string, tenantId: string) {
  return rows.map((r, i) => ({
    scorecard_id: scorecardId,
    tenant_id: tenantId,
    perspective: r.perspective,
    strategic_objective: r.strategic_objective,
    strategic_theme_alignment: r.strategic_theme_alignment,
    intended_result: r.intended_result,
    key_initiatives: r.key_initiatives,
    perspective_weight: r.perspective_weight,
    objective_weight: r.objective_weight,
    kpi: r.kpi,
    unit: r.unit,
    baseline: r.baseline,
    target: r.target,
    measurement_frequency: r.measurement_frequency,
    lower_is_better: r.lower_is_better ?? false,
    actual: null,
    status: "not_yet_measured",
    sort_order: i,
  }));
}

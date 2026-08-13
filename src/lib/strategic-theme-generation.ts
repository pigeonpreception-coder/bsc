import "server-only";
import { createAnthropicClient, CLAUDE_MODEL, friendlyAnthropicError } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildCompanyContextBlock } from "@/lib/plan-document-generation";
import { CANONICAL_PERSPECTIVES } from "@/lib/scorecard";

const MIN_OBJECTIVES = 16;
const MAX_OBJECTIVES = 24;
const MIN_OBJECTIVES_PER_PERSPECTIVE = 3;
const MIN_THEMES = 3;
const MAX_THEMES = 4;

// ============================================================
// Step 1 — Corporate Strategic Objectives (generated first, on
// their own, distributed across the 4 canonical BSC perspectives).
// ============================================================

const OBJECTIVES_TOOL = {
  name: "submit_corporate_objectives",
  description: `Submit between ${MIN_OBJECTIVES} and ${MAX_OBJECTIVES} Corporate Strategic Objectives, distributed across the four Balanced Scorecard perspectives.`,
  input_schema: {
    type: "object" as const,
    properties: {
      objectives: {
        type: "array",
        minItems: MIN_OBJECTIVES,
        maxItems: MAX_OBJECTIVES,
        items: {
          type: "object",
          properties: {
            objective_text: { type: "string" },
            perspective: { type: "string", enum: CANONICAL_PERSPECTIVES },
          },
          required: ["objective_text", "perspective"],
        },
      },
    },
    required: ["objectives"],
  },
};

type GeneratedObjective = { objective_text: string; perspective: string };
export type ObjectiveResult = { id: string; objectiveText: string; perspective: string };

// tenantId is asserted internally rather than trusted from the caller — see
// buildPlanDocumentModel in plan-document-model.ts for why.
export async function generateCorporateObjectives(planId: string, tenantId: string): Promise<ObjectiveResult[]> {
  const supabase = createAdminClient();

  const { data: plan, error: planError } = await supabase
    .from("strategic_plans")
    .select("*")
    .eq("id", planId)
    .eq("tenant_id", tenantId)
    .single();
  if (planError || !plan) throw new Error("Strategic plan not found");

  const companyContext = await buildCompanyContextBlock(plan);

  const prompt = `You are Safina AI, a senior corporate strategist developing the Corporate Strategic Objectives for ${plan.company_name}'s Balanced Scorecard.

COMPANY INTAKE DATA:
${companyContext}

TASK:
Develop between ${MIN_OBJECTIVES} and ${MAX_OBJECTIVES} Corporate Strategic Objectives — this is a hard rule. Distribute them across all four Balanced Scorecard perspectives (every perspective must have at least ${MIN_OBJECTIVES_PER_PERSPECTIVE} objectives):
- Financial
- Customer & Stakeholder
- Internal Processes
- Organisational Capacity

Write each objective as a clear, board-level strategic statement grounded in the company's actual intake data above — not generic boilerplate.

Call the submit_corporate_objectives tool with your answer.`;

  const anthropic = createAnthropicClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      tools: [OBJECTIVES_TOOL],
      tool_choice: { type: "tool", name: "submit_corporate_objectives" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw friendlyAnthropicError(err);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("AI did not return structured corporate objectives");
  const { objectives } = toolUse.input as { objectives: GeneratedObjective[] };

  if (objectives.length < MIN_OBJECTIVES || objectives.length > MAX_OBJECTIVES) {
    throw new Error(
      `AI returned ${objectives.length} corporate objectives — must be between ${MIN_OBJECTIVES} and ${MAX_OBJECTIVES}. Please try regenerating.`,
    );
  }
  const countByPerspective = new Map<string, number>();
  for (const o of objectives) {
    countByPerspective.set(o.perspective, (countByPerspective.get(o.perspective) ?? 0) + 1);
  }
  for (const perspective of CANONICAL_PERSPECTIVES) {
    const count = countByPerspective.get(perspective) ?? 0;
    if (count < MIN_OBJECTIVES_PER_PERSPECTIVE) {
      throw new Error(
        `AI gave the "${perspective}" perspective only ${count} objective(s) — every perspective needs at least ${MIN_OBJECTIVES_PER_PERSPECTIVE}. Please try regenerating.`,
      );
    }
  }

  // Regenerating replaces this plan's previous corporate objectives.
  const { error: deleteError } = await supabase.from("strategic_objectives").delete().eq("plan_id", planId);
  if (deleteError) throw deleteError;

  const { data: inserted, error: insertError } = await supabase
    .from("strategic_objectives")
    .insert(
      objectives.map((o) => ({
        plan_id: planId,
        tenant_id: plan.tenant_id,
        perspective: o.perspective,
        objective_text: o.objective_text,
      })),
    )
    .select("id, objective_text, perspective");
  if (insertError) throw insertError;

  return (inserted ?? []).map((o) => ({
    id: o.id as string,
    objectiveText: o.objective_text as string,
    perspective: o.perspective as string,
  }));
}

// ============================================================
// Step 2 — Strategic Themes (informed by the finalized objectives,
// but generated as their own rows, no nested objectives here).
// ============================================================

const THEMES_TOOL = {
  name: "submit_strategic_themes",
  description: `Submit between ${MIN_THEMES} and ${MAX_THEMES} Strategic Themes for the Corporate Strategic Plan.`,
  input_schema: {
    type: "object" as const,
    properties: {
      strategic_themes: {
        type: "array",
        minItems: MIN_THEMES,
        maxItems: MAX_THEMES,
        items: {
          type: "object",
          properties: {
            theme_number: { type: "integer", enum: [1, 2, 3, 4] },
            title: { type: "string" },
            intended_result: { type: "string", description: "What success looks like for this theme." },
          },
          required: ["theme_number", "title", "intended_result"],
        },
      },
    },
    required: ["strategic_themes"],
  },
};

type GeneratedTheme = { theme_number: number; title: string; intended_result: string };
export type ThemeResult = { id: string; themeNumber: number; title: string; intendedResult: string };

// Shared so every later generation step (Section 5's own prose, Sections
// 6-9) describes the same finalized themes/objectives the same way.
export function formatThemesSummary(themes: ThemeResult[]): string {
  return themes.map((t) => `Theme ${t.themeNumber}: ${t.title} — Intended Result: ${t.intendedResult}`).join("\n");
}

export function formatObjectivesSummary(objectives: ObjectiveResult[]): string {
  return objectives.map((o) => `- [${o.perspective}] ${o.objectiveText}`).join("\n");
}

export async function generateStrategicThemes(
  planId: string,
  tenantId: string,
  objectives: ObjectiveResult[],
): Promise<ThemeResult[]> {
  const supabase = createAdminClient();

  const { data: plan, error: planError } = await supabase
    .from("strategic_plans")
    .select("*")
    .eq("id", planId)
    .eq("tenant_id", tenantId)
    .single();
  if (planError || !plan) throw new Error("Strategic plan not found");

  const companyContext = await buildCompanyContextBlock(plan);
  const objectivesList = objectives.map((o, i) => `${i + 1}. [${o.perspective}] ${o.objectiveText}`).join("\n");

  const prompt = `You are Safina AI, a senior corporate strategist consolidating ${plan.company_name}'s strategic priorities into Strategic Themes for their Corporate Strategic Plan.

COMPANY INTAKE DATA:
${companyContext}

THE FOLLOWING CORPORATE STRATEGIC OBJECTIVES HAVE ALREADY BEEN FINALIZED — your themes must be well aligned with these and with the four Balanced Scorecard perspectives they cover:
${objectivesList}

TASK:
Consolidate the company's stated strategic priorities into between ${MIN_THEMES} and ${MAX_THEMES} Strategic Themes — this is a hard rule. Choose the right number for this specific company: some businesses only need ${MIN_THEMES} genuinely distinct themes, others need ${MAX_THEMES} — do not force extra themes to hit a round number, and do not merge genuinely distinct themes just to reduce the count. For each theme, provide a clear, board-level title and an Intended Result describing what success looks like. Number your themes sequentially starting at 1 with no gaps (e.g. ${MIN_THEMES} themes are numbered 1-${MIN_THEMES}, ${MAX_THEMES} themes are numbered 1-${MAX_THEMES}).

Call the submit_strategic_themes tool with your answer.`;

  const anthropic = createAnthropicClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 2048,
      tools: [THEMES_TOOL],
      tool_choice: { type: "tool", name: "submit_strategic_themes" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw friendlyAnthropicError(err);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("AI did not return structured strategic themes");
  const { strategic_themes: themes } = toolUse.input as { strategic_themes: GeneratedTheme[] };

  if (themes.length < MIN_THEMES || themes.length > MAX_THEMES) {
    throw new Error(
      `AI returned ${themes.length} strategic themes — must be between ${MIN_THEMES} and ${MAX_THEMES}. Please try regenerating.`,
    );
  }
  const expectedNumbers = Array.from({ length: themes.length }, (_, i) => i + 1);
  const actualNumbers = themes.map((t) => t.theme_number).sort((a, b) => a - b);
  if (JSON.stringify(actualNumbers) !== JSON.stringify(expectedNumbers)) {
    throw new Error(
      `AI numbered its ${themes.length} strategic themes as [${actualNumbers.join(", ")}] instead of sequentially from 1 — please try regenerating.`,
    );
  }

  // Regenerating replaces the previous themes; cascades remove their old
  // strategic_objective_themes links too.
  const { error: deleteError } = await supabase.from("strategic_themes").delete().eq("plan_id", planId);
  if (deleteError) throw deleteError;

  const results: ThemeResult[] = [];
  for (const [index, theme] of themes.entries()) {
    const { data: themeRow, error: themeError } = await supabase
      .from("strategic_themes")
      .insert({
        tenant_id: plan.tenant_id,
        plan_id: planId,
        theme_number: theme.theme_number,
        title: theme.title,
        intended_result: theme.intended_result,
        sort_order: index,
      })
      .select("id")
      .single();
    if (themeError) throw themeError;

    results.push({
      id: themeRow.id as string,
      themeNumber: theme.theme_number,
      title: theme.title,
      intendedResult: theme.intended_result,
    });
  }

  return results;
}

// ============================================================
// Step 3 — Align objectives to themes, many-to-many. One objective
// can support more than one theme, even all of them.
// ============================================================

// Built per-call from the actual generated themes — the valid theme_numbers
// range is 3 or 4 depending on how many themes this plan ended up with, not
// always 1-4.
function buildAlignmentTool(themeNumbers: number[]) {
  return {
    name: "submit_theme_alignment",
    description: "For each Corporate Strategic Objective, submit which Strategic Theme(s) it aligns with.",
    input_schema: {
      type: "object" as const,
      properties: {
        alignments: {
          type: "array",
          items: {
            type: "object",
            properties: {
              objective_number: {
                type: "integer",
                description: "The objective's number from the numbered list provided (1-based).",
              },
              theme_numbers: {
                type: "array",
                items: { type: "integer", enum: themeNumbers },
                minItems: 1,
                description: `One or more of the theme numbers (${themeNumbers.join(", ")}) this objective aligns with — an objective may align with more than one theme, even all of them.`,
              },
            },
            required: ["objective_number", "theme_numbers"],
          },
        },
      },
      required: ["alignments"],
    },
  };
}

type GeneratedAlignment = { objective_number: number; theme_numbers: number[] };

export async function alignObjectivesToThemes(
  planId: string,
  tenantId: string,
  objectives: ObjectiveResult[],
  themes: ThemeResult[],
): Promise<void> {
  const supabase = createAdminClient();

  const { data: plan, error: planError } = await supabase
    .from("strategic_plans")
    .select("tenant_id, company_name")
    .eq("id", planId)
    .eq("tenant_id", tenantId)
    .single();
  if (planError || !plan) throw new Error("Strategic plan not found");

  const objectivesList = objectives.map((o, i) => `${i + 1}. [${o.perspective}] ${o.objectiveText}`).join("\n");
  const themesList = themes.map((t) => `${t.themeNumber}. ${t.title} — ${t.intendedResult}`).join("\n");
  const themeNumbers = themes.map((t) => t.themeNumber);

  const prompt = `You are Safina AI, aligning ${plan.company_name}'s Corporate Strategic Objectives to its Strategic Themes.

STRATEGIC THEMES:
${themesList}

CORPORATE STRATEGIC OBJECTIVES:
${objectivesList}

TASK:
For every objective listed above, decide which Strategic Theme(s) it supports — an objective may align with just one theme or with several (even all ${themes.length} of them) where it genuinely contributes to more than one. Every objective must align with at least one theme. Base this on genuine strategic fit, not a mechanical even split.

Call the submit_theme_alignment tool with your answer, covering every objective number from 1 to ${objectives.length}.`;

  const anthropic = createAnthropicClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      tools: [buildAlignmentTool(themeNumbers)],
      tool_choice: { type: "tool", name: "submit_theme_alignment" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw friendlyAnthropicError(err);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("AI did not return a structured theme alignment");
  const { alignments } = toolUse.input as { alignments: GeneratedAlignment[] };

  const themeNumbersByObjectiveNumber = new Map(alignments.map((a) => [a.objective_number, a.theme_numbers]));
  const missing = objectives.map((_, i) => i + 1).filter((n) => !themeNumbersByObjectiveNumber.has(n));
  if (missing.length > 0) {
    throw new Error(`AI did not align objective(s) ${missing.join(", ")} to any theme — please try regenerating.`);
  }

  const themeIdByNumber = new Map(themes.map((t) => [t.themeNumber, t.id]));

  const { error: deleteError } = await supabase.from("strategic_objective_themes").delete().eq("plan_id", planId);
  if (deleteError) throw deleteError;

  const rows = objectives.flatMap((objective, index) => {
    const themeNumbers = themeNumbersByObjectiveNumber.get(index + 1) ?? [];
    return themeNumbers
      .map((themeNumber) => themeIdByNumber.get(themeNumber))
      .filter((themeId): themeId is string => Boolean(themeId))
      .map((themeId) => ({
        tenant_id: plan.tenant_id,
        plan_id: planId,
        objective_id: objective.id,
        theme_id: themeId,
      }));
  });

  if (rows.length > 0) {
    const { error: insertError } = await supabase.from("strategic_objective_themes").insert(rows);
    if (insertError) throw insertError;
  }
}

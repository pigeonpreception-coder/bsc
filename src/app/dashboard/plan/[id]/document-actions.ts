"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireCompanyAdminForPlan } from "./shared";
import { generatePlanDocumentSections } from "@/lib/plan-document-generation";
import {
  generateCorporateObjectives,
  generateStrategicThemes,
  alignObjectivesToThemes,
  formatThemesSummary,
  formatObjectivesSummary,
  type ThemeResult,
  type ObjectiveResult,
} from "@/lib/strategic-theme-generation";
import { checkAiGenerationRateLimit, recordAiGenerationAttempt } from "@/lib/rate-limit";

// Sections 1-4 are descriptive/analytical and depend only on the Business
// Profile + Strategic Profile intake — Section 5 (Strategic Themes) and
// beyond need the themes generated first, so they're a separate step.
const SECTIONS_1_TO_4 = ["1", "2", "3", "4"];
const SECTIONS_6_TO_9 = ["6", "7", "8", "9"];

export async function generatePlanDocumentIntro(planId: string) {
  const { user, plan } = await requireCompanyAdminForPlan(planId);

  const rateLimit = await checkAiGenerationRateLimit(user.id);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  let result;
  try {
    result = await generatePlanDocumentSections(planId, plan.tenant_id, SECTIONS_1_TO_4);
  } finally {
    // Recorded regardless of outcome — the Anthropic API call this
    // triggers is the thing being throttled, and it's already been
    // spent by the time this runs, whether or not the call succeeded.
    await recordAiGenerationAttempt(user.id);
  }
  revalidatePath(`/dashboard/plan/${planId}`);
  return result;
}

// Order matters here, per JP's explicit instruction:
// 1. Corporate Strategic Objectives first (16-24, distributed across the
//    4 canonical BSC perspectives, at least 3 per perspective) — these
//    stand on their own, not derived from themes.
// 2. Strategic Themes second (3 or 4 — whichever fits the company, not a
//    forced round number), informed by the objectives so they're
//    coherently related to what was just generated.
// 3. Alignment third — a many-to-many mapping (an objective can support
//    more than one theme, even all of them) written to the
//    strategic_objective_themes junction table. This is "the BSC linkage":
//    once a future Corporate BSC generation step reads this table, every
//    KPI traces back to every theme it actually supports.
// 4. Section 5's written narrative last, using the finalized objectives,
//    themes, and alignment as context, so the prose never describes
//    anything different from what was actually saved.
export async function generatePlanSection5(planId: string) {
  const { user, plan } = await requireCompanyAdminForPlan(planId);

  const rateLimit = await checkAiGenerationRateLimit(user.id);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  try {
    const objectives = await generateCorporateObjectives(planId, plan.tenant_id);

    // These three steps aren't wrapped in a real database transaction (the
    // Supabase client doesn't support one across calls), so a failure here
    // can leave fresh objectives paired with stale/unlinked themes. Rather
    // than surface a bare, confusing error, say plainly what happened and
    // that a full retry (which redoes all three steps from scratch) fixes it.
    let themes;
    try {
      themes = await generateStrategicThemes(planId, plan.tenant_id, objectives);
      await alignObjectivesToThemes(planId, plan.tenant_id, objectives, themes);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      throw new Error(
        `Corporate Objectives were regenerated successfully, but Strategic Themes/alignment failed: ${message}. Click "Regenerate Section 5" again — it redoes all three steps cleanly from the new objectives.`,
      );
    }

    const extraContext = `\nTHE FOLLOWING HAVE ALREADY BEEN FINALIZED — Section 5.2's content must accurately describe these and only these, do not invent different ones:\n\nStrategic Themes:\n${formatThemesSummary(themes)}\n\nCorporate Strategic Objectives:\n${formatObjectivesSummary(objectives)}`;

    const result = await generatePlanDocumentSections(planId, plan.tenant_id, ["5"], extraContext);
    revalidatePath(`/dashboard/plan/${planId}`);
    return { ...result, objectives, themes };
  } finally {
    // One rate-limit slot for the whole invocation, not per internal AI
    // call (this makes 3) — the limit throttles how often the button is
    // clicked, not how many calls one click happens to fan out to.
    await recordAiGenerationAttempt(user.id);
  }
}

// Sections 6-9 reference the themes/objectives already created (per the
// original generation-order spec), so this fetches whatever was saved by
// generatePlanSection5 and feeds it in as context — if Section 5 hasn't
// been run yet, this still works, just without that extra context.
export async function generatePlanDocumentClosing(planId: string) {
  const { user, plan } = await requireCompanyAdminForPlan(planId);

  const rateLimit = await checkAiGenerationRateLimit(user.id);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);

  const supabase = await createClient();
  const [{ data: themeRows }, { data: objectiveRows }] = await Promise.all([
    supabase
      .from("strategic_themes")
      .select("id, theme_number, title, intended_result")
      .eq("plan_id", planId)
      .order("sort_order", { ascending: true }),
    supabase.from("strategic_objectives").select("id, perspective, objective_text").eq("plan_id", planId),
  ]);

  let extraContext: string | undefined;
  if ((themeRows && themeRows.length > 0) || (objectiveRows && objectiveRows.length > 0)) {
    const themes: ThemeResult[] = (themeRows ?? []).map((t) => ({
      id: t.id,
      themeNumber: t.theme_number,
      title: t.title,
      intendedResult: t.intended_result ?? "",
    }));
    const objectives: ObjectiveResult[] = (objectiveRows ?? []).map((o) => ({
      id: o.id,
      objectiveText: o.objective_text,
      perspective: o.perspective,
    }));
    extraContext = `\nTHE FOLLOWING HAVE ALREADY BEEN FINALIZED — reference them where relevant rather than inventing different ones:\n\nStrategic Themes:\n${formatThemesSummary(themes)}\n\nCorporate Strategic Objectives:\n${formatObjectivesSummary(objectives)}`;
  }

  let result;
  try {
    result = await generatePlanDocumentSections(planId, plan.tenant_id, SECTIONS_6_TO_9, extraContext);
  } finally {
    await recordAiGenerationAttempt(user.id);
  }
  revalidatePath(`/dashboard/plan/${planId}`);
  return result;
}

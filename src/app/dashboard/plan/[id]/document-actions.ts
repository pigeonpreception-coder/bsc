"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
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

// Sections 1-4 are descriptive/analytical and depend only on the Business
// Profile + Strategic Profile intake — Section 5 (Strategic Themes) and
// beyond need the themes generated first, so they're a separate step.
const SECTIONS_1_TO_4 = ["1", "2", "3", "4"];
const SECTIONS_6_TO_9 = ["6", "7", "8", "9"];

async function requireCompanyAdminForPlan(planId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: plan } = await supabase.from("strategic_plans").select("id, tenant_id").eq("id", planId).single();
  if (!plan || plan.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  return plan;
}

export async function generatePlanDocumentIntro(planId: string) {
  await requireCompanyAdminForPlan(planId);

  const result = await generatePlanDocumentSections(planId, SECTIONS_1_TO_4);
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
  await requireCompanyAdminForPlan(planId);

  const objectives = await generateCorporateObjectives(planId);
  const themes = await generateStrategicThemes(planId, objectives);
  await alignObjectivesToThemes(planId, objectives, themes);

  const extraContext = `\nTHE FOLLOWING HAVE ALREADY BEEN FINALIZED — Section 5.2's content must accurately describe these and only these, do not invent different ones:\n\nStrategic Themes:\n${formatThemesSummary(themes)}\n\nCorporate Strategic Objectives:\n${formatObjectivesSummary(objectives)}`;

  const result = await generatePlanDocumentSections(planId, ["5"], extraContext);
  revalidatePath(`/dashboard/plan/${planId}`);
  return { ...result, objectives, themes };
}

// Sections 6-9 reference the themes/objectives already created (per the
// original generation-order spec), so this fetches whatever was saved by
// generatePlanSection5 and feeds it in as context — if Section 5 hasn't
// been run yet, this still works, just without that extra context.
export async function generatePlanDocumentClosing(planId: string) {
  await requireCompanyAdminForPlan(planId);

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

  const result = await generatePlanDocumentSections(planId, SECTIONS_6_TO_9, extraContext);
  revalidatePath(`/dashboard/plan/${planId}`);
  return result;
}

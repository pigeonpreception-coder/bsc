"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateRows, rowsToInsert } from "@/lib/bsc-generation";

export async function generateBalancedScorecards(planId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: plan } = await supabase.from("strategic_plans").select("*").eq("id", planId).single();
  if (!plan || plan.tenant_id !== user.tenant_id) throw new Error("Not authorized");
  if (plan.status !== "active") throw new Error("Approve the strategic plan before generating scorecards");

  const ai = plan.ai_generated_content as {
    executive_summary: string;
    strategic_pillars: string[];
    strategic_objectives: { perspective: string; objective: string; description?: string }[];
    kpis: { objective: string; kpi: string; target?: string }[];
  } | null;
  if (!ai) throw new Error("Generate and approve the strategic plan first");

  // Clear any previous generation for this plan (idempotent re-run).
  const { data: existingScorecards } = await supabase.from("scorecards").select("id").eq("plan_id", planId);
  if (existingScorecards && existingScorecards.length > 0) {
    await supabase.from("scorecards").delete().eq("plan_id", planId);
  }

  // --- 1. Corporate BSC ---
  const corporatePrompt = `Create a Corporate Balanced Scorecard for ${plan.company_name} based on this approved strategic plan.

Executive summary: ${ai.executive_summary}
Strategic pillars: ${ai.strategic_pillars.join("; ")}
Strategic objectives: ${ai.strategic_objectives.map((o) => `[${o.perspective}] ${o.objective}`).join("; ")}
KPIs already identified: ${ai.kpis.map((k) => `${k.kpi} (target: ${k.target ?? "n/a"})`).join("; ")}

Produce 8-12 scorecard rows covering all four BSC perspectives (Financial; Customer & Stakeholder; Internal Processes; Organisational Capacity), grouped by strategic objective. For each row give: strategic objective, strategic theme alignment (which pillar it ladders up to), intended result, key initiatives & their intended results, perspective weight (%; the four perspective weights sum to 100), objective weight (%; objectives sum to 100 within their perspective), KPI, unit, baseline, target, and measurement frequency. Set lower_is_better=true for cost/error/days-type KPIs. Do not set actuals — those are measured later. Call submit_scorecard.`;

  const corporateRows = await generateRows(corporatePrompt);

  const { data: corporateScorecard, error: corpError } = await supabase
    .from("scorecards")
    .insert({
      tenant_id: plan.tenant_id,
      plan_id: planId,
      scorecard_type: "corporate",
      name: `${plan.company_name} — Corporate Scorecard`,
      status: "active",
    })
    .select()
    .single();
  if (corpError) throw corpError;

  await supabase.from("scorecard_rows").insert(rowsToInsert(corporateRows, corporateScorecard.id, plan.tenant_id));

  // --- 2. Departmental BSCs ---
  const departments: string[] = plan.questionnaire_answers?.departments ?? [];
  const departmentScorecardIds: Record<string, string> = {};

  for (const department of departments) {
    const deptPrompt = `Create a Departmental Balanced Scorecard for the ${department} department at ${plan.company_name}, cascaded from and aligned to this Corporate Scorecard:

${corporateRows.map((r) => `[${r.perspective}] ${r.strategic_objective} — KPI: ${r.kpi} (target: ${r.target})`).join("\n")}

Produce 5-8 rows specific to what the ${department} department must do to support the corporate objectives above, across the relevant BSC perspectives. Call submit_scorecard.`;

    const deptRows = await generateRows(deptPrompt);

    const { data: deptScorecard, error: deptError } = await supabase
      .from("scorecards")
      .insert({
        tenant_id: plan.tenant_id,
        plan_id: planId,
        scorecard_type: "departmental",
        name: `${department} — Departmental Scorecard`,
        department_name: department,
        parent_scorecard_id: corporateScorecard.id,
        status: "active",
      })
      .select()
      .single();
    if (deptError) throw deptError;

    departmentScorecardIds[department] = deptScorecard.id;
    await supabase.from("scorecard_rows").insert(rowsToInsert(deptRows, deptScorecard.id, plan.tenant_id));
  }

  // --- 3. Individual BSCs (one per staff member with an assigned department) ---
  const { data: staff } = await supabase
    .from("users")
    .select("id, full_name, email, role, department")
    .eq("tenant_id", plan.tenant_id)
    .in("role", ["manager", "staff"])
    .not("department", "is", null);

  for (const member of staff ?? []) {
    const deptScorecardId = departmentScorecardIds[member.department as string];
    if (!deptScorecardId) continue;

    const { data: deptRows } = await supabase
      .from("scorecard_rows")
      .select("perspective, strategic_objective, kpi, target")
      .eq("scorecard_id", deptScorecardId);

    const individualPrompt = `Create an Individual Balanced Scorecard for ${member.full_name || member.email} (${member.role} in the ${member.department} department) at ${plan.company_name}, cascaded from this Departmental Scorecard:

${(deptRows ?? []).map((r) => `[${r.perspective}] ${r.strategic_objective} — KPI: ${r.kpi} (target: ${r.target})`).join("\n")}

Produce 3-6 rows representing this individual's personal contribution and KPIs supporting the departmental objectives above. Call submit_scorecard.`;

    const individualRows = await generateRows(individualPrompt);

    const { data: individualScorecard, error: indivError } = await supabase
      .from("scorecards")
      .insert({
        tenant_id: plan.tenant_id,
        plan_id: planId,
        scorecard_type: "individual",
        name: `${member.full_name || member.email} — Individual Scorecard`,
        department_name: member.department,
        owner_user_id: member.id,
        parent_scorecard_id: deptScorecardId,
        status: "active",
      })
      .select()
      .single();
    if (indivError) throw indivError;

    await supabase
      .from("scorecard_rows")
      .insert(rowsToInsert(individualRows, individualScorecard.id, plan.tenant_id));
  }

  await supabase.from("ai_sessions").insert({
    tenant_id: plan.tenant_id,
    user_id: user.id,
    session_type: "bsc_generation",
    prompt_summary: `Generate cascading BSCs for ${plan.company_name}`,
    response_summary: `Corporate + ${departments.length} departmental + ${(staff ?? []).length} individual scorecards`,
  });

  revalidatePath(`/dashboard/plan/${planId}`);
  revalidatePath("/dashboard/scorecards");
}

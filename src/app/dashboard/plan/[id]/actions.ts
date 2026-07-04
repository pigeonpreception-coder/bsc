"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";

const PERSPECTIVES = ["Financial", "Customer", "Internal Process", "Learning & Growth"] as const;

const PLAN_TOOL = {
  name: "submit_strategic_plan",
  description: "Submit a structured Corporate Strategic Plan.",
  input_schema: {
    type: "object" as const,
    properties: {
      executive_summary: { type: "string" },
      swot: {
        type: "object",
        properties: {
          strengths: { type: "array", items: { type: "string" } },
          weaknesses: { type: "array", items: { type: "string" } },
          opportunities: { type: "array", items: { type: "string" } },
          threats: { type: "array", items: { type: "string" } },
        },
        required: ["strengths", "weaknesses", "opportunities", "threats"],
      },
      strategic_pillars: { type: "array", items: { type: "string" } },
      strategic_objectives: {
        type: "array",
        items: {
          type: "object",
          properties: {
            perspective: { type: "string", enum: PERSPECTIVES },
            objective: { type: "string" },
            description: { type: "string" },
          },
          required: ["perspective", "objective"],
        },
      },
      kpis: {
        type: "array",
        items: {
          type: "object",
          properties: {
            objective: { type: "string" },
            kpi: { type: "string" },
            target: { type: "string" },
          },
          required: ["objective", "kpi"],
        },
      },
      implementation_roadmap: {
        type: "array",
        items: {
          type: "object",
          properties: {
            phase: { type: "string" },
            timeframe: { type: "string" },
            focus: { type: "string" },
          },
          required: ["phase", "timeframe", "focus"],
        },
      },
    },
    required: [
      "executive_summary",
      "swot",
      "strategic_pillars",
      "strategic_objectives",
      "kpis",
      "implementation_roadmap",
    ],
  },
};

async function requireCompanyAdminForPlan(planId: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin") throw new Error("Not authorized");

  const supabase = await createClient();
  const { data: plan } = await supabase.from("strategic_plans").select("*").eq("id", planId).single();
  if (!plan || plan.tenant_id !== user.tenant_id) throw new Error("Not authorized");

  return { user, plan, supabase };
}

export async function generateStrategicPlan(planId: string) {
  const { user, plan, supabase } = await requireCompanyAdminForPlan(planId);
  const answers = plan.questionnaire_answers ?? {};

  const prompt = `You are a strategic planning advisor. Draft a Corporate Strategic Plan for the following company based on their questionnaire answers.

Company name: ${plan.company_name}
Industry: ${answers.industry ?? "n/a"}
Country: ${answers.country ?? "n/a"}
Number of employees: ${answers.employee_count ?? "n/a"}
Vision: ${plan.vision ?? "n/a"}
Mission: ${plan.mission ?? "n/a"}
Core values: ${(plan.values ?? []).join(", ") || "n/a"}
Planning period: ${plan.strategic_period_years} years (${plan.period_start} to ${plan.period_end})
Top strategic priorities/challenges: ${(answers.strategic_priorities ?? []).join("; ") || "n/a"}
Key products/services: ${(answers.products_services ?? []).join("; ") || "n/a"}
Key target markets/customer segments: ${(answers.target_markets ?? []).join("; ") || "n/a"}
Key competitors: ${(answers.competitors ?? []).join("; ") || "n/a"}
Recent financial performance: ${answers.financial_performance || "n/a"}
Departments to include in BSC cascade: ${(answers.departments ?? []).join(", ") || "n/a"}

Produce: an Executive Summary, a SWOT analysis, 3-5 Strategic Pillars, Strategic Objectives grouped across all four Balanced Scorecard perspectives (Financial, Customer, Internal Process, Learning & Growth), a set of Key Performance Indicators tied to those objectives, and a phased Strategic Implementation Roadmap covering the planning period. Call the submit_strategic_plan tool with your answer.`;

  const anthropic = createAnthropicClient();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [PLAN_TOOL],
    tool_choice: { type: "tool", name: "submit_strategic_plan" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return a structured plan");
  }
  const generated = toolUse.input as Record<string, unknown>;

  const { error: updateError } = await supabase
    .from("strategic_plans")
    .update({ ai_generated_content: generated })
    .eq("id", planId);
  if (updateError) throw updateError;

  const objectives = (generated.strategic_objectives as Array<{ perspective: string; objective: string }>) ?? [];

  await supabase.from("strategic_objectives").delete().eq("plan_id", planId);
  if (objectives.length > 0) {
    const { error: objectivesError } = await supabase.from("strategic_objectives").insert(
      objectives.map((o) => ({
        plan_id: planId,
        tenant_id: plan.tenant_id,
        perspective: o.perspective,
        objective_text: o.objective,
      })),
    );
    if (objectivesError) throw objectivesError;
  }

  await supabase.from("ai_sessions").insert({
    tenant_id: plan.tenant_id,
    user_id: user.id,
    session_type: "plan_generation",
    prompt_summary: `Generate strategic plan for ${plan.company_name}`,
    response_summary: (generated.executive_summary as string)?.slice(0, 500),
  });

  revalidatePath(`/dashboard/plan/${planId}`);
}

export async function approveStrategicPlan(planId: string) {
  const { supabase } = await requireCompanyAdminForPlan(planId);

  const { error } = await supabase.from("strategic_plans").update({ status: "active" }).eq("id", planId);
  if (error) throw error;

  revalidatePath(`/dashboard/plan/${planId}`);
}

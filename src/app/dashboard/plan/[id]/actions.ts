"use server";

import { revalidatePath } from "next/cache";
import Anthropic from "@anthropic-ai/sdk";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";
import { extractDocumentText, fetchWebsiteText } from "@/lib/document-extract";
import type { CascadingEntry } from "@/app/dashboard/questionnaire/CascadingList";
import type { StatusRowEntry } from "@/app/dashboard/questionnaire/StatusRowList";

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

  const values = (plan.values as CascadingEntry[] | null) ?? [];
  const priorities = (plan.strategic_priorities as CascadingEntry[] | null) ?? [];
  const customers = (plan.key_customers as StatusRowEntry[] | null) ?? [];
  const stakeholders = (plan.key_stakeholders as StatusRowEntry[] | null) ?? [];

  const industryLine = plan.industry === "Others" ? plan.industry_other : plan.industry;
  const sectorLine = plan.sector === "Others" ? plan.sector_other : plan.sector;

  let fileContext = "";
  if (plan.company_profile_url) {
    const admin = createAdminClient();
    const { data: file } = await admin.storage.from("company-documents").download(plan.company_profile_url);
    if (file) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const text = await extractDocumentText(buffer, plan.company_profile_url);
      if (text) fileContext = `\n\nExcerpt from uploaded company profile document:\n${text}`;
    }
  }

  let websiteContext = "";
  if (plan.website_url) {
    const text = await fetchWebsiteText(plan.website_url);
    if (text) websiteContext = `\n\nExcerpt from company website (${plan.website_url}):\n${text}`;
  }

  const prompt = `You are a strategic planning advisor. Draft a Corporate Strategic Plan for the following company based on their Business & Strategic Profile.

Company name: ${plan.company_name}
Industry: ${industryLine ?? "n/a"}
Sector: ${sectorLine ?? "n/a"}
Vision: ${plan.vision ?? "n/a"}
Mission: ${plan.mission ?? "n/a"}
Core values: ${values.map((v) => `${v.name} — ${v.description}`).join("; ") || "n/a"}
Overall strategic goal: ${plan.overall_strategic_goal ?? "n/a"}
Strategic priorities: ${priorities.map((p) => `${p.name} — ${p.description}`).join("; ") || "n/a"}
Business description: ${plan.business_description ?? "n/a"}
Business background: ${plan.business_background ?? "n/a"}
Business direction & ambition: ${plan.business_direction ?? "n/a"}
Planning period: ${plan.strategic_period_years} years (${plan.period_start} to ${plan.period_end})
Vision achievement target: ${plan.vision_achievement_date ?? "n/a"}
Key customer segments: ${customers.filter((c) => c.description).map((c) => `${c.description} (${c.status})`).join("; ") || "n/a"}
Key stakeholders: ${stakeholders.filter((s) => s.description).map((s) => `${s.description} (${s.status})`).join("; ") || "n/a"}
Additional context: ${plan.additional_info || "n/a"}${fileContext}${websiteContext}

Produce: an Executive Summary, a SWOT analysis, 3-5 Strategic Pillars, Strategic Objectives grouped across all four Balanced Scorecard perspectives (Financial, Customer, Internal Process, Learning & Growth), a set of Key Performance Indicators tied to those objectives, and a phased Strategic Implementation Roadmap covering the planning period. Call the submit_strategic_plan tool with your answer.`;

  const anthropic = createAnthropicClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 4096,
      tools: [PLAN_TOOL],
      tool_choice: { type: "tool", name: "submit_strategic_plan" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    if (err instanceof Anthropic.APIError && err.status === 401) {
      throw new Error(
        "The Anthropic API key is invalid or expired. Please check ANTHROPIC_API_KEY and try again.",
      );
    }
    if (err instanceof Anthropic.APIError && err.status === 400 && /credit balance/i.test(err.message)) {
      throw new Error("The Anthropic account has run out of credit. Please add credits and try again.");
    }
    throw err;
  }

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

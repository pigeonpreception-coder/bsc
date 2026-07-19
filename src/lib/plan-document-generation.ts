import "server-only";
import { createAnthropicClient, CLAUDE_MODEL, friendlyAnthropicError } from "@/lib/anthropic";
import { createAdminClient } from "@/lib/supabase/admin";
import { buildUploadedDocumentContext } from "@/lib/document-extract";
import { getPlanTemplate, flattenSections, type PlanSectionTemplateNode } from "@/lib/plan-templates/registry";
import type { CascadingEntry } from "@/app/dashboard/questionnaire/CascadingList";
import type { StatusRowEntry } from "@/app/dashboard/questionnaire/StatusRowList";

const SECTIONS_TOOL = {
  name: "submit_plan_sections",
  description: "Submit generated content for the requested Strategic Plan document sections.",
  input_schema: {
    type: "object" as const,
    properties: {
      sections: {
        type: "array",
        items: {
          type: "object",
          properties: {
            section_number: {
              type: "string",
              description:
                'Must exactly match one of the requested section numbers, OR — only for a section you are adding under one marked as addable — a new number extending it (e.g. "3.1.4" under requested section "3.1").',
            },
            section_title: { type: "string" },
            content: {
              type: "string",
              description: "Full prose content for this section, written to board-level consulting standard.",
            },
            parent_section_number: {
              type: "string",
              description:
                "Only set this when section_number is a new AI-added subsection not in the requested list — the exact number of the addable section it belongs under. Omit for every section that was in the requested list.",
            },
          },
          required: ["section_number", "section_title", "content"],
        },
      },
    },
    required: ["sections"],
  },
};

type GeneratedSection = {
  section_number: string;
  section_title: string;
  content: string;
  parent_section_number?: string;
};

// The Business & Strategic Profile intake fields every plan-generation
// prompt needs — shared so Sections 1-4, Strategic Themes, and any future
// generation step describe the same company the same way.
export async function buildCompanyContextBlock(
  plan: Record<string, unknown> & {
    company_profile_url: string | null;
    strategic_plan_document_url: string | null;
    supporting_documents: { url: string; fileName: string }[] | null;
    website_url: string | null;
  },
): Promise<string> {
  const values = (plan.values as CascadingEntry[] | null) ?? [];
  const priorities = (plan.strategic_priorities as CascadingEntry[] | null) ?? [];
  const customers = (plan.key_customers as StatusRowEntry[] | null) ?? [];
  const stakeholders = (plan.key_stakeholders as StatusRowEntry[] | null) ?? [];
  const productsServices = (plan.key_products_services as StatusRowEntry[] | null) ?? [];
  const industryLine = plan.industry === "Others" ? plan.industry_other : plan.industry;
  const sectorLine = plan.sector === "Others" ? plan.sector_other : plan.sector;
  const documentContext = await buildUploadedDocumentContext(plan);

  return `Industry: ${industryLine ?? "n/a"}
Sector: ${sectorLine ?? "n/a"}
Vision: ${plan.vision ?? "n/a"}
Mission: ${plan.mission ?? "n/a"}
Core values: ${values.map((v) => `${v.name} — ${v.description}`).join("; ") || "n/a"}
Overall strategic goal: ${plan.overall_strategic_goal ?? "n/a"}
Strategic priorities: ${priorities.map((p) => `${p.name} — ${p.description}`).join("; ") || "n/a"}
Business description: ${plan.business_description ?? "n/a"}
Business background: ${plan.business_background ?? "n/a"}
Business direction & ambition: ${plan.business_direction ?? "n/a"}
Planning period: ${plan.strategic_period_years ?? "n/a"} years (${plan.period_start ?? "n/a"} to ${plan.period_end ?? "n/a"})
Vision achievement target: ${plan.vision_achievement_date ?? "n/a"}
Key customer segments: ${customers.filter((c) => c.description).map((c) => `${c.description} (${c.status})`).join("; ") || "n/a"}
Key stakeholders: ${stakeholders.filter((s) => s.description).map((s) => `${s.description} (${s.status})`).join("; ") || "n/a"}
Key/core products & services: ${productsServices.filter((p) => p.description).map((p) => `${p.description} (${p.status})`).join("; ") || "n/a"}
Additional context: ${plan.additional_info || "n/a"}${documentContext}`;
}

export async function generatePlanDocumentSections(
  planId: string,
  topLevelSectionNumbers: string[],
  extraContext?: string,
) {
  const supabase = createAdminClient();

  const { data: plan, error: planError } = await supabase
    .from("strategic_plans")
    .select("*")
    .eq("id", planId)
    .single();
  if (planError || !plan) throw new Error("Strategic plan not found");

  const { data: tenant, error: tenantError } = await supabase
    .from("tenants")
    .select("client_type")
    .eq("id", plan.tenant_id)
    .single();
  if (tenantError || !tenant) throw new Error("Tenant not found");

  const template = getPlanTemplate(tenant.client_type);
  const requestedTopNodes = template.sections.filter((s) => topLevelSectionNumbers.includes(s.number));
  if (requestedTopNodes.length === 0) {
    throw new Error(
      `None of the requested section numbers (${topLevelSectionNumbers.join(", ")}) exist in the ${template.name} template.`,
    );
  }

  const allNodesInScope = flattenSections(requestedTopNodes);
  const nodesToWrite = allNodesInScope.filter((n) => n.kind === "ai_generated");

  const industryLine = plan.industry === "Others" ? plan.industry_other : plan.industry;
  const sectorLine = plan.sector === "Others" ? plan.sector_other : plan.sector;
  const companyContext = await buildCompanyContextBlock(plan);

  const sectionList = nodesToWrite
    .map((n) => {
      const guidance = n.guidance ? ` — ${n.guidance}` : "";
      const addable = n.isAiAddable ? ` (you may add further numbered subsections under this one, e.g. "${n.number}.1")` : "";
      return `- ${n.number} ${n.title}${guidance}${addable}`;
    })
    .join("\n");

  const prompt = `You are Safina AI, a senior corporate strategist producing a board-level Corporate Strategic Plan for ${plan.company_name}, a ${industryLine ?? "n/a"} company in the ${sectorLine ?? "n/a"} sector.

Produce content of the highest professional consulting standard — comparable to McKinsey, BCG, or Bain deliverables — well-researched, clearly articulated, and aligned to the local market(s) where this client operates.

COMPANY INTAKE DATA:
${companyContext}
${extraContext ?? ""}

SECTIONS TO WRITE (write full prose content for every one of these):
${sectionList}

STRUCTURAL RULES:
- Follow the section numbers given exactly for the sections listed above — do not invent numbers outside this list except as addable subsections described below.
- Where a section is marked as addable, you may append further subsections beneath it with a new section_number that extends its number (e.g. under "3.1" you might add "3.1.4") — set parent_section_number to the exact number of the section you are adding beneath.
- Write substantive, specific, non-generic content — reference the company's actual industry, sector, and intake data throughout rather than generic boilerplate.

Call the submit_plan_sections tool with your answer.`;

  const anthropic = createAnthropicClient();
  let response;
  try {
    response = await anthropic.messages.create({
      model: CLAUDE_MODEL,
      max_tokens: 8192,
      tools: [SECTIONS_TOOL],
      tool_choice: { type: "tool", name: "submit_plan_sections" },
      messages: [{ role: "user", content: prompt }],
    });
  } catch (err) {
    throw friendlyAnthropicError(err);
  }

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") throw new Error("AI did not return structured plan sections");
  const { sections } = toolUse.input as { sections: GeneratedSection[] };

  const nodeByNumber = new Map(allNodesInScope.map((n) => [n.number, n]));
  const contentByNumber = new Map(
    sections.filter((s) => nodeByNumber.has(s.section_number)).map((s) => [s.section_number, s.content]),
  );
  const extraSections = sections.filter((s) => !nodeByNumber.has(s.section_number));

  // Regenerating these top-level sections replaces their previous rows —
  // parent_section_id cascades, so this also clears their old subsections.
  const { error: deleteError } = await supabase
    .from("plan_sections")
    .delete()
    .eq("plan_id", planId)
    .in(
      "section_number",
      requestedTopNodes.map((n) => n.number),
    );
  if (deleteError) throw deleteError;

  const idByNumber = new Map<string, string>();
  const now = new Date().toISOString();
  let sortOrder = 0;

  async function insertNode(node: PlanSectionTemplateNode, parentId: string | null) {
    const { data, error } = await supabase
      .from("plan_sections")
      .insert({
        tenant_id: plan.tenant_id,
        plan_id: planId,
        section_number: node.number,
        section_title: node.title,
        parent_section_id: parentId,
        depth: node.depth,
        content: contentByNumber.get(node.number) ?? null,
        is_placeholder: node.kind === "placeholder",
        is_dynamic: node.kind === "dynamic_org_structure" || node.kind === "dynamic_bsc",
        is_ai_addable: node.isAiAddable,
        sort_order: sortOrder++,
        last_generated_at: node.kind === "ai_generated" ? now : null,
      })
      .select("id")
      .single();
    if (error) throw error;
    idByNumber.set(node.number, data.id as string);
    for (const child of node.children ?? []) {
      await insertNode(child, data.id as string);
    }
  }

  for (const node of requestedTopNodes) {
    await insertNode(node, null);
  }

  for (const extra of extraSections) {
    const parentNode = extra.parent_section_number ? nodeByNumber.get(extra.parent_section_number) : undefined;
    const parentId = extra.parent_section_number ? idByNumber.get(extra.parent_section_number) : undefined;
    if (!parentNode || !parentId || !parentNode.isAiAddable) continue; // malformed AI output — skip rather than fail the whole batch

    const { error } = await supabase.from("plan_sections").insert({
      tenant_id: plan.tenant_id,
      plan_id: planId,
      section_number: extra.section_number,
      section_title: extra.section_title,
      parent_section_id: parentId,
      depth: Math.min(parentNode.depth + 1, 3),
      content: extra.content,
      is_placeholder: false,
      is_dynamic: false,
      is_ai_addable: false,
      sort_order: sortOrder++,
      last_generated_at: now,
    });
    if (error) throw error;
  }

  return { sectionsWritten: contentByNumber.size + extraSections.length };
}

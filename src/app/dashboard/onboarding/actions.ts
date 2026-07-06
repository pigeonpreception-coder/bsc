"use server";

import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { createAnthropicClient, CLAUDE_MODEL } from "@/lib/anthropic";

// ─── Types matching the client hierarchy ─────────────────────

type CustomField = { label: string; value: string };

type PositionNode = {
  tempId: string;
  positionType: "board" | "executive" | "non_executive";
  officeDepartmentName: string;
  jobTitle: string;
  firstName: string;
  surname: string;
  customFields: CustomField[];
  children: PositionNode[];
  titleOptions?: string[];
};

type ScorecardRowInput = {
  perspective: string;
  strategic_objective: string;
  intended_result: string;
  kpi: string;
  baseline: string;
  target: string;
  unit: string;
  weight: number;
  initiative: string;
  timeline: string;
  notes: string;
};

// ─── Save Hierarchy ──────────────────────────────────────────

export async function saveOrgHierarchy(hierarchyJson: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id)
    throw new Error("Not authorized");

  const supabase = await createClient();
  const hierarchy: PositionNode = JSON.parse(hierarchyJson);
  const tenantId = user.tenant_id!;

  // Clear existing positions for this tenant (idempotent re-save)
  await supabase.from("org_positions").delete().eq("tenant_id", tenantId);

  // Flatten tree and insert with parent references
  const insertions: Array<{
    id?: string;
    tenant_id: string;
    position_type: string;
    office_department_name: string;
    job_title: string;
    first_name: string | null;
    surname: string | null;
    reports_to_id: string | null;
    custom_fields: Record<string, string>;
    bsc_level: string;
    sort_order: number;
  }> = [];

  let sortCounter = 0;

  function flattenNode(node: PositionNode, parentDbId: string | null) {
    // Determine BSC level
    let bscLevel: string;
    if (node.positionType === "board") bscLevel = "corporate";
    else if (node.positionType === "executive") bscLevel = "executive";
    else bscLevel = "departmental";

    const customFieldsObj: Record<string, string> = {};
    for (const cf of node.customFields) {
      if (cf.label.trim()) customFieldsObj[cf.label] = cf.value;
    }

    const entry = {
      tenant_id: tenantId,
      position_type: node.positionType,
      office_department_name: node.officeDepartmentName,
      job_title: node.jobTitle,
      first_name: node.firstName || null,
      surname: node.surname || null,
      reports_to_id: parentDbId,
      custom_fields: customFieldsObj,
      bsc_level: bscLevel,
      sort_order: sortCounter++,
    };

    insertions.push(entry);

    // Insert one at a time to get the generated ID for parent referencing
    return entry;
  }

  // Recursive insert (one by one to capture parent IDs)
  async function insertRecursive(node: PositionNode, parentDbId: string | null) {
    const entry = flattenNode(node, parentDbId);

    const { data, error } = await supabase
      .from("org_positions")
      .insert(entry)
      .select("id")
      .single();
    if (error) throw error;

    const dbId = data.id;

    for (const child of node.children) {
      await insertRecursive(child, dbId);
    }
  }

  await insertRecursive(hierarchy, null);

  // Mark onboarding as done
  await supabase
    .from("tenants")
    .update({ onboarding_completed: true })
    .eq("id", tenantId);

  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard");
}

// ─── AI BSC Generation ───────────────────────────────────────

const SCORECARD_TOOL = {
  name: "submit_scorecard",
  description: "Submit Balanced Scorecard rows in the 14-column FCTS template.",
  input_schema: {
    type: "object" as const,
    properties: {
      rows: {
        type: "array",
        items: {
          type: "object",
          properties: {
            perspective: {
              type: "string",
              enum: ["Financial", "Customer", "Internal Process", "Learning & Growth"],
            },
            strategic_objective: { type: "string" },
            intended_result: { type: "string" },
            kpi: { type: "string" },
            baseline: { type: "string" },
            target: { type: "string" },
            unit: { type: "string" },
            weight: { type: "number" },
            initiative: { type: "string" },
            timeline: { type: "string" },
            notes: { type: "string" },
          },
          required: [
            "perspective",
            "strategic_objective",
            "intended_result",
            "kpi",
            "baseline",
            "target",
            "unit",
            "weight",
            "initiative",
            "timeline",
          ],
        },
      },
    },
    required: ["rows"],
  },
};

async function generateRows(prompt: string): Promise<ScorecardRowInput[]> {
  const anthropic = createAnthropicClient();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [SCORECARD_TOOL],
    tool_choice: { type: "tool", name: "submit_scorecard" },
    messages: [{ role: "user", content: prompt }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("AI did not return scorecard rows");
  }
  return (toolUse.input as { rows: ScorecardRowInput[] }).rows;
}

function rowsToInsert(rows: ScorecardRowInput[], scorecardId: string, tenantId: string) {
  return rows.map((r, i) => ({
    scorecard_id: scorecardId,
    tenant_id: tenantId,
    perspective: r.perspective,
    strategic_objective: r.strategic_objective,
    intended_result: r.intended_result,
    kpi: r.kpi,
    baseline: r.baseline,
    target: r.target,
    unit: r.unit,
    weight: r.weight,
    initiative: r.initiative,
    timeline: r.timeline,
    notes: r.notes ?? null,
    sort_order: i,
  }));
}

type OrgPositionRow = {
  id: string;
  position_type: string;
  office_department_name: string;
  job_title: string;
  first_name: string | null;
  surname: string | null;
  reports_to_id: string | null;
  bsc_level: string;
  sort_order: number;
};

export async function generateCascadedBSCs() {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id)
    throw new Error("Not authorized");

  const supabase = await createClient();

  // Load the strategic plan + corporate BSC context
  const { data: plan } = await supabase
    .from("strategic_plans")
    .select("*")
    .eq("tenant_id", user.tenant_id)
    .eq("status", "active")
    .maybeSingle();

  if (!plan) throw new Error("You need an approved Strategic Plan before generating cascaded BSCs.");

  const ai = plan.ai_generated_content as {
    executive_summary: string;
    strategic_pillars: string[];
    strategic_objectives: { perspective: string; objective: string }[];
    kpis: { objective: string; kpi: string; target?: string }[];
  } | null;

  // Load existing corporate scorecard rows for context
  const { data: corpScorecard } = await supabase
    .from("scorecards")
    .select("id")
    .eq("plan_id", plan.id)
    .eq("scorecard_type", "corporate")
    .maybeSingle();

  let corporateContext = "";
  if (corpScorecard) {
    const { data: corpRows } = await supabase
      .from("scorecard_rows")
      .select("perspective, strategic_objective, kpi, target")
      .eq("scorecard_id", corpScorecard.id);
    if (corpRows && corpRows.length > 0) {
      corporateContext = corpRows
        .map((r) => `[${r.perspective}] ${r.strategic_objective} — KPI: ${r.kpi} (target: ${r.target ?? "n/a"})`)
        .join("\n");
    }
  }

  if (!corporateContext && ai) {
    corporateContext = ai.strategic_objectives
      .map((o) => `[${o.perspective}] ${o.objective}`)
      .join("\n");
  }

  // Load org positions
  const { data: positions } = await supabase
    .from("org_positions")
    .select("*")
    .eq("tenant_id", user.tenant_id)
    .order("sort_order", { ascending: true });

  if (!positions || positions.length === 0)
    throw new Error("No organisational hierarchy found. Complete the onboarding wizard first.");

  // Clear previously generated position scorecards
  await supabase.from("position_scorecards").delete().eq("tenant_id", user.tenant_id);
  // Delete non-corporate scorecards that were generated from org positions
  const { data: existingNonCorp } = await supabase
    .from("scorecards")
    .select("id")
    .eq("tenant_id", user.tenant_id)
    .in("scorecard_type", ["executive", "departmental", "individual"]);
  if (existingNonCorp && existingNonCorp.length > 0) {
    const ids = existingNonCorp.map((s) => s.id);
    await supabase.from("scorecards").delete().in("id", ids);
  }

  // Build tree from flat list
  const posMap = new Map<string, OrgPositionRow>();
  for (const p of positions) posMap.set(p.id, p as OrgPositionRow);

  // Find the board (root), then CEO under it
  const board = positions.find((p) => p.position_type === "board");
  if (!board) throw new Error("Board of Directors not found in hierarchy.");

  // Build children map
  const childrenOf = new Map<string, OrgPositionRow[]>();
  for (const p of positions) {
    if (p.reports_to_id) {
      const list = childrenOf.get(p.reports_to_id) ?? [];
      list.push(p as OrgPositionRow);
      childrenOf.set(p.reports_to_id, list);
    }
  }

  // Track generated scorecard context per position for cascade
  const positionScorecardContext = new Map<string, string>();

  // Process positions top-down (BFS)
  const queue: OrgPositionRow[] = childrenOf.get(board.id) ?? [];

  const companyName = plan.company_name;

  for (const pos of queue) {
    // Add children to queue
    const kids = childrenOf.get(pos.id) ?? [];
    queue.push(...kids);

    const fullName = [pos.first_name, pos.surname].filter(Boolean).join(" ") || pos.job_title;
    const parentContext = pos.reports_to_id
      ? positionScorecardContext.get(pos.reports_to_id) ?? corporateContext
      : corporateContext;

    const isExecutive = pos.position_type === "executive";
    const levelLabel = isExecutive ? "Strategic / Executive" : "Operational / Departmental";
    const rowCountHint = isExecutive ? "8-12" : "5-8";

    // ─── 1. Office / Department BSC ───────────────────────

    const officeBscPrompt = `You are an expert corporate strategist and Balanced Scorecard architect.
You are generating a ${isExecutive ? "Executive Office" : "Departmental"} Balanced Scorecard for the "${pos.office_department_name}" at ${companyName}.

This position is held by: ${fullName} (${pos.job_title})
Level: ${levelLabel}
${isExecutive ? "This BSC must be strategic, high-level, covering the full mandate of this executive office including all subordinate departments." : "This BSC must be operational and delivery-focused, covering day-to-day KPIs, team output, and process efficiency."}

The Corporate Strategic Plan and parent BSC context:
${ai ? `Executive summary: ${ai.executive_summary}\nStrategic pillars: ${ai.strategic_pillars.join("; ")}` : ""}
Parent BSC rows:
${parentContext}

Produce ${rowCountHint} scorecard rows covering all four BSC perspectives (Financial, Customer, Internal Process, Learning & Growth), each cascaded from and aligned with the parent BSC above.
Use the 14-column FCTS template. Call submit_scorecard.`;

    const officeRows = await generateRows(officeBscPrompt);

    const scorecardType = isExecutive ? "executive" : "departmental";
    const { data: officeScorecard, error: offErr } = await supabase
      .from("scorecards")
      .insert({
        tenant_id: user.tenant_id,
        plan_id: plan.id,
        scorecard_type: scorecardType,
        name: `${pos.office_department_name} — ${isExecutive ? "Executive Office" : "Department"} BSC`,
        department_name: pos.office_department_name,
        parent_scorecard_id: corpScorecard?.id ?? null,
        status: "active",
      })
      .select()
      .single();
    if (offErr) throw offErr;

    await supabase
      .from("scorecard_rows")
      .insert(rowsToInsert(officeRows, officeScorecard.id, user.tenant_id));

    // Link position → scorecard
    await supabase.from("position_scorecards").insert({
      tenant_id: user.tenant_id,
      position_id: pos.id,
      scorecard_id: officeScorecard.id,
      scorecard_scope: "office_department",
    });

    // Store context for children cascade
    const officeContext = officeRows
      .map((r) => `[${r.perspective}] ${r.strategic_objective} — KPI: ${r.kpi} (target: ${r.target})`)
      .join("\n");
    positionScorecardContext.set(pos.id, officeContext);

    // ─── 2. Individual BSC for this person ────────────────

    const individualPrompt = `You are an expert corporate strategist and Balanced Scorecard architect.
You are generating an Individual Balanced Scorecard for ${fullName}, ${pos.job_title} at ${companyName}.

This is a PERSONAL BSC showing what this individual must specifically deliver in their role.
It must be role-specific, focused on the personal contributions ${fullName} must make to achieve the ${pos.office_department_name} BSC targets.

${pos.office_department_name} BSC (the parent):
${officeContext}

Produce 4-6 scorecard rows representing this individual's personal KPIs and contribution, cascaded from and aligned with the ${pos.office_department_name} BSC above.
Use the 14-column FCTS template. Call submit_scorecard.`;

    const individualRows = await generateRows(individualPrompt);

    const { data: indivScorecard, error: indErr } = await supabase
      .from("scorecards")
      .insert({
        tenant_id: user.tenant_id,
        plan_id: plan.id,
        scorecard_type: "individual",
        name: `${fullName} — Individual BSC`,
        department_name: pos.office_department_name,
        parent_scorecard_id: officeScorecard.id,
        status: "active",
      })
      .select()
      .single();
    if (indErr) throw indErr;

    await supabase
      .from("scorecard_rows")
      .insert(rowsToInsert(individualRows, indivScorecard.id, user.tenant_id));

    await supabase.from("position_scorecards").insert({
      tenant_id: user.tenant_id,
      position_id: pos.id,
      scorecard_id: indivScorecard.id,
      scorecard_scope: "individual",
    });
  }

  // Log AI session
  const posCount = positions.filter((p) => p.position_type !== "board").length;
  await supabase.from("ai_sessions").insert({
    tenant_id: user.tenant_id,
    user_id: user.id,
    session_type: "bsc_generation",
    prompt_summary: `Generate cascaded BSCs from org hierarchy for ${companyName}`,
    response_summary: `${posCount} positions × 2 BSCs (office/dept + individual) = ${posCount * 2} scorecards`,
  });

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/scorecards");
  revalidatePath("/dashboard/onboarding");
}

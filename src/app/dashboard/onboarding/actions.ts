"use server";

import { randomUUID } from "crypto";
import { revalidatePath } from "next/cache";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateRows, rowsToInsert } from "@/lib/bsc-generation";
import { writeAuditLog } from "@/lib/audit-log";
import { checkAiGenerationRateLimit, recordAiGenerationAttempt } from "@/lib/rate-limit";

// ─── Types matching the client hierarchy ─────────────────────

type CustomField = { label: string; value: string };

type PositionType = "board" | "executive" | "non_executive" | "section_supervisor" | "individual_staff";

type PositionNode = {
  tempId: string;
  positionType: PositionType;
  officeDepartmentName: string;
  sectionName?: string;
  jobTitle: string;
  firstName: string;
  surname: string;
  customFields: CustomField[];
  children: PositionNode[];
  titleOptions?: string[];
};

// ─── Save Hierarchy ──────────────────────────────────────────

// Bounds both the JSON.parse cost and the size of the bulk-insert this
// triggers (one org_positions row per node, then one to two AI calls per
// node in generateCascadedBSCs) — tighter than Next's own 1MB Server
// Action body default, since even within that, a company_admin could
// otherwise submit thousands of tiny position nodes in one save. 300KB is
// generous for any realistic org chart.
const MAX_HIERARCHY_JSON_BYTES = 300_000;

export async function saveOrgHierarchy(hierarchyJson: string) {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id)
    throw new Error("Not authorized");

  if (hierarchyJson.length > MAX_HIERARCHY_JSON_BYTES) {
    throw new Error("This organization structure is too large to save. Reduce the number of positions and try again.");
  }

  const supabase = await createClient();
  const hierarchy: PositionNode = JSON.parse(hierarchyJson);
  const tenantId = user.tenant_id!;

  // Clear existing positions for this tenant (idempotent re-save)
  await supabase.from("org_positions").delete().eq("tenant_id", tenantId);

  // sort_order follows the same pre-order traversal (parent, then each
  // child's whole subtree in listed order) this always used — assigned in
  // its own pass so it stays independent of how insertion is batched below.
  const sortOrderByTempId = new Map<string, number>();
  let sortCounter = 0;
  function assignSortOrder(node: PositionNode) {
    sortOrderByTempId.set(node.tempId, sortCounter++);
    for (const child of node.children) assignSortOrder(child);
  }
  assignSortOrder(hierarchy);

  function buildEntry(node: PositionNode, dbId: string, parentDbId: string | null): Record<string, unknown> {
    let bscLevel: string;
    if (node.positionType === "board") bscLevel = "corporate";
    else if (node.positionType === "executive") bscLevel = "executive";
    else if (node.positionType === "non_executive") bscLevel = "departmental";
    else if (node.positionType === "section_supervisor") bscLevel = "section";
    else bscLevel = "individual";

    const customFieldsObj: Record<string, string> = {};
    for (const cf of node.customFields) {
      if (cf.label.trim()) customFieldsObj[cf.label] = cf.value;
    }

    const entry: Record<string, unknown> = {
      id: dbId,
      tenant_id: tenantId,
      position_type: node.positionType,
      office_department_name: node.positionType === "section_supervisor"
        ? (node.sectionName || node.officeDepartmentName)
        : node.officeDepartmentName,
      job_title: node.jobTitle,
      first_name: node.firstName || null,
      surname: node.surname || null,
      reports_to_id: parentDbId,
      custom_fields: customFieldsObj,
      bsc_level: bscLevel,
      sort_order: sortOrderByTempId.get(node.tempId)!,
    };

    // Add section_name for section supervisors
    if (node.positionType === "section_supervisor") {
      entry.section_name = node.sectionName || null;
    }

    return entry;
  }

  // Level-by-level bulk insert (BFS) instead of one row at a time: every
  // node in a level only needs its parent's id, which is generated
  // client-side (not read back from the DB) before that parent is even
  // inserted, so a whole level can go in a single round trip. An
  // N-position hierarchy used to be N sequential inserts, felt as
  // onboarding-wizard latency while the company_admin waits; it's now
  // depth(tree) round trips.
  let currentLevel: { node: PositionNode; dbId: string; parentDbId: string | null }[] = [
    { node: hierarchy, dbId: randomUUID(), parentDbId: null },
  ];
  while (currentLevel.length > 0) {
    const entries = currentLevel.map(({ node, dbId, parentDbId }) => buildEntry(node, dbId, parentDbId));
    const { error } = await supabase.from("org_positions").insert(entries);
    if (error) throw error;

    const nextLevel: { node: PositionNode; dbId: string; parentDbId: string | null }[] = [];
    for (const { node, dbId } of currentLevel) {
      for (const child of node.children) {
        nextLevel.push({ node: child, dbId: randomUUID(), parentDbId: dbId });
      }
    }
    currentLevel = nextLevel;
  }

  // onboarding_completed is set only once cascade generation actually
  // succeeds for every position (see generateCascadedBSCs below) — saving
  // the hierarchy tree is a necessary first step, not completion itself.

  await writeAuditLog(supabase, {
    tenant_id: tenantId,
    user_id: user.id,
    action: "save_org_hierarchy",
    resource_type: "tenant",
    resource_id: tenantId,
    old_value: null,
    // The tree itself isn't logged (would be a large, mostly-noise blob on
    // every re-save) — position count is enough to spot an unexpected wipe.
    new_value: { position_count: sortCounter },
  });

  revalidatePath("/dashboard/onboarding");
  revalidatePath("/dashboard");
}

// ─── Load Existing Hierarchy ─────────────────────────────────
// Reconstructs the tree shape OrgWizard expects from saved org_positions
// rows, so reopening the wizard (e.g. after a partially-failed generation)
// shows the real hierarchy instead of silently falling back to the tiny
// default template and overwriting it on the next save.

type LoadedPositionNode = {
  tempId: string;
  positionType: PositionType;
  officeDepartmentName: string;
  sectionName?: string;
  jobTitle: string;
  firstName: string;
  surname: string;
  customFields: CustomField[];
  children: LoadedPositionNode[];
};

export async function loadExistingHierarchy(): Promise<LoadedPositionNode | null> {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id) return null;

  const supabase = await createClient();
  const { data: positions } = await supabase
    .from("org_positions")
    .select(
      "id, position_type, office_department_name, section_name, job_title, first_name, surname, reports_to_id, custom_fields, sort_order",
    )
    .eq("tenant_id", user.tenant_id)
    .order("sort_order", { ascending: true });

  if (!positions || positions.length === 0) return null;

  const nodeById = new Map<string, LoadedPositionNode>();
  for (const p of positions) {
    const customFields: CustomField[] = Object.entries(
      (p.custom_fields as Record<string, string>) ?? {},
    ).map(([label, value]) => ({ label, value: String(value) }));

    nodeById.set(p.id, {
      tempId: p.id,
      positionType: p.position_type as PositionType,
      officeDepartmentName: p.office_department_name ?? "",
      sectionName: p.section_name ?? undefined,
      jobTitle: p.job_title ?? "",
      firstName: p.first_name ?? "",
      surname: p.surname ?? "",
      customFields,
      children: [],
    });
  }

  let root: LoadedPositionNode | null = null;
  for (const p of positions) {
    const node = nodeById.get(p.id)!;
    if (p.reports_to_id) {
      nodeById.get(p.reports_to_id)?.children.push(node);
    } else {
      root = node;
    }
  }

  return root;
}

// ─── AI BSC Generation ───────────────────────────────────────
// generateRows / rowsToInsert / the 14-column tool schema all live in
// @/lib/bsc-generation — the single source of truth (see that file's
// header comment for why this must never be duplicated again).

type OrgPositionRow = {
  id: string;
  position_type: string;
  office_department_name: string;
  section_name: string | null;
  job_title: string;
  first_name: string | null;
  surname: string | null;
  reports_to_id: string | null;
  bsc_level: string;
  sort_order: number;
  user_id: string | null;
};

export async function generateCascadedBSCs() {
  const user = await getCurrentUser();
  if (!user || user.role !== "company_admin" || !user.tenant_id)
    throw new Error("Not authorized");

  // This fans out to N AI calls internally (one or two per position) —
  // one rate-limit slot per invocation, not per internal call, same as
  // generatePlanSection5 in document-actions.ts.
  const rateLimit = await checkAiGenerationRateLimit(user.id);
  if (!rateLimit.allowed) throw new Error(rateLimit.reason);
  await recordAiGenerationAttempt(user.id);

  const supabase = await createClient();
  const tenantId = user.tenant_id;

  // Load the strategic plan + corporate BSC context
  const { data: plan } = await supabase
    .from("strategic_plans")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  if (!plan) throw new Error("You need an approved Strategic Plan before generating cascaded BSCs.");

  // Load existing corporate scorecard rows for context. Ordered + limited
  // (rather than .maybeSingle()) so this degrades gracefully instead of
  // throwing if a plan ever ends up with more than one corporate scorecard.
  const { data: corpScorecards } = await supabase
    .from("scorecards")
    .select("id")
    .eq("plan_id", plan.id)
    .eq("scorecard_type", "corporate")
    .order("created_at", { ascending: false })
    .limit(1);
  const corpScorecard = corpScorecards?.[0] ?? null;

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

  if (!corporateContext) {
    const { data: corporateObjectives } = await supabase
      .from("strategic_objectives")
      .select("perspective, objective_text")
      .eq("plan_id", plan.id);
    if (corporateObjectives && corporateObjectives.length > 0) {
      corporateContext = corporateObjectives
        .map((o) => `[${o.perspective}] ${o.objective_text}`)
        .join("\n");
    }
  }

  const { data: themesData } = await supabase
    .from("strategic_themes")
    .select("title, intended_result")
    .eq("plan_id", plan.id)
    .order("sort_order", { ascending: true });
  const themesContext =
    themesData && themesData.length > 0
      ? `Strategic themes: ${themesData.map((t) => t.title).join("; ")}`
      : "";

  // Load org positions
  const { data: positions } = await supabase
    .from("org_positions")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });

  if (!positions || positions.length === 0)
    throw new Error("No organisational hierarchy found. Complete the onboarding wizard first.");

  // Clear previously generated position scorecards
  await supabase.from("position_scorecards").delete().eq("tenant_id", tenantId);
  const { data: existingNonCorp } = await supabase
    .from("scorecards")
    .select("id")
    .eq("tenant_id", tenantId)
    .in("scorecard_type", ["executive", "departmental", "individual"]);
  if (existingNonCorp && existingNonCorp.length > 0) {
    const ids = existingNonCorp.map((s) => s.id);
    await supabase.from("scorecards").delete().in("id", ids);
  }

  // Find the board (root)
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
  // Track generated office/dept scorecard IDs per position
  const positionScorecardIds = new Map<string, string>();

  // Process positions top-down (BFS)
  const queue: OrgPositionRow[] = [...(childrenOf.get(board.id) ?? [])];

  const companyName = plan.company_name;

  // A single position's AI/DB failure no longer aborts the whole cascade —
  // every position gets a chance, and we report exactly which ones failed
  // (and why) instead of silently marking the run "complete" regardless.
  const failures: { positionName: string; error: string }[] = [];

  for (let qi = 0; qi < queue.length; qi++) {
    const pos = queue[qi];

    // Add children to queue
    const kids = childrenOf.get(pos.id) ?? [];
    queue.push(...kids);

    const posLabel = pos.section_name || pos.office_department_name || pos.job_title;

    try {
      await generateForPosition(pos);
    } catch (err) {
      failures.push({ positionName: posLabel, error: err instanceof Error ? err.message : String(err) });
    }
  }

  async function generateForPosition(pos: OrgPositionRow) {
    const fullName = [pos.first_name, pos.surname].filter(Boolean).join(" ") || pos.job_title;
    const parentContext = pos.reports_to_id
      ? positionScorecardContext.get(pos.reports_to_id) ?? corporateContext
      : corporateContext;
    const parentScorecardId = pos.reports_to_id
      ? positionScorecardIds.get(pos.reports_to_id) ?? corpScorecard?.id ?? null
      : corpScorecard?.id ?? null;

    const posName = pos.section_name || pos.office_department_name;

    // ─── Determine level-specific prompts ─────────────────

    const isExecutive = pos.position_type === "executive";
    const isDepartment = pos.position_type === "non_executive";
    const isSection = pos.position_type === "section_supervisor";
    const isStaff = pos.position_type === "individual_staff";

    // Individual staff get only one BSC (no office/dept BSC)
    if (isStaff) {
      const staffPrompt = `You are an expert corporate strategist and Balanced Scorecard architect.
You are generating an Individual Staff Balanced Scorecard for ${fullName}, ${pos.job_title} at ${companyName}.

This is the most granular, task-specific BSC in the cascade.
It must focus on daily/weekly/monthly deliverables, accuracy, productivity, and personal development.
Derive all objectives directly from the Section BSC above.
Include only KPIs measurable at the individual level.
Avoid strategic or organisational-level language entirely.
Emphasise Internal Processes and Organisational Capacity BSC perspectives.

Parent Section BSC:
${parentContext}

Produce 3-5 scorecard rows representing this individual staff member's personal deliverables and KPIs.
Use the platform-standard 14-column template. Call submit_scorecard.`;

      const staffRows = await generateRows(staffPrompt);

      const { data: staffScorecard, error: staffErr } = await supabase
        .from("scorecards")
        .insert({
          tenant_id: tenantId,
          plan_id: plan.id,
          scorecard_type: "individual",
          name: `${fullName} — Individual Staff BSC`,
          department_name: posName,
          parent_scorecard_id: parentScorecardId,
          owner_user_id: pos.user_id,
          status: "active",
        })
        .select()
        .single();
      if (staffErr) throw staffErr;

      const { error: staffRowsErr } = await supabase
        .from("scorecard_rows")
        .insert(rowsToInsert(staffRows, staffScorecard.id, tenantId));
      if (staffRowsErr) throw staffRowsErr;

      const { error: staffLinkErr } = await supabase.from("position_scorecards").insert({
        tenant_id: tenantId,
        position_id: pos.id,
        scorecard_id: staffScorecard.id,
        scorecard_scope: "individual",
      });
      if (staffLinkErr) throw staffLinkErr;

      return; // Staff only get one BSC, no office/dept BSC
    }

    // ─── 1. Office / Department / Section BSC ─────────────

    let levelLabel: string;
    let bscFocus: string;
    let rowCountHint: string;
    let scorecardType: string;
    let bscSuffix: string;

    if (isExecutive) {
      levelLabel = "Strategic / Executive";
      bscFocus = "This BSC must be strategic, high-level, covering the full mandate of this executive office including all subordinate departments.";
      rowCountHint = "8-12";
      scorecardType = "executive";
      bscSuffix = "Executive Office BSC";
    } else if (isDepartment) {
      levelLabel = "Operational / Departmental";
      bscFocus = "This BSC must be operational and delivery-focused, covering day-to-day KPIs, team output, and process efficiency.";
      rowCountHint = "5-8";
      scorecardType = "departmental";
      bscSuffix = "Department BSC";
    } else if (isSection) {
      levelLabel = "Process / Supervisory";
      bscFocus = `This is a Section BSC. Focus on the operational processes and outputs managed within this specific section.
Emphasise Internal Processes and Organisational Capacity BSC perspectives.
Include KPIs that are measurable at the section/unit level (e.g., turnaround time, accuracy rate, volume processed).
Derive all objectives directly from the parent Department BSC above.`;
      rowCountHint = "4-6";
      scorecardType = "departmental";
      bscSuffix = "Section BSC";
    } else {
      levelLabel = "Operational";
      bscFocus = "This BSC must be operational.";
      rowCountHint = "5-8";
      scorecardType = "departmental";
      bscSuffix = "BSC";
    }

    const officeBscPrompt = `You are an expert corporate strategist and Balanced Scorecard architect.
You are generating a ${bscSuffix} for the "${posName}" at ${companyName}.

This position is held by: ${fullName} (${pos.job_title})
Level: ${levelLabel}
${bscFocus}

The Corporate Strategic Plan and parent BSC context:
${themesContext}
Parent BSC rows:
${parentContext}

Produce ${rowCountHint} scorecard rows covering all four BSC perspectives (Financial, Customer & Stakeholder, Internal Processes, Organisational Capacity), each cascaded from and aligned with the parent BSC above.
Use the platform-standard 14-column template. Call submit_scorecard.`;

    const officeRows = await generateRows(officeBscPrompt);

    const { data: officeScorecard, error: offErr } = await supabase
      .from("scorecards")
      .insert({
        tenant_id: tenantId,
        plan_id: plan.id,
        scorecard_type: scorecardType,
        name: `${posName} — ${bscSuffix}`,
        department_name: posName,
        parent_scorecard_id: parentScorecardId,
        owner_user_id: pos.user_id,
        status: "active",
      })
      .select()
      .single();
    if (offErr) throw offErr;

    const { error: officeRowsErr } = await supabase
      .from("scorecard_rows")
      .insert(rowsToInsert(officeRows, officeScorecard.id, tenantId));
    if (officeRowsErr) throw officeRowsErr;

    const { error: officeLinkErr } = await supabase.from("position_scorecards").insert({
      tenant_id: tenantId,
      position_id: pos.id,
      scorecard_id: officeScorecard.id,
      scorecard_scope: "office_department",
    });
    if (officeLinkErr) throw officeLinkErr;

    // Store context for children cascade
    const officeContext = officeRows
      .map((r) => `[${r.perspective}] ${r.strategic_objective} — KPI: ${r.kpi} (target: ${r.target})`)
      .join("\n");
    positionScorecardContext.set(pos.id, officeContext);
    positionScorecardIds.set(pos.id, officeScorecard.id);

    // ─── 2. Individual BSC for this person ────────────────

    let individualFocus: string;
    if (isSection) {
      individualFocus = `This is a Section Supervisor Individual BSC.
Focus on the supervisor's personal responsibility for section performance and team management.
Be narrower in scope than the Section BSC.
Include personal KPIs related to reporting, team coaching, and process compliance.
Emphasise Internal Processes and Customer & Stakeholder perspectives.`;
    } else if (isDepartment) {
      individualFocus = `This is a Department Manager Individual BSC.
Focus on the manager's personal operational contributions, team leadership, and delivery accountability.`;
    } else {
      individualFocus = `This is an Executive Individual BSC.
Focus on the executive's personal strategic contributions, leadership, and cross-functional accountability.`;
    }

    const individualPrompt = `You are an expert corporate strategist and Balanced Scorecard architect.
You are generating an Individual Balanced Scorecard for ${fullName}, ${pos.job_title} at ${companyName}.

This is a PERSONAL BSC showing what this individual must specifically deliver in their role.
${individualFocus}

${posName} BSC (the parent):
${officeContext}

Produce 4-6 scorecard rows representing this individual's personal KPIs and contribution, cascaded from and aligned with the ${posName} BSC above.
Use the platform-standard 14-column template. Call submit_scorecard.`;

    const individualRows = await generateRows(individualPrompt);

    const { data: indivScorecard, error: indErr } = await supabase
      .from("scorecards")
      .insert({
        tenant_id: tenantId,
        plan_id: plan.id,
        scorecard_type: "individual",
        name: `${fullName} — Individual BSC`,
        department_name: posName,
        parent_scorecard_id: officeScorecard.id,
        owner_user_id: pos.user_id,
        status: "active",
      })
      .select()
      .single();
    if (indErr) throw indErr;

    const { error: indivRowsErr } = await supabase
      .from("scorecard_rows")
      .insert(rowsToInsert(individualRows, indivScorecard.id, tenantId));
    if (indivRowsErr) throw indivRowsErr;

    const { error: indivLinkErr } = await supabase.from("position_scorecards").insert({
      tenant_id: tenantId,
      position_id: pos.id,
      scorecard_id: indivScorecard.id,
      scorecard_scope: "individual",
    });
    if (indivLinkErr) throw indivLinkErr;
  }

  // Log AI session
  const posCount = positions.filter((p) => p.position_type !== "board").length;
  const staffCount = positions.filter((p) => p.position_type === "individual_staff").length;
  const nonStaffCount = posCount - staffCount;
  const totalBSCs = nonStaffCount * 2 + staffCount; // 2 BSCs per non-staff, 1 per staff
  await supabase.from("ai_sessions").insert({
    tenant_id: tenantId,
    user_id: user.id,
    session_type: "bsc_generation",
    prompt_summary: `Generate cascaded BSCs from org hierarchy for ${companyName}`,
    response_summary:
      failures.length === 0
        ? `${posCount} positions → ${totalBSCs} scorecards (${nonStaffCount} × 2 office+individual + ${staffCount} × 1 staff)`
        : `${posCount - failures.length} of ${posCount} positions succeeded; ${failures.length} failed`,
  });

  // onboarding_completed only ever means "the last cascade run fully
  // succeeded" — the background jobs (cron) rely on this flag being
  // trustworthy, not just "some scorecard exists somewhere."
  await supabase
    .from("tenants")
    .update({ onboarding_completed: failures.length === 0 })
    .eq("id", tenantId);

  revalidatePath("/dashboard");
  revalidatePath("/dashboard/scorecards");
  revalidatePath("/dashboard/onboarding");

  if (failures.length > 0) {
    const summary = failures.map((f) => `"${f.positionName}" (${f.error})`).join("; ");
    throw new Error(
      `Scorecards were generated for ${posCount - failures.length} of ${posCount} positions. Failed: ${summary}. You can try again — this will regenerate everything from scratch.`,
    );
  }
}

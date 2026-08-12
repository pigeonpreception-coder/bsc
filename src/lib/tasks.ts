import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";
import { createAnthropicClient, CLAUDE_MODEL } from "./anthropic";
import { createNotification } from "./notifications";

// ─── Types ───────────────────────────────────────────────────

type TaskInput = {
  task_title: string;
  task_description: string;
  task_priority: "high" | "medium" | "low";
  linked_objective: string;
  linked_kpi: string;
};

const TASK_TOOL = {
  name: "submit_tasks",
  description: "Submit the daily task list.",
  input_schema: {
    type: "object" as const,
    properties: {
      tasks: {
        type: "array",
        items: {
          type: "object",
          properties: {
            task_title: { type: "string" },
            task_description: { type: "string" },
            task_priority: { type: "string", enum: ["high", "medium", "low"] },
            linked_objective: { type: "string" },
            linked_kpi: { type: "string" },
          },
          required: ["task_title", "task_description", "task_priority", "linked_objective", "linked_kpi"],
        },
      },
    },
    required: ["tasks"],
  },
};

// ─── Rollover Unfinished Tasks ───────────────────────────────

export async function rolloverUnfinishedTasks(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<number> {
  const today = new Date().toISOString().split("T")[0];

  // Find all unfinished tasks from yesterday or earlier
  const { data: unfinished } = await supabase
    .from("daily_tasks")
    .select("*")
    .eq("user_id", userId)
    .eq("tenant_id", tenantId)
    .lt("task_date", today)
    .neq("status", "completed");

  if (!unfinished || unfinished.length === 0) return 0;

  for (const task of unfinished) {
    const newRollover = (task.rollover_count ?? 0) + 1;
    await supabase
      .from("daily_tasks")
      .update({
        task_date: today,
        rollover_count: newRollover,
        status: "untouched",
      })
      .eq("id", task.id);

    // Alert if rolled over >= 3 times
    if (newRollover >= 3) {
      const { count } = await supabase
        .from("performance_alerts")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId)
        .eq("alert_type", "rollover_exceeded")
        .eq("alert_message", `Task "${task.task_title}" has been incomplete for ${newRollover} days`)
        .eq("is_read", false);

      if (!count || count === 0) {
        await supabase.from("performance_alerts").insert({
          tenant_id: tenantId,
          position_id: task.position_id,
          alert_type: "rollover_exceeded",
          alert_message: `Task "${task.task_title}" has been incomplete for ${newRollover} days`,
        });
      }
    }
  }

  return unfinished.length;
}

// ─── Generate Daily Tasks ────────────────────────────────────

export async function generateDailyTasks(
  supabase: SupabaseClient,
  userId: string,
  tenantId: string,
  positionId: string
): Promise<number> {
  const today = new Date().toISOString().split("T")[0];

  // Check if already generated today
  const { count: existingCount } = await supabase
    .from("task_generation_log")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("generation_date", today);

  if (existingCount && existingCount > 0) return 0;

  // Rollover first
  const rolledOver = await rolloverUnfinishedTasks(supabase, userId, tenantId);

  // Load position info
  const { data: position } = await supabase
    .from("org_positions")
    .select("*")
    .eq("id", positionId)
    .single();

  if (!position) return 0;

  // Load individual scorecard
  const { data: posScorecard } = await supabase
    .from("position_scorecards")
    .select("scorecard_id")
    .eq("position_id", positionId)
    .eq("scorecard_scope", "individual")
    .maybeSingle();

  // If no individual, try office/dept
  const scorecardId = posScorecard?.scorecard_id;
  if (!scorecardId) {
    const { data: officeScorecard } = await supabase
      .from("position_scorecards")
      .select("scorecard_id")
      .eq("position_id", positionId)
      .eq("scorecard_scope", "office_department")
      .maybeSingle();
    if (!officeScorecard?.scorecard_id) return 0;
  }

  const scId = scorecardId ?? (await supabase
    .from("position_scorecards")
    .select("scorecard_id")
    .eq("position_id", positionId)
    .limit(1)
    .single()).data?.scorecard_id;

  if (!scId) return 0;

  // Load BSC rows
  const { data: bscRows } = await supabase
    .from("scorecard_rows")
    .select("perspective, strategic_objective, kpi, actual, target, status, initiative, timeline")
    .eq("scorecard_id", scId);

  // Load performance score
  const { data: perfScore } = await supabase
    .from("performance_scores")
    .select("own_performance_score, composite_performance_score")
    .eq("position_id", positionId)
    .maybeSingle();

  // Load rolled-over tasks
  const { data: rolledOverTasks } = await supabase
    .from("daily_tasks")
    .select("task_title, task_description, rollover_count")
    .eq("user_id", userId)
    .eq("task_date", today)
    .gt("rollover_count", 0);

  // Load plan info
  const { data: plan } = await supabase
    .from("strategic_plans")
    .select("period_start, period_end")
    .eq("tenant_id", tenantId)
    .eq("status", "active")
    .maybeSingle();

  const offTrack = (bscRows ?? []).filter((r) => r.status === "off_track");
  const atRisk = (bscRows ?? []).filter((r) => r.status === "at_risk");

  const fullName = [position.first_name, position.surname].filter(Boolean).join(" ") || position.job_title;

  const systemPrompt = `You are an AI performance coach embedded in a corporate Balanced Scorecard platform.
Generate a specific, actionable daily task list for a corporate employee based on their BSC and current performance.

RULES:
- Generate between 5 and 10 tasks for today
- Tasks must be specific and actionable — not vague
- Tasks must directly link to the user's BSC objectives and KPIs
- Off Track KPIs get HIGH priority tasks, At Risk get MEDIUM, On Track get LOW
- Tasks must match the user's authority level:
  * Executive: strategic reviews, stakeholder engagement, decision-making
  * Department Manager: team oversight, operational reviews, reporting
  * Section Supervisor: team coordination, process execution, quality checks
  * Individual Staff: specific daily deliverables, data entry, reports
- Do NOT generate vague tasks. Be specific like "Review Q3 sales pipeline and update CRM with 5 new prospects"
- Call submit_tasks with the result.`;

  const userPrompt = `User: ${fullName}
Job Title: ${position.job_title}
Role Level: ${position.position_type}
Department: ${position.office_department_name}
Today's Date: ${today}
${plan ? `Strategic Plan Period: ${plan.period_start} to ${plan.period_end}` : ""}

THEIR BALANCED SCORECARD:
${JSON.stringify(bscRows ?? [], null, 2)}

CURRENT PERFORMANCE SCORES:
- Own BSC Score: ${perfScore?.own_performance_score ?? 0}%
- Composite Score: ${perfScore?.composite_performance_score ?? 0}%
- Off Track KPIs: ${JSON.stringify(offTrack.map((r) => ({ kpi: r.kpi, actual: r.actual, target: r.target })))}
- At Risk KPIs: ${JSON.stringify(atRisk.map((r) => ({ kpi: r.kpi, actual: r.actual, target: r.target })))}

ROLLED-OVER TASKS FROM PREVIOUS DAYS:
${JSON.stringify(rolledOverTasks ?? [])}

Generate today's task list now. Call submit_tasks.`;

  const anthropic = createAnthropicClient();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 4096,
    tools: [TASK_TOOL],
    tool_choice: { type: "tool", name: "submit_tasks" },
    messages: [{ role: "user", content: `${systemPrompt}\n\n${userPrompt}` }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") return 0;

  const tasks = (toolUse.input as { tasks: TaskInput[] }).tasks;

  // Insert tasks
  const taskInserts = tasks.map((t) => ({
    tenant_id: tenantId,
    user_id: userId,
    position_id: positionId,
    linked_objective: t.linked_objective,
    linked_kpi: t.linked_kpi,
    task_title: t.task_title,
    task_description: t.task_description,
    task_priority: t.task_priority,
    status: "untouched" as const,
    task_date: today,
    original_date: today,
    rollover_count: 0,
  }));

  if (taskInserts.length > 0) {
    await supabase.from("daily_tasks").insert(taskInserts);
  }

  // Log generation
  await supabase.from("task_generation_log").insert({
    tenant_id: tenantId,
    user_id: userId,
    generation_date: today,
    tasks_generated: tasks.length,
    tasks_rolled_over: rolledOver,
    ai_prompt_summary: `Generated ${tasks.length} tasks for ${fullName} (${position.position_type})`,
  });

  return tasks.length;
}

// ─── Weekly Advisory ─────────────────────────────────────────

export async function generateWeeklyAdvisory(
  supabase: SupabaseClient,
  tenantId: string,
  positionId: string,
  companyName: string
): Promise<string> {
  const { data: position } = await supabase
    .from("org_positions")
    .select("*")
    .eq("id", positionId)
    .single();

  if (!position) return "";

  const fullName = [position.first_name, position.surname].filter(Boolean).join(" ") || position.job_title;

  // Get current and last week scores
  const { data: currentScore } = await supabase
    .from("performance_scores")
    .select("own_performance_score, composite_performance_score")
    .eq("position_id", positionId)
    .maybeSingle();

  const lastWeek = new Date();
  lastWeek.setDate(lastWeek.getDate() - 7);
  const { data: lastWeekHistory } = await supabase
    .from("performance_history")
    .select("composite_performance_score")
    .eq("position_id", positionId)
    .lte("snapshot_date", lastWeek.toISOString().split("T")[0])
    .order("snapshot_date", { ascending: false })
    .limit(1)
    .maybeSingle();

  const thisWeekScore = currentScore?.composite_performance_score ?? 0;
  const lastWeekScore = lastWeekHistory?.composite_performance_score ?? thisWeekScore;
  const trend = thisWeekScore > lastWeekScore ? "improving" : thisWeekScore < lastWeekScore ? "declining" : "stable";

  // Load BSC for top/at-risk KPIs
  const { data: posScorecard } = await supabase
    .from("position_scorecards")
    .select("scorecard_id")
    .eq("position_id", positionId)
    .limit(1)
    .maybeSingle();

  let topKpi = "N/A", atRiskKpi = "N/A";
  if (posScorecard) {
    const { data: rows } = await supabase
      .from("scorecard_rows")
      .select("kpi, actual, target, status")
      .eq("scorecard_id", posScorecard.scorecard_id)
      .order("status", { ascending: true });

    if (rows && rows.length > 0) {
      const onTrack = rows.find((r) => r.status === "on_track");
      const atRisk = rows.find((r) => r.status === "at_risk" || r.status === "off_track");
      topKpi = onTrack?.kpi ?? "N/A";
      atRiskKpi = atRisk?.kpi ?? "N/A";
    }
  }

  const prompt = `You are a senior business performance advisor.
Write a brief (4–6 sentences) personalised weekly advisory note for ${fullName}, 
${position.job_title} at ${companyName}.

Last week's performance score: ${lastWeekScore}%
This week's score: ${thisWeekScore}%
Trend: ${trend}
Top performing KPI: ${topKpi}
Most at-risk KPI: ${atRiskKpi}

Write in a professional but direct tone.
Acknowledge what's going well, flag the most urgent performance risk, 
and give one specific strategic action they should prioritise this week.
Do not use bullet points. Write in paragraph form.`;

  const anthropic = createAnthropicClient();
  const response = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 500,
    messages: [{ role: "user", content: prompt }],
  });

  const text = response.content
    .filter((b) => b.type === "text")
    .map((b) => (b as { type: "text"; text: string }).text)
    .join("");

  // Save advisory
  const weekStart = new Date();
  weekStart.setDate(weekStart.getDate() - weekStart.getDay() + 1); // Monday
  await supabase.from("weekly_advisories").insert({
    tenant_id: tenantId,
    position_id: positionId,
    advisory_text: text,
    week_start: weekStart.toISOString().split("T")[0],
  });

  if (position.user_id) {
    const { data: positionUser } = await supabase.from("users").select("email").eq("id", position.user_id).maybeSingle();

    await createNotification(supabase, {
      tenantId,
      userId: position.user_id,
      type: "weekly_advisory_ready",
      message: "Your weekly performance advisory is ready.",
      link: "/dashboard",
      email: positionUser?.email ? { to: positionUser.email, subject: "Your weekly performance advisory is ready" } : null,
    });
  }

  return text;
}

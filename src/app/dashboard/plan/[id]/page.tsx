import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { approveStrategicPlan } from "./actions";
import { generatePlanDocumentIntro, generatePlanSection5, generatePlanDocumentClosing } from "./document-actions";
import { downloadStrategicPlan } from "./export-actions";
import { CANONICAL_PERSPECTIVES } from "@/lib/scorecard";
import { getCorporateBscView } from "@/lib/corporate-bsc-view";
import { getOrgStructureView, type OrgStructureNode } from "@/lib/org-structure-view";
import ActionButton from "@/components/ActionButton";
import DownloadPlanButton from "./DownloadPlanButton";

type PlanSectionRow = {
  id: string;
  section_number: string;
  section_title: string;
  depth: number;
  content: string | null;
  is_placeholder: boolean;
  is_dynamic: boolean;
};

type StrategicObjectiveRow = { id: string; objective_text: string; perspective: string };
type StrategicThemeRow = { id: string; theme_number: number; title: string; intended_result: string | null };

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: plan } = await supabase.from("strategic_plans").select("*").eq("id", id).single();
  if (!plan) notFound();

  const canManage = user.role === "company_admin" && user.tenant_id === plan.tenant_id;

  async function handleApprove() {
    "use server";
    await approveStrategicPlan(id);
  }
  async function handleGenerateDocumentIntro() {
    "use server";
    await generatePlanDocumentIntro(id);
  }
  async function handleGenerateSection5() {
    "use server";
    await generatePlanSection5(id);
  }
  async function handleGenerateDocumentClosing() {
    "use server";
    await generatePlanDocumentClosing(id);
  }
  async function handleDownloadPlan() {
    "use server";
    return await downloadStrategicPlan(id);
  }

  const { data: planSections } = await supabase
    .from("plan_sections")
    .select("id, section_number, section_title, depth, content, is_placeholder, is_dynamic")
    .eq("plan_id", id)
    .order("sort_order", { ascending: true });

  const { data: strategicThemes } = await supabase
    .from("strategic_themes")
    .select("id, theme_number, title, intended_result")
    .eq("plan_id", id)
    .order("sort_order", { ascending: true });

  const { data: corporateObjectives } = await supabase
    .from("strategic_objectives")
    .select("id, objective_text, perspective")
    .eq("plan_id", id);

  const { data: themeAlignments } = await supabase
    .from("strategic_objective_themes")
    .select("theme_id, objective_id")
    .eq("plan_id", id);

  const objectiveById = new Map((corporateObjectives ?? []).map((o) => [o.id, o as StrategicObjectiveRow]));
  const objectivesByTheme = new Map<string, StrategicObjectiveRow[]>();
  for (const link of themeAlignments ?? []) {
    const objective = objectiveById.get(link.objective_id);
    if (!objective) continue;
    const list = objectivesByTheme.get(link.theme_id) ?? [];
    list.push(objective);
    objectivesByTheme.set(link.theme_id, list);
  }

  const objectivesByPerspective = new Map<string, StrategicObjectiveRow[]>();
  for (const objective of (corporateObjectives ?? []) as StrategicObjectiveRow[]) {
    const list = objectivesByPerspective.get(objective.perspective) ?? [];
    list.push(objective);
    objectivesByPerspective.set(objective.perspective, list);
  }

  const { count: scorecardCount } = plan.status === "active"
    ? await supabase.from("scorecards").select("id", { count: "exact", head: true }).eq("plan_id", id)
    : { count: 0 };

  const corporateBsc = await getCorporateBscView(id, plan.tenant_id);
  const orgStructure = await getOrgStructureView(plan.tenant_id);
  const hasObjectives = (corporateObjectives?.length ?? 0) > 0;
  const hasIntro = planSections?.some((s) => s.section_number === "1") ?? false;
  const hasSection5 = (strategicThemes?.length ?? 0) > 0;
  const hasClosing = planSections?.some((s) => s.section_number === "6") ?? false;
  const documentComplete = hasIntro && hasSection5 && hasClosing;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-navy">{plan.company_name} — Strategic Plan</h1>
          <p className="mt-1 text-sm text-gray-500">
            {plan.strategic_period_years}-year plan &middot; {plan.period_start} to {plan.period_end}
          </p>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            plan.status === "active" ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-600"
          }`}
        >
          {plan.status === "active" ? "Approved" : "Draft"}
        </span>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div className="col-span-2">
            <dt className="font-medium text-gray-700">Vision</dt>
            <dd className="text-gray-500">{plan.vision || "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="font-medium text-gray-700">Mission</dt>
            <dd className="text-gray-500">{plan.mission || "—"}</dd>
          </div>
          <div className="col-span-2">
            <dt className="font-medium text-gray-700">Core values</dt>
            <dd className="text-gray-500">
              {((plan.values ?? []) as { name: string }[]).map((v) => v.name).join(", ") || "—"}
            </dd>
          </div>
        </dl>
      </div>

      <div className="rounded-lg border border-gray-200 bg-white p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-navy">Strategic Plan Document</h2>
            <p className="mt-1 text-xs text-gray-500">
              Board-level document generator — Sections 1–9, the live Balanced Scorecard (5.4), and export.
            </p>
          </div>
          {canManage && (
            <div className="flex flex-wrap gap-2">
              <ActionButton
                action={handleGenerateDocumentIntro}
                pendingLabel="Generating… this can take a minute or two"
                variant="secondary"
                confirmMessage={hasIntro ? "Regenerate Sections 1–4? This replaces their current content." : undefined}
              >
                {hasIntro ? "Regenerate Sections 1–4" : "Generate Sections 1–4"}
              </ActionButton>
              <ActionButton
                action={handleGenerateSection5}
                pendingLabel="Generating… this runs 4 AI steps and can take a few minutes"
                variant="secondary"
                confirmMessage={
                  hasSection5
                    ? scorecardCount
                      ? "Regenerate Section 5? This replaces the current Strategic Themes and Objectives — cascaded scorecards already generated from the old ones won't be updated to match."
                      : "Regenerate Section 5? This replaces the current Strategic Themes and Objectives."
                    : undefined
                }
              >
                {hasSection5 ? "Regenerate Section 5" : "Generate Section 5 (Strategic Themes)"}
              </ActionButton>
              <ActionButton
                action={handleGenerateDocumentClosing}
                pendingLabel="Generating… this can take a minute or two"
                variant="secondary"
                confirmMessage={hasClosing ? "Regenerate Sections 6–9? This replaces their current content." : undefined}
              >
                {hasClosing ? "Regenerate Sections 6–9" : "Generate Sections 6–9"}
              </ActionButton>
            </div>
          )}
        </div>

        {corporateObjectives && corporateObjectives.length > 0 && (
          <div className="mt-6 rounded-md border border-gray-200 bg-gray-50 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-navy">
              Corporate Strategic Objectives ({corporateObjectives.length})
            </h3>
            <div className="mt-3 space-y-3">
              {CANONICAL_PERSPECTIVES.map((perspective) => {
                const items = objectivesByPerspective.get(perspective) ?? [];
                if (items.length === 0) return null;
                return (
                  <div key={perspective}>
                    <h4 className="text-xs font-semibold uppercase tracking-wide text-gold-light bg-navy inline-block rounded px-2 py-0.5">
                      {perspective} ({items.length})
                    </h4>
                    <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-gray-700">
                      {items.map((objective) => (
                        <li key={objective.id}>{objective.objective_text}</li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {strategicThemes && strategicThemes.length > 0 && (
          <div className="mt-6 rounded-md border border-gold-light/60 bg-gold-light/10 p-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-navy">
              Strategic Themes ({strategicThemes.length})
            </h3>
            <div className="mt-3 space-y-4">
              {(strategicThemes as StrategicThemeRow[]).map((theme) => (
                <div key={theme.id}>
                  <p className="text-sm font-semibold text-gray-800">
                    Theme {theme.theme_number}: {theme.title}
                  </p>
                  {theme.intended_result && (
                    <p className="mt-0.5 text-xs text-gray-500">Intended Result: {theme.intended_result}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400">
                    {(objectivesByTheme.get(theme.id) ?? []).length} aligned objective(s):
                  </p>
                  <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm text-gray-700">
                    {(objectivesByTheme.get(theme.id) ?? []).map((objective) => (
                      <li key={objective.id}>
                        {objective.objective_text} <span className="text-gray-400">({objective.perspective})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>
        )}

        {planSections && planSections.length > 0 && (
          <div className="mt-6 space-y-5">
            {planSections.map((section: PlanSectionRow) => (
              <div key={section.id} style={{ marginLeft: `${(section.depth - 1) * 1.25}rem` }}>
                <h3 className={section.depth === 1 ? "text-sm font-bold text-navy" : "text-sm font-semibold text-gray-700"}>
                  {section.section_number}. {section.section_title}
                </h3>
                {section.is_placeholder && (
                  <p className="mt-1 text-xs italic text-amber-600">
                    Pending framework specification — awaiting content.
                  </p>
                )}
                {section.is_dynamic && section.section_number !== "5.4" && section.section_number !== "2.4.1" && (
                  <p className="mt-1 text-xs italic text-gray-400">
                    Rendered live from other data — not applicable to this preview.
                  </p>
                )}
                {section.content && <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">{section.content}</p>}
                {section.section_number === "2.4.1" && (
                  <div className="mt-2">
                    {!orgStructure ? (
                      <p className="text-xs italic text-gray-400">
                        No organisational hierarchy has been set up yet for this company — this section will render
                        it automatically once one exists.
                      </p>
                    ) : (
                      <OrgStructureList node={orgStructure} depth={0} />
                    )}
                  </div>
                )}
                {section.section_number === "5.4" && (
                  <div className="mt-2">
                    {!corporateBsc ? (
                      <p className="text-xs italic text-gray-400">
                        No Corporate Balanced Scorecard has been generated yet for this plan — this section will
                        render it automatically once one exists.
                      </p>
                    ) : (
                      <div className="space-y-4">
                        <p className="text-xs text-gray-500">Live from “{corporateBsc.scorecardName}”</p>
                        {corporateBsc.perspectiveGroups.map((group) => (
                          <div key={group.perspective} className="overflow-x-auto">
                            <h4 className="text-xs font-semibold uppercase tracking-wide text-gold-light bg-navy inline-block rounded px-2 py-0.5">
                              {group.perspective}
                            </h4>
                            <table className="mt-2 w-full min-w-[720px] text-xs">
                              <thead className="text-left uppercase text-gray-500">
                                <tr>
                                  <th className="py-1 pr-3">Strategic Objective</th>
                                  <th className="py-1 pr-3">Intended Result</th>
                                  <th className="py-1 pr-3">Key Initiatives</th>
                                  <th className="py-1 pr-3">KPI / Measure</th>
                                  <th className="py-1 pr-3">Baseline</th>
                                  <th className="py-1 pr-3">Target</th>
                                  <th className="py-1">Owner</th>
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-gray-100">
                                {group.rows.map((row) => (
                                  <tr key={row.id}>
                                    <td className="py-2 pr-3 text-gray-700">{row.strategicObjective}</td>
                                    <td className="py-2 pr-3 text-gray-500">{row.intendedResult ?? "—"}</td>
                                    <td className="py-2 pr-3 text-gray-500">{row.keyInitiatives ?? "—"}</td>
                                    <td className="py-2 pr-3 text-gray-700">
                                      {row.kpi}
                                      {row.unit ? ` (${row.unit})` : ""}
                                    </td>
                                    <td className="py-2 pr-3 text-gray-500">{row.baseline ?? "—"}</td>
                                    <td className="py-2 pr-3 text-gray-500">{row.target ?? "—"}</td>
                                    <td className="py-2 text-gray-500">{row.ownerName ?? "Unassigned"}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {!planSections?.length && !corporateObjectives?.length && (
          <p className="mt-6 text-sm text-gray-400">
            {canManage
              ? "Nothing generated yet — start with Sections 1–4 above."
              : "Waiting for the Company Admin to generate the strategic plan document."}
          </p>
        )}
      </div>

      {planSections && planSections.length > 0 && canManage && (
        <div className="rounded-lg border border-gray-200 bg-white p-6">
          <h2 className="text-sm font-semibold text-navy">Export</h2>
          <p className="mt-1 text-xs text-gray-500">
            Generates both a PDF and a Word (.docx) version of the document above, including a cover page, table of
            contents, and the live Balanced Scorecard table.
          </p>
          {documentComplete ? (
            <div className="mt-4">
              <DownloadPlanButton action={handleDownloadPlan} />
            </div>
          ) : (
            <p className="mt-3 text-xs text-amber-600">
              Sections 1–4, 5, and 6–9 all need to be generated first — the export would otherwise be missing
              whichever ones aren&apos;t done yet
              {!hasIntro && " (Sections 1–4)"}
              {!hasSection5 && " (Section 5)"}
              {!hasClosing && " (Sections 6–9)"}.
            </p>
          )}
        </div>
      )}

      {canManage && plan.status !== "active" && hasObjectives && (
        <div className="flex justify-end">
          <ActionButton action={handleApprove} pendingLabel="Approving…">
            Approve Strategic Plan
          </ActionButton>
        </div>
      )}

      {plan.status === "active" && !scorecardCount && canManage && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">
            Plan approved. Set up your organisational hierarchy to generate the cascading Corporate, Executive,
            Departmental, and Individual Balanced Scorecards.
          </p>
          <Link
            href="/dashboard/onboarding"
            className="mt-4 inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            Set Up Organisation
          </Link>
        </div>
      )}

      {plan.status === "active" && !!scorecardCount && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">{scorecardCount} scorecards generated.</p>
          <Link
            href="/dashboard/scorecards"
            className="mt-3 inline-block rounded-md bg-navy px-4 py-2 text-sm font-semibold text-white hover:bg-navy-light"
          >
            View Scorecards
          </Link>
        </div>
      )}
    </div>
  );
}

function OrgStructureList({ node, depth }: { node: OrgStructureNode; depth: number }) {
  const personLine = node.personName
    ? ` — ${node.personName}${node.jobTitle ? ` (${node.jobTitle})` : ""}`
    : node.jobTitle
      ? ` — ${node.jobTitle}`
      : "";

  return (
    <div style={{ marginLeft: depth * 20 }}>
      <p className="text-sm text-gray-700">
        <span className="font-semibold text-navy">{node.positionType}:</span> {node.label}
        <span className="text-gray-500">{personLine}</span>
      </p>
      {node.children.map((child) => (
        <OrgStructureList key={child.id} node={child} depth={depth + 1} />
      ))}
    </div>
  );
}

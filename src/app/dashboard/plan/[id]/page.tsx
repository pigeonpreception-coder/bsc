import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { generateStrategicPlan, approveStrategicPlan } from "./actions";
import { generateBalancedScorecards } from "./bsc-actions";
import ActionButton from "./ActionButton";

type GeneratedPlan = {
  executive_summary: string;
  swot: { strengths: string[]; weaknesses: string[]; opportunities: string[]; threats: string[] };
  strategic_pillars: string[];
  strategic_objectives: { perspective: string; objective: string; description?: string }[];
  kpis: { objective: string; kpi: string; target?: string }[];
  implementation_roadmap: { phase: string; timeframe: string; focus: string }[];
};

export default async function PlanPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: plan } = await supabase.from("strategic_plans").select("*").eq("id", id).single();
  if (!plan) notFound();

  const canManage = user.role === "company_admin" && user.tenant_id === plan.tenant_id;
  const generated = plan.ai_generated_content as GeneratedPlan | null;

  async function handleGenerate() {
    "use server";
    await generateStrategicPlan(id);
  }
  async function handleApprove() {
    "use server";
    await approveStrategicPlan(id);
  }
  async function handleGenerateScorecards() {
    "use server";
    await generateBalancedScorecards(id);
  }

  const { count: scorecardCount } = plan.status === "active"
    ? await supabase.from("scorecards").select("id", { count: "exact", head: true }).eq("plan_id", id)
    : { count: 0 };

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
            <dd className="text-gray-500">{(plan.values ?? []).join(", ") || "—"}</dd>
          </div>
        </dl>
      </div>

      {!generated && canManage && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
          <p className="text-sm text-gray-500">
            Ready to generate your AI-drafted Corporate Strategic Plan from the questionnaire answers.
          </p>
          <div className="mt-4">
            <ActionButton action={handleGenerate} pendingLabel="Generating… this can take up to a minute">
              Generate Strategic Plan
            </ActionButton>
          </div>
        </div>
      )}

      {!generated && !canManage && (
        <div className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-400">
          Waiting for the Company Admin to generate the strategic plan.
        </div>
      )}

      {generated && (
        <>
          <Section title="Executive Summary">
            <p className="text-sm text-gray-700">{generated.executive_summary}</p>
          </Section>

          <Section title="SWOT Analysis">
            <div className="grid grid-cols-2 gap-4">
              <SwotBox label="Strengths" items={generated.swot.strengths} color="bg-green-50 text-green-800" />
              <SwotBox label="Weaknesses" items={generated.swot.weaknesses} color="bg-red-50 text-red-800" />
              <SwotBox label="Opportunities" items={generated.swot.opportunities} color="bg-blue-50 text-blue-800" />
              <SwotBox label="Threats" items={generated.swot.threats} color="bg-amber-50 text-amber-800" />
            </div>
          </Section>

          <Section title="Strategic Pillars">
            <ul className="list-inside list-disc space-y-1 text-sm text-gray-700">
              {generated.strategic_pillars.map((pillar, i) => (
                <li key={i}>{pillar}</li>
              ))}
            </ul>
          </Section>

          <Section title="Strategic Objectives">
            <div className="space-y-4">
              {["Financial", "Customer", "Internal Process", "Learning & Growth"].map((perspective) => {
                const items = generated.strategic_objectives.filter((o) => o.perspective === perspective);
                if (items.length === 0) return null;
                return (
                  <div key={perspective}>
                    <h3 className="text-xs font-semibold uppercase tracking-wide text-gold-light bg-navy inline-block rounded px-2 py-0.5">
                      {perspective}
                    </h3>
                    <ul className="mt-2 list-inside list-disc space-y-1 text-sm text-gray-700">
                      {items.map((o, i) => (
                        <li key={i}>
                          {o.objective}
                          {o.description && <span className="text-gray-500"> — {o.description}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </Section>

          <Section title="Key Performance Indicators">
            <table className="w-full text-sm">
              <thead className="text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="py-1 pr-4">Objective</th>
                  <th className="py-1 pr-4">KPI</th>
                  <th className="py-1">Target</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {generated.kpis.map((kpi, i) => (
                  <tr key={i}>
                    <td className="py-2 pr-4 text-gray-700">{kpi.objective}</td>
                    <td className="py-2 pr-4 text-gray-700">{kpi.kpi}</td>
                    <td className="py-2 text-gray-500">{kpi.target ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Section>

          <Section title="Strategic Implementation Roadmap">
            <ul className="space-y-3">
              {generated.implementation_roadmap.map((phase, i) => (
                <li key={i} className="text-sm">
                  <span className="font-semibold text-navy">{phase.phase}</span>{" "}
                  <span className="text-gray-500">({phase.timeframe})</span>
                  <p className="text-gray-700">{phase.focus}</p>
                </li>
              ))}
            </ul>
          </Section>

          {canManage && plan.status !== "active" && (
            <div className="flex justify-end gap-3">
              <ActionButton action={handleGenerate} pendingLabel="Regenerating…" variant="secondary">
                Regenerate
              </ActionButton>
              <ActionButton action={handleApprove} pendingLabel="Approving…">
                Approve Strategic Plan
              </ActionButton>
            </div>
          )}

          {plan.status === "active" && !scorecardCount && canManage && (
            <div className="rounded-lg border border-gray-200 bg-white p-6 text-center">
              <p className="text-sm text-gray-500">
                Plan approved. Generate the cascading Corporate, Departmental, and Individual Balanced Scorecards.
              </p>
              <div className="mt-4">
                <ActionButton action={handleGenerateScorecards} pendingLabel="Generating scorecards… this can take a few minutes">
                  Generate Balanced Scorecards
                </ActionButton>
              </div>
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
              {canManage && (
                <div className="mt-3">
                  <ActionButton action={handleGenerateScorecards} pendingLabel="Regenerating…" variant="secondary">
                    Regenerate Scorecards
                  </ActionButton>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-6">
      <h2 className="mb-3 text-sm font-semibold text-navy">{title}</h2>
      {children}
    </div>
  );
}

function SwotBox({ label, items, color }: { label: string; items: string[]; color: string }) {
  return (
    <div className={`rounded-md p-3 ${color}`}>
      <h4 className="text-xs font-semibold uppercase">{label}</h4>
      <ul className="mt-1 list-inside list-disc space-y-0.5 text-sm">
        {items.map((item, i) => (
          <li key={i}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

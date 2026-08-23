import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { listPendingApprovalsForUser, type OrgPositionLite } from "@/lib/approval-hierarchy";
import ApprovalControls from "./ApprovalControls";

const PENDING_STATUSES = ["pending_manager_review", "pending_final_review"];

const SECTION_META = {
  first: { title: "Awaiting your first-level review", empty: "Nothing waiting on your first-level review." },
  final: { title: "Awaiting your final approval", empty: "Nothing waiting on your final approval." },
} as const;

export default async function ApprovalsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (!user.tenant_id) redirect("/dashboard");

  const supabase = await createClient();

  const [{ data: scorecards }, { data: positions }] = await Promise.all([
    supabase
      .from("scorecards")
      .select("id, name, scorecard_type, department_name, owner_user_id, workflow_status")
      .eq("tenant_id", user.tenant_id)
      .in("workflow_status", PENDING_STATUSES)
      .order("id", { ascending: true }),
    supabase.from("org_positions").select("id, user_id, reports_to_id, position_type").eq("tenant_id", user.tenant_id),
  ]);

  const allScorecards = scorecards ?? [];
  // Approval authority is entirely position-based (see
  // src/lib/approval-hierarchy.ts) — this page shows only the BSCs the API
  // would actually accept from this specific user, not a role-gated view.
  const entries = listPendingApprovalsForUser(
    (positions ?? []) as OrgPositionLite[],
    allScorecards.map((s) => ({ id: s.id, ownerId: s.owner_user_id, workflowStatus: s.workflow_status })),
    user.id,
  );
  const scorecardById = new Map(allScorecards.map((s) => [s.id, s]));

  const ownerIds = [...new Set(allScorecards.map((s) => s.owner_user_id).filter((id): id is string => Boolean(id)))];
  const { data: owners } = ownerIds.length
    ? await supabase.from("users").select("id, full_name, email").in("id", ownerIds)
    : { data: [] as { id: string; full_name: string | null; email: string }[] };
  const ownerNameById = new Map((owners ?? []).map((o) => [o.id, o.full_name || o.email]));

  const byLevel = { first: entries.filter((e) => e.level === "first"), final: entries.filter((e) => e.level === "final") };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-navy">BSC Approvals</h1>
        <p className="mt-1 text-sm text-gray-500">
          Approval follows your organization&apos;s reporting hierarchy — you&apos;ll only see BSCs you&apos;re authorized to act on.
        </p>
      </div>

      {(["first", "final"] as const).map((level) => {
        const meta = SECTION_META[level];
        const items = byLevel[level];
        return (
          <div key={level} className="rounded-lg border border-gray-200 bg-white">
            <h2 className="border-b border-gray-100 px-4 py-3 text-sm font-semibold text-navy">{meta.title}</h2>
            {items.length === 0 ? (
              <p className="p-6 text-sm text-gray-400">{meta.empty}</p>
            ) : (
              <ul className="divide-y divide-gray-100">
                {items.map(({ itemId }) => {
                  const scorecard = scorecardById.get(itemId);
                  if (!scorecard) return null;
                  return (
                    <li key={itemId} className="flex flex-wrap items-center justify-between gap-3 p-4">
                      <div>
                        <Link href={`/dashboard/scorecards/${scorecard.id}`} className="text-sm font-medium text-navy hover:underline">
                          {scorecard.name}
                        </Link>
                        <p className="mt-0.5 text-xs text-gray-500">
                          {scorecard.department_name ? `${scorecard.department_name} · ` : ""}
                          owner: {scorecard.owner_user_id ? ownerNameById.get(scorecard.owner_user_id) ?? "Unknown" : "—"}
                        </p>
                      </div>
                      <ApprovalControls scorecardId={scorecard.id} level={level} />
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveApprovalChainFromPositions, type OrgPositionLite } from "@/lib/approval-hierarchy";
import ScorecardTable from "./ScorecardTable";
import WorkflowPanel from "./WorkflowPanel";

export default async function ScorecardDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: scorecard } = await supabase.from("scorecards").select("*").eq("id", id).single();
  if (!scorecard) notFound();

  const [{ data: rows }, { data: teamMembers }, { data: customColumns }, { data: cellValues }, { data: positions }] =
    await Promise.all([
      supabase
        .from("scorecard_rows")
        .select("*")
        .eq("scorecard_id", id)
        .order("sort_order", { ascending: true }),
      supabase
        .from("users")
        .select("id, full_name, email")
        .eq("tenant_id", scorecard.tenant_id)
        .in("role", ["manager", "staff"]),
      supabase
        .from("scorecard_columns")
        .select("*")
        .eq("scorecard_id", id)
        .eq("is_visible", true)
        .order("column_order", { ascending: true }),
      supabase.from("scorecard_cell_values").select("*").eq("scorecard_id", id),
      supabase
        .from("org_positions")
        .select("id, user_id, reports_to_id, position_type")
        .eq("tenant_id", scorecard.tenant_id),
    ]);

  const teamOptions = (teamMembers ?? []).map((m) => ({ value: m.id, label: m.full_name || m.email }));
  const canEditAll = user.role === "company_admin";

  // The whole BSC shares one owner (scorecards.owner_user_id) and moves
  // through the review/approval workflow as a unit — the hierarchy chain is
  // resolved once here, not per row (see src/lib/approval-hierarchy.ts).
  const chain = scorecard.owner_user_id
    ? resolveApprovalChainFromPositions((positions ?? []) as OrgPositionLite[], scorecard.owner_user_id)
    : null;
  const isOwner = scorecard.owner_user_id === user.id;
  const isFirstApprover = !!chain && !chain.blockedReason && chain.firstApproverId === user.id;
  const isFinalApprover = !!chain && !chain.blockedReason && chain.finalApproverId === user.id;

  const canEditActual = (() => {
    if (scorecard.workflow_status === "locked") return false;
    if (scorecard.workflow_status === "owner_editing") return scorecard.owner_user_id ? isOwner : canEditAll;
    if (scorecard.workflow_status === "pending_manager_review") return isFirstApprover;
    return false; // pending_final_review — division head reviews, doesn't edit
  })();

  // Build cell values lookup: { rowId: { columnId: value } }
  const cellValuesMap: Record<string, Record<string, string>> = {};
  for (const cv of cellValues ?? []) {
    if (!cellValuesMap[cv.row_id]) cellValuesMap[cv.row_id] = {};
    cellValuesMap[cv.row_id][cv.column_id] = cv.value ?? "";
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-navy">{scorecard.name}</h1>
        <p className="text-sm capitalize text-gray-500">{scorecard.scorecard_type} scorecard</p>
      </div>

      <WorkflowPanel
        scorecardId={id}
        workflowStatus={scorecard.workflow_status}
        version={`${scorecard.version_major}.${scorecard.version_minor}`}
        isOwner={isOwner}
        isFirstApprover={isFirstApprover}
        isFinalApprover={isFinalApprover}
        isCompanyAdmin={user.role === "company_admin"}
        rejection={scorecard.rejected_level ? { level: scorecard.rejected_level, reason: scorecard.rejection_reason ?? "" } : null}
      />

      <ScorecardTable
        scorecardId={id}
        tenantId={scorecard.tenant_id}
        rows={(rows ?? []).map((r) => ({ ...r, canEditActual }))}
        canEditAll={canEditAll}
        teamOptions={teamOptions}
        customColumns={(customColumns ?? []).map((c) => ({
          id: c.id,
          column_key: c.column_key,
          column_label: c.column_label,
          column_order: c.column_order,
        }))}
        cellValues={cellValuesMap}
      />
    </div>
  );
}

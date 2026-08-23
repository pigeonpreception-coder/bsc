import { notFound, redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { resolveApprovalChainFromPositions, type OrgPositionLite } from "@/lib/approval-hierarchy";
import ScorecardTable from "./ScorecardTable";

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

  // Score-editing authority follows the org hierarchy, not the role or the
  // company_admin flag — resolved once per row against the tenant's org
  // chart (see src/lib/approval-hierarchy.ts). An unowned row (no
  // responsible_person) has no hierarchy to derive authority from, so it
  // stays company_admin-editable until someone assigns an owner.
  const canEditActualForRow = (row: { responsible_person: string | null }): boolean => {
    if (row.responsible_person === user.id) return true;
    if (!row.responsible_person) return canEditAll;
    const chain = resolveApprovalChainFromPositions((positions ?? []) as OrgPositionLite[], row.responsible_person);
    return chain.firstApproverId === user.id;
  };

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

      <ScorecardTable
        scorecardId={id}
        rows={(rows ?? []).map((r) => ({ ...r, canEditActual: canEditActualForRow(r) }))}
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

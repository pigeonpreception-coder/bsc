import "server-only";
import { SupabaseClient } from "@supabase/supabase-js";

// The exact wording the spec requires when the org chart can't resolve an
// approver -- shown to the submitter/editor, and used as the message to
// company_admins who alone can fix the org structure.
export const HIERARCHY_NOT_CONFIGURED_MESSAGE =
  "Approval cannot proceed because the required departmental manager or division head has not been configured. Please contact an authorized administrator.";

export type OrgPositionLite = {
  id: string;
  user_id: string | null;
  reports_to_id: string | null;
  position_type: string;
};

export type ApprovalChain = {
  ownerPositionId: string | null;
  firstApproverId: string | null;
  firstApproverPositionId: string | null;
  finalApproverId: string | null;
  finalApproverPositionId: string | null;
  /** True when the first- and final-level positions resolved to the same
   * person -- a shallow org chart with no separate executive layer above the
   * immediate manager. Spec §12 allows this as a recorded exception rather
   * than blocking the chain outright; callers must audit-log it. */
  sameApprover: boolean;
  blockedReason: string | null;
};

const MAX_HOPS = 20; // cycle guard, mirrors computePositionDepth()'s visited-set approach

function blocked(ownerPositionId: string | null = null): ApprovalChain {
  return {
    ownerPositionId,
    firstApproverId: null,
    firstApproverPositionId: null,
    finalApproverId: null,
    finalApproverPositionId: null,
    sameApprover: false,
    blockedReason: HIERARCHY_NOT_CONFIGURED_MESSAGE,
  };
}

// This schema has no distinct "division" concept (confirmed by a full-repo
// grep before writing this) -- office_department_name/section_name are the
// only groupings that exist. The nearest existing analog to "Head of
// Division" is the 'executive' position layer departments already report
// up through (e.g. "Office of the COO"), so the final approver is resolved
// as the nearest ancestor position of that type rather than inventing new
// schema for a literal division concept.
function isDivisionLevel(positionType: string): boolean {
  return positionType === "executive";
}

/**
 * Pure resolver: given every org_positions row for a tenant and the id of
 * the employee who owns a scorecard, determines the two-level approval
 * chain -- first approval from the immediate position above the owner,
 * final approval from the nearest executive-level ancestor above that.
 * Deliberately takes a flat position list (not a Supabase client) so this
 * can be unit-tested without mocking any I/O.
 */
export function resolveApprovalChainFromPositions(positions: OrgPositionLite[], ownerId: string): ApprovalChain {
  const byId = new Map(positions.map((p) => [p.id, p]));
  const ownerPosition = positions.find((p) => p.user_id === ownerId);
  if (!ownerPosition) return blocked();

  const firstApproverPosition = ownerPosition.reports_to_id ? byId.get(ownerPosition.reports_to_id) : undefined;
  if (!firstApproverPosition || !firstApproverPosition.user_id) return blocked(ownerPosition.id);

  let cursor: OrgPositionLite = firstApproverPosition;
  let finalApproverPosition: OrgPositionLite | null = isDivisionLevel(cursor.position_type) ? cursor : null;
  const visited = new Set([cursor.id]);
  let hops = 0;
  while (!finalApproverPosition && cursor.reports_to_id && hops < MAX_HOPS) {
    hops++;
    const next = byId.get(cursor.reports_to_id);
    if (!next || visited.has(next.id)) break;
    visited.add(next.id);
    cursor = next;
    if (isDivisionLevel(cursor.position_type)) finalApproverPosition = cursor;
  }
  if (!finalApproverPosition || !finalApproverPosition.user_id) return blocked(ownerPosition.id);

  return {
    ownerPositionId: ownerPosition.id,
    firstApproverId: firstApproverPosition.user_id,
    firstApproverPositionId: firstApproverPosition.id,
    finalApproverId: finalApproverPosition.user_id,
    finalApproverPositionId: finalApproverPosition.id,
    sameApprover: finalApproverPosition.id === firstApproverPosition.id,
    blockedReason: null,
  };
}

export async function resolveApprovalChain(
  supabase: SupabaseClient,
  tenantId: string,
  ownerId: string,
): Promise<ApprovalChain> {
  const { data: positions } = await supabase
    .from("org_positions")
    .select("id, user_id, reports_to_id, position_type")
    .eq("tenant_id", tenantId);
  return resolveApprovalChainFromPositions(positions ?? [], ownerId);
}

export type PendingApprovalItem = {
  id: string;
  ownerId: string | null;
  workflowStatus: string;
};

export type PendingApprovalEntry = { itemId: string; level: "first" | "final" };

/**
 * Pure: given every org_positions row for a tenant and every scorecard
 * currently in a state that needs someone's action, returns which ones the
 * given user is authorized to act on and at which level -- the same
 * resolution used for authorization, reused here so the dashboard only ever
 * shows what the API would actually accept (spec §27). Unlock is
 * deliberately not resolved here -- it's a company_admin role power, not
 * hierarchy-based (see workflow-actions.ts's unlockScorecard).
 */
export function listPendingApprovalsForUser(
  positions: OrgPositionLite[],
  items: PendingApprovalItem[],
  userId: string,
): PendingApprovalEntry[] {
  const entries: PendingApprovalEntry[] = [];
  for (const item of items) {
    if (!item.ownerId) continue;
    const chain = resolveApprovalChainFromPositions(positions, item.ownerId);
    if (chain.blockedReason) continue;
    if (item.workflowStatus === "pending_manager_review" && chain.firstApproverId === userId) {
      entries.push({ itemId: item.id, level: "first" });
    } else if (item.workflowStatus === "pending_final_review" && chain.finalApproverId === userId) {
      entries.push({ itemId: item.id, level: "final" });
    }
  }
  return entries;
}

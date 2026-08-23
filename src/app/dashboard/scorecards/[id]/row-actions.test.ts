import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getCurrentUserMock,
  writeAuditLogMock,
  calculatePerformanceScoresMock,
  resolveApprovalChainMock,
  rowSingleMock,
  rowUpdateMock,
  rowInsertMock,
  rowDeleteMock,
  scorecardSingleMock,
  scorecardMaybeSingleMock,
  snapshotInsertMock,
  candidateResolverMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  calculatePerformanceScoresMock: vi.fn(),
  resolveApprovalChainMock: vi.fn(),
  rowSingleMock: vi.fn(),
  rowUpdateMock: vi.fn(),
  rowInsertMock: vi.fn(),
  rowDeleteMock: vi.fn(),
  scorecardSingleMock: vi.fn(),
  scorecardMaybeSingleMock: vi.fn(),
  snapshotInsertMock: vi.fn(),
  candidateResolverMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/performance", () => ({ calculatePerformanceScores: calculatePerformanceScoresMock }));
vi.mock("@/lib/approval-hierarchy", () => ({ resolveApprovalChain: resolveApprovalChainMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "scorecard_rows") {
        return {
          select: (cols: string) => {
            if (cols === "sort_order, strategic_objective, kpi") {
              return { eq: () => ({ eq: () => ({ order: () => Promise.resolve({ data: [] }) }) }) };
            }
            return { eq: () => ({ single: rowSingleMock }) };
          },
          update: (values: Record<string, unknown>) => ({ eq: () => rowUpdateMock(values) }),
          insert: (values: unknown) => ({ select: () => ({ single: () => rowInsertMock(values) }) }),
          delete: () => ({ eq: () => rowDeleteMock() }),
        };
      }
      if (table === "scorecards") {
        return {
          select: () => ({
            eq: () => ({
              single: scorecardSingleMock,
              eq: () => ({ maybeSingle: scorecardMaybeSingleMock }),
            }),
          }),
        };
      }
      if (table === "performance_snapshots") {
        return { insert: (values: unknown) => snapshotInsertMock(values) };
      }
      if (table === "users") {
        return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: candidateResolverMock }) }) }) };
      }
      throw new Error(`Unexpected table "${table}" in this test's fake client`);
    },
  }),
}));

const { updateScorecardRow, addScorecardRow, deleteScorecardRow } = await import("./row-actions");

const companyAdmin = { id: "admin-1", email: "admin@b.com", full_name: "Admin", role: "company_admin" as const, tenant_id: "tenant-1" };
const owner = { id: "owner-1", email: "owner@b.com", full_name: "Owner One", role: "staff" as const, tenant_id: "tenant-1" };
const manager = { id: "manager-1", email: "manager@b.com", full_name: "Manager One", role: "manager" as const, tenant_id: "tenant-1" };

const baseRow = {
  id: "row-1",
  tenant_id: "tenant-1",
  scorecard_id: "scorecard-1",
  kpi: "Revenue",
  actual: "80",
  target: "100",
  status: "at_risk",
  lower_is_better: false,
  responsible_person: null,
};

const editableScorecard = { id: "scorecard-1", workflow_status: "owner_editing", owner_user_id: "owner-1" };

const resolvedChain = {
  firstApproverId: "manager-1",
  finalApproverId: "dh-1",
  ownerPositionId: "pos-owner",
  firstApproverPositionId: "pos-manager",
  finalApproverPositionId: "pos-dh",
  sameApprover: false,
  blockedReason: null as string | null,
};

beforeEach(() => {
  getCurrentUserMock.mockReset();
  writeAuditLogMock.mockReset();
  calculatePerformanceScoresMock.mockReset();
  resolveApprovalChainMock.mockReset().mockResolvedValue(resolvedChain);
  rowSingleMock.mockReset().mockResolvedValue({ data: baseRow });
  rowUpdateMock.mockReset().mockResolvedValue({ error: null });
  rowInsertMock.mockReset().mockResolvedValue({ data: { id: "row-2" }, error: null });
  rowDeleteMock.mockReset().mockResolvedValue({ error: null });
  scorecardSingleMock.mockReset().mockResolvedValue({ data: editableScorecard });
  scorecardMaybeSingleMock.mockReset().mockResolvedValue({ data: editableScorecard });
  snapshotInsertMock.mockReset().mockResolvedValue({ error: null });
  candidateResolverMock.mockReset().mockResolvedValue({ data: { id: "x" } });
});

describe("updateScorecardRow — actual field gated by the parent scorecard's workflow state", () => {
  it("lets the owner edit while the scorecard is owner_editing", async () => {
    getCurrentUserMock.mockResolvedValue(owner);
    await updateScorecardRow("row-1", "actual", "95");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ actual: "95" }));
  });

  it("blocks a non-owner during owner_editing", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("Not authorized to edit this field");
  });

  it("lets a company_admin edit an unowned scorecard", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...editableScorecard, owner_user_id: null } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await updateScorecardRow("row-1", "actual", "95");
    expect(rowUpdateMock).toHaveBeenCalled();
  });

  it("lets the resolved first approver edit while pending manager review", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...editableScorecard, workflow_status: "pending_manager_review" } });
    getCurrentUserMock.mockResolvedValue(manager);
    await updateScorecardRow("row-1", "actual", "95");
    expect(rowUpdateMock).toHaveBeenCalled();
  });

  it("blocks the owner from editing while pending manager review", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...editableScorecard, workflow_status: "pending_manager_review" } });
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("Not authorized to edit this field");
  });

  it("blocks everyone while pending final review — the division head reviews, doesn't edit", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...editableScorecard, workflow_status: "pending_final_review" } });
    getCurrentUserMock.mockResolvedValue(manager);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("Not authorized to edit this field");
  });

  it("blocks all edits once locked, including for a company_admin", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...editableScorecard, workflow_status: "locked" } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("locked");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("still lets company_admin edit non-actual design fields regardless of workflow state", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...editableScorecard, workflow_status: "pending_final_review" } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await updateScorecardRow("row-1", "kpi", "New KPI name");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ kpi: "New KPI name" }));
  });
});

describe("addScorecardRow / deleteScorecardRow — locked scorecard guard", () => {
  it("blocks adding a row to a locked scorecard", async () => {
    scorecardMaybeSingleMock.mockResolvedValue({ data: { ...editableScorecard, workflow_status: "locked" } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(addScorecardRow("scorecard-1")).rejects.toThrow("locked");
  });

  it("blocks deleting a row on a locked scorecard", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...editableScorecard, workflow_status: "locked" } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(deleteScorecardRow("row-1")).rejects.toThrow("locked");
    expect(rowDeleteMock).not.toHaveBeenCalled();
  });

  it("allows deleting a row on an editable scorecard", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await deleteScorecardRow("row-1");
    expect(rowDeleteMock).toHaveBeenCalled();
  });
});

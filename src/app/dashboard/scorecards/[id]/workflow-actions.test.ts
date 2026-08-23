import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getCurrentUserMock,
  writeAuditLogMock,
  createNotificationMock,
  resolveApprovalChainMock,
  scorecardSingleMock,
  scorecardUpdateMock,
  rowsSelectMock,
  versionInsertMock,
  adminsResolverMock,
  recipientsResolverMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  createNotificationMock: vi.fn(),
  resolveApprovalChainMock: vi.fn(),
  scorecardSingleMock: vi.fn(),
  scorecardUpdateMock: vi.fn(),
  rowsSelectMock: vi.fn(),
  versionInsertMock: vi.fn(),
  adminsResolverMock: vi.fn(),
  recipientsResolverMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/notifications", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/approval-hierarchy", () => ({
  resolveApprovalChain: resolveApprovalChainMock,
  HIERARCHY_NOT_CONFIGURED_MESSAGE: "Approval cannot proceed because the required departmental manager or division head has not been configured. Please contact an authorized administrator.",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "scorecards") {
        return {
          select: () => ({ eq: () => ({ single: scorecardSingleMock }) }),
          update: (values: Record<string, unknown>) => ({ eq: () => scorecardUpdateMock(values) }),
        };
      }
      if (table === "scorecard_rows") {
        return { select: () => ({ eq: () => rowsSelectMock() }) };
      }
      if (table === "scorecard_versions") {
        return { insert: (values: unknown) => versionInsertMock(values) };
      }
      if (table === "users") {
        const chain: { eq: () => typeof chain; in: (col: string, vals: unknown[]) => typeof chain; then: (r: (v: unknown) => void) => void; _inVals?: unknown[] } = {
          eq: () => chain,
          in: (_col, vals) => {
            chain._inVals = vals;
            return chain;
          },
          then: (resolve) => resolve(chain._inVals ? recipientsResolverMock(chain._inVals) : adminsResolverMock()),
        };
        return { select: () => chain };
      }
      throw new Error(`Unexpected table "${table}" in this test's fake client`);
    },
  }),
}));

const { agreeAndSubmitScorecard, submitManagerFirstApproval, submitDivisionHeadFinalApproval, unlockScorecard } = await import("./workflow-actions");

const companyAdmin = { id: "admin-1", email: "admin@b.com", full_name: "Admin", role: "company_admin" as const, tenant_id: "tenant-1" };
const owner = { id: "owner-1", email: "owner@b.com", full_name: "Owner One", role: "staff" as const, tenant_id: "tenant-1" };
const manager = { id: "manager-1", email: "manager@b.com", full_name: "Manager One", role: "manager" as const, tenant_id: "tenant-1" };
const divisionHead = { id: "dh-1", email: "dh@b.com", full_name: "Division Head", role: "manager" as const, tenant_id: "tenant-1" };

const baseScorecard = {
  id: "scorecard-1",
  tenant_id: "tenant-1",
  name: "Owner's BSC",
  owner_user_id: "owner-1",
  workflow_status: "owner_editing",
  version_major: 1,
  version_minor: 0,
  first_approved_by: null as string | null,
};

const resolvedChain = {
  firstApproverId: "manager-1",
  finalApproverId: "dh-1",
  ownerPositionId: "pos-owner",
  firstApproverPositionId: "pos-manager",
  finalApproverPositionId: "pos-dh",
  sameApprover: false,
  blockedReason: null as string | null,
};

const blockedChain = { ...resolvedChain, firstApproverId: null, finalApproverId: null, blockedReason: "no manager configured" };

beforeEach(() => {
  getCurrentUserMock.mockReset();
  writeAuditLogMock.mockReset();
  createNotificationMock.mockReset();
  resolveApprovalChainMock.mockReset().mockResolvedValue(resolvedChain);
  scorecardSingleMock.mockReset().mockResolvedValue({ data: baseScorecard });
  scorecardUpdateMock.mockReset().mockResolvedValue({ error: null });
  rowsSelectMock.mockReset().mockResolvedValue({ data: [{ id: "row-1", kpi: "Revenue", strategic_objective: "Grow" }] });
  versionInsertMock.mockReset().mockResolvedValue({ error: null });
  adminsResolverMock.mockReset().mockReturnValue({ data: [{ id: "admin-1" }] });
  recipientsResolverMock.mockReset().mockImplementation((ids: string[]) => ({ data: ids.map((id) => ({ id, email: `${id}@b.com` })) }));
});

describe("agreeAndSubmitScorecard", () => {
  it("rejects a non-owner", async () => {
    getCurrentUserMock.mockResolvedValue(manager);
    await expect(agreeAndSubmitScorecard("scorecard-1")).rejects.toThrow("Not authorized");
    expect(scorecardUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects when the scorecard isn't in owner_editing", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...baseScorecard, workflow_status: "locked" } });
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(agreeAndSubmitScorecard("scorecard-1")).rejects.toThrow("isn't open for review");
  });

  it("rejects an empty scorecard", async () => {
    rowsSelectMock.mockResolvedValue({ data: [] });
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(agreeAndSubmitScorecard("scorecard-1")).rejects.toThrow("Add at least one KPI");
  });

  it("rejects placeholder rows left unfinished", async () => {
    rowsSelectMock.mockResolvedValue({ data: [{ id: "row-1", kpi: "New KPI", strategic_objective: "New objective" }] });
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(agreeAndSubmitScorecard("scorecard-1")).rejects.toThrow("Finish filling out every row");
  });

  it("submits and notifies the resolved first approver", async () => {
    getCurrentUserMock.mockResolvedValue(owner);
    await agreeAndSubmitScorecard("scorecard-1");
    expect(scorecardUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ workflow_status: "pending_manager_review", agreed_by: "owner-1", version_minor: 1 }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "bsc_pending_manager_review", userId: "manager-1" }));
  });

  it("notifies company_admins when the hierarchy can't be resolved", async () => {
    resolveApprovalChainMock.mockResolvedValue(blockedChain);
    getCurrentUserMock.mockResolvedValue(owner);
    await agreeAndSubmitScorecard("scorecard-1");
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "approval_hierarchy_not_configured", userId: "admin-1" }));
  });
});

describe("submitManagerFirstApproval", () => {
  const pendingScorecard = { ...baseScorecard, workflow_status: "pending_manager_review" };
  beforeEach(() => {
    scorecardSingleMock.mockResolvedValue({ data: pendingScorecard });
    getCurrentUserMock.mockResolvedValue(manager);
  });

  it("no-ops when not pending_manager_review", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...pendingScorecard, workflow_status: "owner_editing" } });
    await submitManagerFirstApproval("scorecard-1", "approved");
    expect(scorecardUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who isn't the resolved first approver", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(submitManagerFirstApproval("scorecard-1", "approved")).rejects.toThrow("Not authorized");
  });

  it("blocks the owner from approving their own BSC even if somehow resolved as manager", async () => {
    getCurrentUserMock.mockResolvedValue({ ...manager, id: "owner-1" });
    await expect(submitManagerFirstApproval("scorecard-1", "approved")).rejects.toThrow("own BSC");
  });

  it("requires a reason to return for correction", async () => {
    await expect(submitManagerFirstApproval("scorecard-1", "rejected", "  ")).rejects.toThrow("reason is required");
  });

  it("approves, moving to pending_final_review and notifying the final approver — not final", async () => {
    await submitManagerFirstApproval("scorecard-1", "approved", "looks right");
    expect(scorecardUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ workflow_status: "pending_final_review", first_approved_by: "manager-1" }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "bsc_pending_final_review", userId: "dh-1" }));
  });

  it("returns to owner_editing on rejection and notifies the owner", async () => {
    await submitManagerFirstApproval("scorecard-1", "rejected", "Needs work");
    expect(scorecardUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ workflow_status: "owner_editing", rejected_level: "first" }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "bsc_returned_for_correction", userId: "owner-1" }));
  });
});

describe("submitDivisionHeadFinalApproval", () => {
  const firstApprovedScorecard = { ...baseScorecard, workflow_status: "pending_final_review", first_approved_by: "manager-1" };
  beforeEach(() => {
    scorecardSingleMock.mockResolvedValue({ data: firstApprovedScorecard });
    getCurrentUserMock.mockResolvedValue(divisionHead);
  });

  it("no-ops when not pending_final_review", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...firstApprovedScorecard, workflow_status: "pending_manager_review" } });
    await submitDivisionHeadFinalApproval("scorecard-1", "approved");
    expect(scorecardUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who isn't the resolved final approver", async () => {
    getCurrentUserMock.mockResolvedValue(manager);
    await expect(submitDivisionHeadFinalApproval("scorecard-1", "approved")).rejects.toThrow("Not authorized");
  });

  it("finally approves and locks — notifies owner and first approver", async () => {
    await submitDivisionHeadFinalApproval("scorecard-1", "approved", "confirmed");
    expect(scorecardUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ workflow_status: "locked", final_approved_by: "dh-1" }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "bsc_finally_approved", userId: "owner-1" }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "bsc_finally_approved", userId: "manager-1" }));
  });

  it("returns to owner_editing on final rejection", async () => {
    await submitDivisionHeadFinalApproval("scorecard-1", "rejected", "needs work");
    expect(scorecardUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ workflow_status: "owner_editing", rejected_level: "final" }));
  });
});

describe("unlockScorecard", () => {
  const lockedScorecard = { ...baseScorecard, workflow_status: "locked", version_major: 1, version_minor: 3 };
  beforeEach(() => {
    scorecardSingleMock.mockResolvedValue({ data: lockedScorecard });
  });

  it("rejects a non-company_admin, even the resolved final approver", async () => {
    getCurrentUserMock.mockResolvedValue(divisionHead);
    await expect(unlockScorecard("scorecard-1", "needs a fix")).rejects.toThrow("Not authorized");
    expect(scorecardUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a scorecard that isn't locked", async () => {
    scorecardSingleMock.mockResolvedValue({ data: { ...lockedScorecard, workflow_status: "owner_editing" } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(unlockScorecard("scorecard-1", "needs a fix")).rejects.toThrow("Only a locked BSC");
  });

  it("requires a reason", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(unlockScorecard("scorecard-1", "  ")).rejects.toThrow("reason is required");
  });

  it("unlocks, bumps the major version, and never itself approves anything", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await unlockScorecard("scorecard-1", "Compliance requested a correction");

    expect(scorecardUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        workflow_status: "owner_editing",
        unlocked_by: "admin-1",
        version_major: 2,
        version_minor: 0,
        final_approved_by: null,
        first_approved_by: null,
        agreed_by: null,
      }),
    );
    expect(writeAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "unlock_bsc" }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "bsc_unlocked", userId: "owner-1" }));
  });
});

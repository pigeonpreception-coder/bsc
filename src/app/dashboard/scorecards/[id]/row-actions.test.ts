import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getCurrentUserMock,
  writeAuditLogMock,
  createNotificationMock,
  calculatePerformanceScoresMock,
  resolveApprovalChainMock,
  rowSingleMock,
  rowUpdateMock,
  snapshotInsertMock,
  versionInsertMock,
  candidateResolverMock,
  adminsResolverMock,
  recipientsResolverMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  createNotificationMock: vi.fn(),
  calculatePerformanceScoresMock: vi.fn(),
  resolveApprovalChainMock: vi.fn(),
  rowSingleMock: vi.fn(),
  rowUpdateMock: vi.fn(),
  snapshotInsertMock: vi.fn(),
  versionInsertMock: vi.fn(),
  candidateResolverMock: vi.fn(),
  adminsResolverMock: vi.fn(),
  recipientsResolverMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/notifications", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/performance", () => ({ calculatePerformanceScores: calculatePerformanceScoresMock }));
vi.mock("@/lib/approval-hierarchy", () => ({
  resolveApprovalChain: resolveApprovalChainMock,
  HIERARCHY_NOT_CONFIGURED_MESSAGE: "Approval cannot proceed because the required departmental manager or division head has not been configured. Please contact an authorized administrator.",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    from: (table: string) => {
      if (table === "scorecard_rows") {
        return {
          select: () => ({ eq: () => ({ single: rowSingleMock }) }),
          update: (values: Record<string, unknown>) => ({ eq: () => rowUpdateMock(values) }),
        };
      }
      if (table === "performance_snapshots") {
        return { insert: (values: unknown) => snapshotInsertMock(values) };
      }
      if (table === "scorecard_row_versions") {
        return {
          select: () => ({ eq: () => Promise.resolve({ count: 0 }) }),
          insert: (values: unknown) => versionInsertMock(values),
        };
      }
      if (table === "users") {
        // A single flexible chain covers all three call shapes this file
        // uses against `users` (candidate check, admins list, recipient
        // lookup) — dispatch happens on the terminal method, since more
        // than one shape shares the same select() column string.
        const chain: {
          eq: (col: string, val: unknown) => typeof chain;
          in: (col: string, vals: unknown[]) => typeof chain;
          maybeSingle: () => Promise<unknown>;
          then: (resolve: (v: unknown) => void) => void;
          _inVals?: unknown[];
        } = {
          eq: () => chain,
          in: (_col, vals) => {
            chain._inVals = vals;
            return chain;
          },
          maybeSingle: () => Promise.resolve(candidateResolverMock()),
          then: (resolve) => resolve(chain._inVals ? recipientsResolverMock(chain._inVals) : adminsResolverMock()),
        };
        return { select: () => chain };
      }
      throw new Error(`Unexpected table "${table}" in this test's fake client`);
    },
  }),
}));

const { updateScorecardRow, submitFirstApproval, submitFinalApproval, requestAmendment, reopenScore } = await import("./row-actions");

const companyAdmin = { id: "admin-1", email: "admin@b.com", full_name: "Admin", role: "company_admin" as const, tenant_id: "tenant-1" };
const owner = { id: "owner-1", email: "owner@b.com", full_name: "Owner One", role: "staff" as const, tenant_id: "tenant-1" };
const manager = { id: "manager-1", email: "manager@b.com", full_name: "Manager One", role: "manager" as const, tenant_id: "tenant-1" };
const divisionHead = { id: "dh-1", email: "dh@b.com", full_name: "Division Head", role: "manager" as const, tenant_id: "tenant-1" };

const baseRow = {
  id: "row-1",
  tenant_id: "tenant-1",
  scorecard_id: "scorecard-1",
  kpi: "Revenue",
  actual: "80",
  target: "100",
  status: "at_risk",
  lower_is_better: false,
  responsible_person: "owner-1",
  approval_status: "not_submitted",
  edited_by: null as string | null,
  first_approved_by: null as string | null,
  final_approved_by: null as string | null,
  rejection_reason: null as string | null,
  rejected_level: null as string | null,
  amendment_reason: null as string | null,
};

const resolvedChain = {
  firstApproverId: "manager-1",
  firstApproverPositionId: "pos-manager",
  finalApproverId: "dh-1",
  finalApproverPositionId: "pos-dh",
  ownerPositionId: "pos-owner",
  sameApprover: false,
  blockedReason: null as string | null,
};

const blockedChain = {
  firstApproverId: null,
  firstApproverPositionId: null,
  finalApproverId: null,
  finalApproverPositionId: null,
  ownerPositionId: null,
  sameApprover: false,
  blockedReason: "Approval cannot proceed because the required departmental manager or division head has not been configured. Please contact an authorized administrator.",
};

beforeEach(() => {
  getCurrentUserMock.mockReset();
  writeAuditLogMock.mockReset();
  createNotificationMock.mockReset();
  calculatePerformanceScoresMock.mockReset();
  resolveApprovalChainMock.mockReset().mockResolvedValue(resolvedChain);
  rowSingleMock.mockReset().mockResolvedValue({ data: baseRow });
  rowUpdateMock.mockReset().mockResolvedValue({ error: null });
  snapshotInsertMock.mockReset().mockResolvedValue({ error: null });
  versionInsertMock.mockReset().mockResolvedValue({ error: null });
  candidateResolverMock.mockReset().mockReturnValue({ data: { id: "x" } });
  adminsResolverMock.mockReset().mockReturnValue({ data: [{ id: "admin-1" }] });
  recipientsResolverMock.mockReset().mockImplementation((ids: string[]) => ({ data: ids.map((id) => ({ id, email: `${id}@b.com` })) }));
});

describe("updateScorecardRow — actual field, hierarchy-based authority", () => {
  it("lets the owner edit their own row", async () => {
    getCurrentUserMock.mockResolvedValue(owner);
    await updateScorecardRow("row-1", "actual", "95");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ actual: "95", approval_status: "submitted", edited_by: "owner-1" }));
  });

  it("lets the resolved immediate manager edit, even though they're not the owner", async () => {
    getCurrentUserMock.mockResolvedValue(manager);
    await updateScorecardRow("row-1", "actual", "95");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ edited_by: "manager-1" }));
  });

  it("blocks a company_admin who is not the owner and not the resolved manager", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("Not authorized to edit this field");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("blocks the resolved final (division-head) approver from editing — only the immediate manager qualifies", async () => {
    getCurrentUserMock.mockResolvedValue(divisionHead);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("Not authorized to edit this field");
  });

  it("blocks all edits once the row is finally_approved, including for a company_admin", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...baseRow, approval_status: "finally_approved" } });
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("locked");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("lets a company_admin edit an unowned row directly, auto-finalizing it", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...baseRow, responsible_person: null } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await updateScorecardRow("row-1", "actual", "95");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "finally_approved", final_approved_by: "admin-1" }));
  });

  it("blocks a non-admin from editing an unowned row", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...baseRow, responsible_person: null } });
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("Not authorized to edit this field");
  });

  it("notifies the resolved first approver on a successful submission", async () => {
    getCurrentUserMock.mockResolvedValue(owner);
    await updateScorecardRow("row-1", "actual", "95");
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "score_submitted_for_review", userId: "manager-1" }),
    );
  });

  it("notifies company_admins instead when the hierarchy can't be resolved", async () => {
    resolveApprovalChainMock.mockResolvedValue(blockedChain);
    getCurrentUserMock.mockResolvedValue(owner);
    await updateScorecardRow("row-1", "actual", "95");
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "approval_hierarchy_not_configured", userId: "admin-1" }),
    );
  });
});

describe("submitFirstApproval", () => {
  const submittedRow = { ...baseRow, approval_status: "submitted", edited_by: "owner-1" };
  beforeEach(() => {
    rowSingleMock.mockResolvedValue({ data: submittedRow });
    getCurrentUserMock.mockResolvedValue(manager);
  });

  it("no-ops on a row that isn't submitted", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...submittedRow, approval_status: "not_submitted" } });
    await submitFirstApproval("row-1", "approved");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who isn't the resolved first approver", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(submitFirstApproval("row-1", "approved")).rejects.toThrow("Not authorized");
  });

  it("blocks the editor from approving their own submission (self-approval / SoD)", async () => {
    getCurrentUserMock.mockResolvedValue({ ...manager, id: "owner-1" });
    resolveApprovalChainMock.mockResolvedValue({ ...resolvedChain, firstApproverId: "owner-1" });
    await expect(submitFirstApproval("row-1", "approved")).rejects.toThrow("edited yourself");
  });

  it("requires a reason to return for correction", async () => {
    await expect(submitFirstApproval("row-1", "rejected", "  ")).rejects.toThrow("reason is required");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("approves, moving the row to first_approved and notifying the final approver — not final", async () => {
    await submitFirstApproval("row-1", "approved", "looks right");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "first_approved", first_approved_by: "manager-1" }));
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "score_pending_final_review", userId: "dh-1" }),
    );
  });

  it("returns for correction and notifies the owner", async () => {
    await submitFirstApproval("row-1", "rejected", "Number looks off");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "correction_required", rejected_level: "first" }));
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "score_returned_for_correction", userId: "owner-1" }),
    );
  });
});

describe("submitFinalApproval", () => {
  const firstApprovedRow = { ...baseRow, approval_status: "first_approved", edited_by: "owner-1", first_approved_by: "manager-1" };
  beforeEach(() => {
    rowSingleMock.mockResolvedValue({ data: firstApprovedRow });
    getCurrentUserMock.mockResolvedValue(divisionHead);
  });

  it("no-ops on a row that isn't first_approved", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...firstApprovedRow, approval_status: "submitted" } });
    await submitFinalApproval("row-1", "approved");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who isn't the resolved final approver", async () => {
    getCurrentUserMock.mockResolvedValue(manager);
    await expect(submitFinalApproval("row-1", "approved")).rejects.toThrow("Not authorized");
  });

  it("finally approves and locks the row", async () => {
    await submitFinalApproval("row-1", "approved", "confirmed");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "finally_approved", final_approved_by: "dh-1" }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "score_finally_approved" }));
  });

  it("returns to correction_required on final rejection", async () => {
    await submitFinalApproval("row-1", "rejected", "needs work");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "correction_required", rejected_level: "final" }));
  });
});

describe("requestAmendment", () => {
  const lockedRow = { ...baseRow, approval_status: "finally_approved" };
  beforeEach(() => {
    rowSingleMock.mockResolvedValue({ data: lockedRow });
  });

  it("rejects a row that isn't finally_approved", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...lockedRow, approval_status: "submitted" } });
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(requestAmendment("row-1", "needs a fix")).rejects.toThrow("Only a locked");
  });

  it("requires a reason", async () => {
    getCurrentUserMock.mockResolvedValue(owner);
    await expect(requestAmendment("row-1", "  ")).rejects.toThrow("reason is required");
  });

  it("rejects someone outside the chain and not an admin", async () => {
    getCurrentUserMock.mockResolvedValue({ ...owner, id: "stranger" });
    await expect(requestAmendment("row-1", "needs a fix")).rejects.toThrow("Not authorized");
  });

  it("allows the owner to request an amendment and notifies the resolved final approver", async () => {
    getCurrentUserMock.mockResolvedValue(owner);
    await requestAmendment("row-1", "The actual was mistyped");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "amendment_requested" }));
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "score_amendment_requested", userId: "dh-1" }),
    );
  });

  it("allows a company_admin to request an amendment even if outside the chain", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await requestAmendment("row-1", "Compliance review found an issue");
    expect(rowUpdateMock).toHaveBeenCalled();
  });
});

describe("reopenScore", () => {
  const amendmentRow = { ...baseRow, approval_status: "amendment_requested", edited_by: "owner-1", first_approved_by: "manager-1" };
  beforeEach(() => {
    rowSingleMock.mockResolvedValue({ data: amendmentRow });
    getCurrentUserMock.mockResolvedValue(divisionHead);
  });

  it("no-ops on a row that isn't amendment_requested", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...amendmentRow, approval_status: "finally_approved" } });
    await reopenScore("row-1", true);
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects a caller who isn't the resolved final approver", async () => {
    getCurrentUserMock.mockResolvedValue(manager);
    await expect(reopenScore("row-1", true)).rejects.toThrow("Not authorized");
  });

  it("reopens the row for correction and notifies the owner/editor/first approver", async () => {
    await reopenScore("row-1", true, "go ahead");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "reopened" }));
    expect(createNotificationMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ type: "score_reopened" }));
  });

  it("denies the amendment, returning the row to finally_approved", async () => {
    await reopenScore("row-1", false, "not warranted");
    expect(rowUpdateMock).toHaveBeenCalledWith(expect.objectContaining({ approval_status: "finally_approved", amendment_requested_by: null }));
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

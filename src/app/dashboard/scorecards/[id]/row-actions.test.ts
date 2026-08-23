import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getCurrentUserMock,
  writeAuditLogMock,
  createNotificationMock,
  calculatePerformanceScoresMock,
  rowSingleMock,
  rowUpdateMock,
  snapshotInsertMock,
  adminsListMock,
  submitterMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  createNotificationMock: vi.fn(),
  calculatePerformanceScoresMock: vi.fn(),
  rowSingleMock: vi.fn(),
  rowUpdateMock: vi.fn(),
  snapshotInsertMock: vi.fn(),
  adminsListMock: vi.fn(),
  submitterMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/notifications", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/performance", () => ({ calculatePerformanceScores: calculatePerformanceScoresMock }));
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
      if (table === "users") {
        return {
          select: (cols: string) => {
            if (cols === "email") return { eq: () => ({ maybeSingle: submitterMock }) };
            return { eq: () => ({ eq: () => adminsListMock() }) };
          },
        };
      }
      throw new Error(`Unexpected table "${table}" in this test's fake client`);
    },
  }),
}));

const { updateScorecardRow, approveScorecardRow } = await import("./row-actions");

const companyAdmin = { id: "admin-1", email: "admin@b.com", full_name: "Admin", role: "company_admin" as const, tenant_id: "tenant-1" };
const staffOwner = { id: "staff-1", email: "staff@b.com", full_name: "Staff One", role: "staff" as const, tenant_id: "tenant-1" };

const baseRow = {
  id: "row-1",
  tenant_id: "tenant-1",
  scorecard_id: "scorecard-1",
  kpi: "Revenue",
  actual: "80",
  target: "100",
  lower_is_better: false,
  responsible_person: "staff-1",
  approval_status: "approved",
  rejection_reason: null as string | null,
};

beforeEach(() => {
  getCurrentUserMock.mockReset();
  writeAuditLogMock.mockReset();
  createNotificationMock.mockReset();
  calculatePerformanceScoresMock.mockReset();
  rowSingleMock.mockReset().mockResolvedValue({ data: baseRow });
  rowUpdateMock.mockReset().mockResolvedValue({ error: null });
  snapshotInsertMock.mockReset().mockResolvedValue({ error: null });
  adminsListMock.mockReset().mockResolvedValue({ data: [{ id: "admin-1", email: "admin@b.com" }] });
  submitterMock.mockReset().mockResolvedValue({ data: { email: "staff@b.com" } });
});

describe("updateScorecardRow — actual field approval routing", () => {
  it("auto-approves when a company_admin edits actual directly", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);

    await updateScorecardRow("row-1", "actual", "95");

    expect(rowUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ actual: "95", approval_status: "approved", approved_by: "admin-1", rejection_reason: null }),
    );
    expect(createNotificationMock).not.toHaveBeenCalled();
  });

  it("puts the row into pending_approval and notifies company_admins when the owning staff member edits actual", async () => {
    getCurrentUserMock.mockResolvedValue(staffOwner);

    await updateScorecardRow("row-1", "actual", "95");

    expect(rowUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ actual: "95", approval_status: "pending_approval", approved_by: null, approved_at: null }),
    );
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "score_pending_review", userId: "admin-1", tenantId: "tenant-1" }),
    );
  });

  it("rejects a staff member editing a row they don't own", async () => {
    getCurrentUserMock.mockResolvedValue({ ...staffOwner, id: "staff-2" });

    await expect(updateScorecardRow("row-1", "actual", "95")).rejects.toThrow("Not authorized to edit this field");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });
});

describe("approveScorecardRow", () => {
  beforeEach(() => {
    rowSingleMock.mockResolvedValue({ data: { ...baseRow, approval_status: "pending_approval" } });
  });

  it("rejects a non-company_admin caller", async () => {
    getCurrentUserMock.mockResolvedValue(staffOwner);
    await expect(approveScorecardRow("row-1", "approved")).rejects.toThrow("Not authorized");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("no-ops on a row that isn't pending review", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...baseRow, approval_status: "approved" } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);

    await approveScorecardRow("row-1", "approved");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("approves, audit-logs, and notifies the submitter", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);

    await approveScorecardRow("row-1", "approved");

    expect(rowUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "approved", approved_by: "admin-1", rejection_reason: null }),
    );
    expect(writeAuditLogMock).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: "approve_score" }));
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "score_approved", userId: "staff-1" }),
    );
  });

  it("requires a reason to reject", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(approveScorecardRow("row-1", "rejected", "  ")).rejects.toThrow("A reason is required");
    expect(rowUpdateMock).not.toHaveBeenCalled();
  });

  it("rejects with a reason, audit-logs, and notifies the submitter", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);

    await approveScorecardRow("row-1", "rejected", "Number looks wrong");

    expect(rowUpdateMock).toHaveBeenCalledWith(
      expect.objectContaining({ approval_status: "rejected", rejection_reason: "Number looks wrong" }),
    );
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "score_rejected", userId: "staff-1", message: expect.stringContaining("Number looks wrong") }),
    );
  });

  it("skips the notification when the row has no responsible_person", async () => {
    rowSingleMock.mockResolvedValue({ data: { ...baseRow, approval_status: "pending_approval", responsible_person: null } });
    getCurrentUserMock.mockResolvedValue(companyAdmin);

    await approveScorecardRow("row-1", "approved");
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

import { describe, it, expect, beforeEach, vi } from "vitest";

const { getCurrentUserMock, singleMock, listFactorsMock, deleteFactorMock, writeAuditLogMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  singleMock: vi.fn(),
  listFactorsMock: vi.fn(),
  deleteFactorMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({ select: () => ({ eq: () => ({ single: singleMock }) }) }),
    auth: { admin: { mfa: { listFactors: listFactorsMock, deleteFactor: deleteFactorMock } } },
  }),
}));

const { resetUserMfaFactors } = await import("./mfa-actions");

const superAdmin = { id: "admin-1", email: "a@b.com", full_name: "Admin", role: "super_admin" as const, tenant_id: null };
const companyAdmin = { id: "ca-1", email: "c@b.com", full_name: "CA", role: "company_admin" as const, tenant_id: "tenant-1" };

describe("resetUserMfaFactors", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    singleMock.mockReset();
    listFactorsMock.mockReset();
    deleteFactorMock.mockReset();
    writeAuditLogMock.mockReset();
  });

  it("rejects a non-super_admin caller", async () => {
    getCurrentUserMock.mockResolvedValue(companyAdmin);
    await expect(resetUserMfaFactors("target-1")).rejects.toThrow("Not authorized");
    expect(listFactorsMock).not.toHaveBeenCalled();
  });

  it("deletes every factor for the target user and audit-logs the reset", async () => {
    getCurrentUserMock.mockResolvedValue(superAdmin);
    singleMock.mockResolvedValue({ data: { tenant_id: "tenant-2" } });
    listFactorsMock.mockResolvedValue({
      data: { factors: [{ id: "factor-a" }, { id: "factor-b" }] },
      error: null,
    });
    deleteFactorMock.mockResolvedValue({ data: { id: "factor-a" }, error: null });

    await resetUserMfaFactors("target-1");

    expect(listFactorsMock).toHaveBeenCalledWith({ userId: "target-1" });
    expect(deleteFactorMock).toHaveBeenCalledTimes(2);
    expect(deleteFactorMock).toHaveBeenCalledWith({ id: "factor-a", userId: "target-1" });
    expect(deleteFactorMock).toHaveBeenCalledWith({ id: "factor-b", userId: "target-1" });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "reset_user_mfa", resource_id: "target-1", tenant_id: "tenant-2" }),
    );
  });

  it("throws when the target user doesn't exist", async () => {
    getCurrentUserMock.mockResolvedValue(superAdmin);
    singleMock.mockResolvedValue({ data: null });

    await expect(resetUserMfaFactors("missing-user")).rejects.toThrow("User not found");
    expect(listFactorsMock).not.toHaveBeenCalled();
  });
});

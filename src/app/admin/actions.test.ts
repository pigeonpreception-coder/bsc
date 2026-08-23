import { describe, it, expect, beforeEach, vi } from "vitest";

const { getCurrentUserMock, writeAuditLogMock, createNotificationMock, singleMock, updateMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  createNotificationMock: vi.fn(),
  singleMock: vi.fn(),
  updateMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/notifications", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/user-invite", () => ({ inviteUserAccount: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/licensing", () => ({
  LICENSE_TIER_DEFAULT_SEATS: { basic: { maxUsers: 10, isUnlimitedUsers: false } },
  canReduceSeatsTo: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ single: singleMock }) }),
      update: (values: Record<string, unknown>) => ({ eq: () => updateMock(values) }),
    }),
  }),
}));

const { setUserStatus } = await import("./actions");

const superAdmin = { id: "super-1", email: "sa@b.com", full_name: "SA", role: "super_admin" as const, tenant_id: null };

describe("setUserStatus", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset().mockResolvedValue(superAdmin);
    writeAuditLogMock.mockReset();
    createNotificationMock.mockReset();
    singleMock.mockReset().mockResolvedValue({ data: { email: "ca@b.com", tenant_id: "tenant-1", status: "active" } });
    updateMock.mockReset().mockResolvedValue({ error: null });
  });

  it("rejects a non-super_admin caller", async () => {
    getCurrentUserMock.mockResolvedValue({ ...superAdmin, role: "company_admin", tenant_id: "tenant-1" });
    await expect(setUserStatus("user-2", "suspended")).rejects.toThrow("Not authorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("blocks changing your own status", async () => {
    await expect(setUserStatus("super-1", "suspended")).rejects.toThrow("own account status");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("blocks targeting another platform administrator (null tenant_id)", async () => {
    singleMock.mockResolvedValue({ data: { email: "other-sa@b.com", tenant_id: null, status: "active" } });
    await expect(setUserStatus("user-2", "suspended")).rejects.toThrow("Not authorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("can act on a company_admin (unlike setTeamMemberStatus), audit-logs, and notifies", async () => {
    await setUserStatus("user-2", "suspended");

    expect(updateMock).toHaveBeenCalledWith({ status: "suspended" });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "set_user_status", tenant_id: "tenant-1" }),
    );
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "account_status_changed", tenantId: "tenant-1" }),
    );
  });

  it("does not notify when reactivating", async () => {
    await setUserStatus("user-2", "active");
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

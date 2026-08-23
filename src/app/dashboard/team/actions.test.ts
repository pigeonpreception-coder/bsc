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
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: singleMock }) }) }),
      update: (values: Record<string, unknown>) => ({ eq: () => ({ eq: () => updateMock(values) }) }),
    }),
  }),
}));

const { setTeamMemberStatus } = await import("./actions");

const companyAdmin = {
  id: "admin-1",
  email: "ca@b.com",
  full_name: "CA",
  role: "company_admin" as const,
  tenant_id: "tenant-1",
};

describe("setTeamMemberStatus", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset().mockResolvedValue(companyAdmin);
    writeAuditLogMock.mockReset();
    createNotificationMock.mockReset();
    singleMock.mockReset().mockResolvedValue({ data: { email: "staff@b.com", role: "staff", status: "active" } });
    updateMock.mockReset().mockResolvedValue({ error: null });
  });

  it("rejects a non-company_admin caller", async () => {
    getCurrentUserMock.mockResolvedValue({ ...companyAdmin, role: "staff" });
    await expect(setTeamMemberStatus("user-2", "suspended")).rejects.toThrow("Not authorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("blocks changing your own status", async () => {
    await expect(setTeamMemberStatus("admin-1", "suspended")).rejects.toThrow("own account status");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a target outside manager/staff/viewer (e.g. another company_admin)", async () => {
    singleMock.mockResolvedValue({ data: { email: "other@b.com", role: "company_admin", status: "active" } });
    await expect(setTeamMemberStatus("user-2", "suspended")).rejects.toThrow("Not authorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("rejects a target not found in the caller's own tenant", async () => {
    singleMock.mockResolvedValue({ data: null });
    await expect(setTeamMemberStatus("user-2", "suspended")).rejects.toThrow("Not authorized");
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("updates status, audit-logs it, and sends a bypass-preference notification when suspending", async () => {
    await setTeamMemberStatus("user-2", "suspended");

    expect(updateMock).toHaveBeenCalledWith({ status: "suspended" });
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "set_user_status", resource_id: "user-2", new_value: { status: "suspended" } }),
    );
    expect(createNotificationMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ type: "account_status_changed", userId: "user-2" }),
    );
  });

  it("does not notify when reactivating (status: active)", async () => {
    await setTeamMemberStatus("user-2", "active");
    expect(updateMock).toHaveBeenCalledWith({ status: "active" });
    expect(createNotificationMock).not.toHaveBeenCalled();
  });
});

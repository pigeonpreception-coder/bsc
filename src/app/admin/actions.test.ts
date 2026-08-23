import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getCurrentUserMock,
  writeAuditLogMock,
  createNotificationMock,
  singleMock,
  updateMock,
  tenantMaybeSingleMock,
  tenantDeleteMock,
  usersListMock,
  storageListMock,
  storageRemoveMock,
  authDeleteUserMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  createNotificationMock: vi.fn(),
  singleMock: vi.fn(),
  updateMock: vi.fn(),
  tenantMaybeSingleMock: vi.fn(),
  tenantDeleteMock: vi.fn(),
  usersListMock: vi.fn(),
  storageListMock: vi.fn(),
  storageRemoveMock: vi.fn(),
  authDeleteUserMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/notifications", () => ({ createNotification: createNotificationMock }));
vi.mock("@/lib/user-invite", () => ({ inviteUserAccount: vi.fn() }));
vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => null }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/licensing", () => ({
  LICENSE_TIER_DEFAULT_SEATS: { basic: { maxUsers: 10, isUnlimitedUsers: false } },
  canReduceSeatsTo: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "tenants") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: tenantMaybeSingleMock }) }),
          delete: () => ({ eq: () => tenantDeleteMock() }),
        };
      }
      if (table === "users") {
        return {
          select: (cols: string) => {
            if (cols === "id") return { eq: () => usersListMock() };
            return { eq: () => ({ single: singleMock }) };
          },
          update: (values: Record<string, unknown>) => ({ eq: () => updateMock(values) }),
        };
      }
      throw new Error(`Unexpected table "${table}" in this test's fake client`);
    },
    storage: { from: () => ({ list: storageListMock, remove: storageRemoveMock }) },
    auth: { admin: { deleteUser: authDeleteUserMock } },
  }),
}));

const { setUserStatus, deleteTenant } = await import("./actions");

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

describe("deleteTenant", () => {
  function formDataFor(fields: Record<string, string>): FormData {
    const fd = new FormData();
    for (const [key, value] of Object.entries(fields)) fd.set(key, value);
    return fd;
  }

  const suspendedTenant = { id: "tenant-1", company_name: "Acme Ltd", license_status: "suspended" };

  beforeEach(() => {
    getCurrentUserMock.mockReset().mockResolvedValue(superAdmin);
    writeAuditLogMock.mockReset();
    tenantMaybeSingleMock.mockReset().mockResolvedValue({ data: suspendedTenant });
    tenantDeleteMock.mockReset().mockResolvedValue({ error: null });
    usersListMock.mockReset().mockResolvedValue({ data: [{ id: "user-a" }, { id: "user-b" }] });
    storageListMock.mockReset().mockResolvedValue({ data: [{ name: "file1.pdf", id: "obj-1" }] });
    storageRemoveMock.mockReset().mockResolvedValue({ error: null });
    authDeleteUserMock.mockReset().mockResolvedValue({ error: null });
  });

  it("rejects a non-super_admin caller", async () => {
    getCurrentUserMock.mockResolvedValue({ ...superAdmin, role: "company_admin", tenant_id: "tenant-1" });
    await expect(
      deleteTenant(formDataFor({ tenant_id: "tenant-1", confirm_name: "Acme Ltd", reason: "test" })),
    ).rejects.toThrow("Not authorized");
    expect(tenantDeleteMock).not.toHaveBeenCalled();
  });

  it("requires a reason", async () => {
    await expect(deleteTenant(formDataFor({ tenant_id: "tenant-1", confirm_name: "Acme Ltd" }))).rejects.toThrow(
      "reason is required",
    );
    expect(tenantDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects when the tenant isn't suspended", async () => {
    tenantMaybeSingleMock.mockResolvedValue({ data: { ...suspendedTenant, license_status: "active" } });
    await expect(
      deleteTenant(formDataFor({ tenant_id: "tenant-1", confirm_name: "Acme Ltd", reason: "test" })),
    ).rejects.toThrow("Suspend this tenant's license");
    expect(tenantDeleteMock).not.toHaveBeenCalled();
  });

  it("rejects when the typed company name doesn't match", async () => {
    await expect(
      deleteTenant(formDataFor({ tenant_id: "tenant-1", confirm_name: "Wrong Name", reason: "test" })),
    ).rejects.toThrow("doesn't match");
    expect(tenantDeleteMock).not.toHaveBeenCalled();
  });

  it("deletes the tenant, cleans up auth users and storage, and audit-logs with no tenant_id", async () => {
    await deleteTenant(formDataFor({ tenant_id: "tenant-1", confirm_name: "Acme Ltd", reason: "GDPR request" }));

    expect(tenantDeleteMock).toHaveBeenCalled();
    expect(authDeleteUserMock).toHaveBeenCalledWith("user-a");
    expect(authDeleteUserMock).toHaveBeenCalledWith("user-b");
    expect(storageRemoveMock).toHaveBeenCalledWith(["tenant-1/file1.pdf"]);
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        action: "delete_tenant",
        tenant_id: null,
        resource_id: "tenant-1",
        new_value: expect.objectContaining({ reason: "GDPR request" }),
      }),
    );
  });

  it("records auth cleanup failures but still completes", async () => {
    authDeleteUserMock.mockResolvedValueOnce({ error: { message: "not found" } }).mockResolvedValueOnce({ error: null });

    await deleteTenant(formDataFor({ tenant_id: "tenant-1", confirm_name: "Acme Ltd", reason: "test" }));

    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ new_value: expect.objectContaining({ auth_cleanup_failures: ["user-a"] }) }),
    );
  });
});

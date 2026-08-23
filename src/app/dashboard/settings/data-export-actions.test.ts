import { describe, it, expect, beforeEach, vi } from "vitest";

const { getCurrentUserMock, writeAuditLogMock, tenantMaybeSingleMock, tableRowsMock, uploadMock, signedUrlMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  tenantMaybeSingleMock: vi.fn(),
  tableRowsMock: vi.fn(),
  uploadMock: vi.fn(),
  signedUrlMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "tenants") {
        return { select: () => ({ eq: () => ({ maybeSingle: tenantMaybeSingleMock }) }) };
      }
      const chain: { eq: () => typeof chain; order: () => typeof chain; limit: () => typeof chain; then: (r: (v: unknown) => void) => void } = {
        eq: () => chain,
        order: () => chain,
        limit: () => chain,
        then: (resolve) => resolve(tableRowsMock(table)),
      };
      return { select: () => chain };
    },
    storage: {
      from: () => ({
        upload: (...args: unknown[]) => uploadMock(...args),
        createSignedUrl: (...args: unknown[]) => signedUrlMock(...args),
      }),
    },
  }),
}));

const { exportTenantData } = await import("./data-export-actions");

const companyAdmin = { id: "admin-1", email: "admin@b.com", full_name: "Admin", role: "company_admin" as const, tenant_id: "tenant-1" };

beforeEach(() => {
  getCurrentUserMock.mockReset().mockResolvedValue(companyAdmin);
  writeAuditLogMock.mockReset();
  tenantMaybeSingleMock.mockReset().mockResolvedValue({ data: { id: "tenant-1", company_name: "Acme Ltd" } });
  tableRowsMock.mockReset().mockImplementation(() => ({ data: [] }));
  uploadMock.mockReset().mockResolvedValue({ error: null });
  signedUrlMock.mockReset().mockResolvedValue({ data: { signedUrl: "https://signed.example/export.json" }, error: null });
});

describe("exportTenantData", () => {
  it("rejects a non-company_admin caller", async () => {
    getCurrentUserMock.mockResolvedValue({ ...companyAdmin, role: "staff" });
    await expect(exportTenantData()).rejects.toThrow("Not authorized");
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it("rejects when the tenant can't be found", async () => {
    tenantMaybeSingleMock.mockResolvedValue({ data: null });
    await expect(exportTenantData()).rejects.toThrow("Tenant not found");
  });

  it("uploads a JSON export scoped to the caller's tenant folder, audit-logs it, and returns a signed URL", async () => {
    const result = await exportTenantData();

    expect(uploadMock).toHaveBeenCalledWith(
      expect.stringMatching(/^tenant-1\/data-exports\/tenant-export-\d+\.json$/),
      expect.any(Buffer),
      { contentType: "application/json" },
    );
    expect(writeAuditLogMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ action: "export_tenant_data", tenant_id: "tenant-1" }),
    );
    expect(result).toEqual({ url: "https://signed.example/export.json" });
  });

  it("includes every core table's rows in the uploaded payload", async () => {
    tableRowsMock.mockImplementation((table: string) =>
      table === "scorecard_rows" ? { data: [{ id: "row-1", kpi: "Revenue" }] } : { data: [] },
    );

    await exportTenantData();

    const [, buffer] = uploadMock.mock.calls[0];
    const payload = JSON.parse((buffer as Buffer).toString("utf-8"));
    expect(payload.tenant.company_name).toBe("Acme Ltd");
    expect(payload.scorecard_rows).toEqual([{ id: "row-1", kpi: "Revenue" }]);
    expect(payload).toHaveProperty("exported_at");
    expect(payload).toHaveProperty("audit_log");
  });
});

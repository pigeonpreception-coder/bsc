import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;

const { state, authAdmin, rpcMock } = vi.hoisted(() => ({
  state: { insertedRows: {} as Record<string, Row[]> },
  authAdmin: {
    inviteUserByEmail: vi.fn(),
    deleteUser: vi.fn(),
  },
  rpcMock: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: authAdmin },
    rpc: rpcMock,
    from: (table: string) => ({
      insert: async (row: Row) => {
        (state.insertedRows[table] ??= []).push(row);
        return { error: null };
      },
    }),
  }),
}));

const { inviteUserAccount } = await import("./user-invite");

describe("inviteUserAccount", () => {
  beforeEach(() => {
    state.insertedRows = {};
    authAdmin.inviteUserByEmail.mockReset();
    authAdmin.deleteUser.mockReset();
    rpcMock.mockReset();
    rpcMock.mockResolvedValue({ data: {}, error: null });
  });

  it("invites the user and provisions the profile via the atomic seat-reservation RPC", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    const result = await inviteUserAccount({
      email: "a@example.com",
      fullName: "A B",
      role: "staff",
      tenantId: "tenant-1",
      department: "Ops",
      origin: "https://app.example.com",
    });

    expect(result).toEqual({ id: "user-1" });
    expect(authAdmin.inviteUserByEmail).toHaveBeenCalledWith("a@example.com", {
      redirectTo: "https://app.example.com/auth/reset-password",
    });
    expect(rpcMock).toHaveBeenCalledWith("provision_tenant_user", {
      p_user_id: "user-1",
      p_tenant_id: "tenant-1",
      p_email: "a@example.com",
      p_full_name: "A B",
      p_role: "staff",
      p_department: "Ops",
    });
    expect(authAdmin.deleteUser).not.toHaveBeenCalled();
  });

  it("also creates a welcome notification for the new user", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-1" } }, error: null });

    await inviteUserAccount({
      email: "a@example.com",
      fullName: "A B",
      role: "staff",
      tenantId: "tenant-1",
      department: "Ops",
      origin: "https://app.example.com",
    });

    expect(state.insertedRows.notifications).toEqual([
      { tenant_id: "tenant-1", user_id: "user-1", notification_type: "account_created", message: expect.any(String), link: "/dashboard" },
    ]);
  });

  it("defaults department to null when not provided (e.g. createCompanyAdmin)", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-2" } }, error: null });

    await inviteUserAccount({
      email: "admin@example.com",
      fullName: null,
      role: "company_admin",
      tenantId: "tenant-2",
      origin: "https://app.example.com",
    });

    expect(rpcMock).toHaveBeenCalledWith("provision_tenant_user", expect.objectContaining({ p_department: null, p_role: "company_admin" }));
  });

  it("propagates the invite error without ever calling the provisioning RPC", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: null, error: new Error("invite failed") });

    await expect(
      inviteUserAccount({ email: "x@example.com", fullName: null, role: "staff", tenantId: "t", origin: null }),
    ).rejects.toThrow("invite failed");

    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("generalizes an 'already registered' error instead of confirming the email exists elsewhere", async () => {
    const alreadyRegistered = Object.assign(new Error("A user with this email address has already been registered"), {
      code: "email_exists",
    });
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: null, error: alreadyRegistered });

    await expect(
      inviteUserAccount({ email: "existing@example.com", fullName: null, role: "staff", tenantId: "t", origin: null }),
    ).rejects.toThrow("Could not send the invite. Check the email address and try again.");
  });

  it("rolls back the auth user if the provisioning RPC fails", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-3" } }, error: null });
    rpcMock.mockResolvedValue({ data: null, error: { message: "duplicate key value violates unique constraint" } });

    await expect(
      inviteUserAccount({ email: "y@example.com", fullName: null, role: "viewer", tenantId: "t", origin: null }),
    ).rejects.toBeTruthy();

    expect(authAdmin.deleteUser).toHaveBeenCalledWith("user-3");
  });

  it("surfaces the exact spec-worded seat-limit-reached message and still rolls back", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-6" } }, error: null });
    rpcMock.mockResolvedValue({ data: null, error: { message: "SEAT_LIMIT_REACHED:10" } });

    await expect(
      inviteUserAccount({ email: "z@example.com", fullName: null, role: "staff", tenantId: "t", origin: null }),
    ).rejects.toThrow(
      "Your current license allows up to 10 users. You have reached your licensed user limit. Please upgrade your license or purchase additional user capacity before adding another user.",
    );
    expect(authAdmin.deleteUser).toHaveBeenCalledWith("user-6");
  });

  describe("origin trust", () => {
    const originalAppUrl = process.env.NEXT_PUBLIC_APP_URL;

    afterEach(() => {
      if (originalAppUrl === undefined) delete process.env.NEXT_PUBLIC_APP_URL;
      else process.env.NEXT_PUBLIC_APP_URL = originalAppUrl;
    });

    it("uses NEXT_PUBLIC_APP_URL instead of a caller-supplied origin, when set", async () => {
      process.env.NEXT_PUBLIC_APP_URL = "https://real-safina-domain.example.com";
      authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-4" } }, error: null });

      await inviteUserAccount({
        email: "z@example.com",
        fullName: null,
        role: "staff",
        tenantId: "t",
        origin: "https://attacker.example.com",
      });

      expect(authAdmin.inviteUserByEmail).toHaveBeenCalledWith("z@example.com", {
        redirectTo: "https://real-safina-domain.example.com/auth/reset-password",
      });
    });

    it("falls back to the caller-supplied origin only when no env var is configured", async () => {
      delete process.env.NEXT_PUBLIC_APP_URL;
      authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-5" } }, error: null });

      await inviteUserAccount({
        email: "w@example.com",
        fullName: null,
        role: "staff",
        tenantId: "t",
        origin: "https://app.example.com",
      });

      expect(authAdmin.inviteUserByEmail).toHaveBeenCalledWith("w@example.com", {
        redirectTo: "https://app.example.com/auth/reset-password",
      });
    });
  });
});

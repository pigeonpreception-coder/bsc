import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Row = Record<string, unknown>;

const { state, authAdmin } = vi.hoisted(() => ({
  state: { insertedRows: {} as Record<string, Row[]>, nextInsertError: null as { message: string } | null },
  authAdmin: {
    inviteUserByEmail: vi.fn(),
    deleteUser: vi.fn(),
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: authAdmin },
    from: (table: string) => ({
      insert: async (row: Row) => {
        if (state.nextInsertError) {
          const err = state.nextInsertError;
          state.nextInsertError = null;
          return { error: err };
        }
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
    state.nextInsertError = null;
    authAdmin.inviteUserByEmail.mockReset();
    authAdmin.deleteUser.mockReset();
  });

  it("invites the user and inserts a matching profile row", async () => {
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
    expect(state.insertedRows.users).toEqual([
      { id: "user-1", email: "a@example.com", full_name: "A B", role: "staff", tenant_id: "tenant-1", department: "Ops" },
    ]);
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

    expect(state.insertedRows.users[0]).toMatchObject({ department: null, role: "company_admin" });
  });

  it("propagates the invite error without touching the users table", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: null, error: new Error("invite failed") });

    await expect(
      inviteUserAccount({ email: "x@example.com", fullName: null, role: "staff", tenantId: "t", origin: null }),
    ).rejects.toThrow("invite failed");

    expect(state.insertedRows.users ?? []).toEqual([]);
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

  it("rolls back the auth user if the profile insert fails", async () => {
    authAdmin.inviteUserByEmail.mockResolvedValue({ data: { user: { id: "user-3" } }, error: null });
    state.nextInsertError = { message: "duplicate key value violates unique constraint" };

    await expect(
      inviteUserAccount({ email: "y@example.com", fullName: null, role: "viewer", tenantId: "t", origin: null }),
    ).rejects.toBeTruthy();

    expect(authAdmin.deleteUser).toHaveBeenCalledWith("user-3");
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

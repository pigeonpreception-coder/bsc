import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

type Row = Record<string, unknown>;

const { state, authAdmin } = vi.hoisted(() => ({
  state: {
    insertedUsers: [] as Row[],
    insertedTenants: [] as Row[],
    deletedTenantIds: [] as string[],
    nextTenantInsertError: null as { message: string } | null,
    nextUsersInsertError: null as { message: string } | null,
  },
  authAdmin: { deleteUser: vi.fn() },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { admin: authAdmin },
    from: (table: string) => ({
      insert: (row: Row) => {
        if (table === "tenants") {
          return {
            select: () => ({
              single: async () => {
                if (state.nextTenantInsertError) {
                  const err = state.nextTenantInsertError;
                  state.nextTenantInsertError = null;
                  return { data: null, error: err };
                }
                const withId = { ...row, id: "tenant-new-1" };
                state.insertedTenants.push(withId);
                return { data: { id: "tenant-new-1" }, error: null };
              },
            }),
          };
        }
        // users table — awaited directly, no chained select in the code under test.
        return (async () => {
          if (state.nextUsersInsertError) {
            const err = state.nextUsersInsertError;
            state.nextUsersInsertError = null;
            return { error: err };
          }
          state.insertedUsers.push(row);
          return { error: null };
        })();
      },
      delete: () => ({
        eq: async (_column: string, id: string) => {
          state.deletedTenantIds.push(id);
          return { error: null };
        },
      }),
    }),
  }),
}));

const { signUpNewTenant } = await import("./signup");

function fakeAuthClient(signUpResult: { data: { user: Row | null; session: Row | null }; error: unknown }) {
  const signUp = vi.fn().mockResolvedValue(signUpResult);
  return { auth: { signUp } } as unknown as SupabaseClient;
}

const newUser = { id: "user-1", identities: [{ identity_id: "id-1" }] };

const baseParams = {
  email: "founder@example.com",
  password: "correct-horse",
  fullName: "Founder Name",
  companyName: "New Co",
  emailRedirectTo: "https://app.example.com/auth/callback",
};

describe("signUpNewTenant", () => {
  beforeEach(() => {
    state.insertedUsers = [];
    state.insertedTenants = [];
    state.deletedTenantIds = [];
    state.nextTenantInsertError = null;
    state.nextUsersInsertError = null;
    authAdmin.deleteUser.mockReset();
  });

  it("creates a tenant and a company_admin profile for a genuinely new signup", async () => {
    const supabase = fakeAuthClient({ data: { user: newUser, session: { access_token: "t" } }, error: null });

    const result = await signUpNewTenant(supabase, baseParams);

    expect(result).toEqual({ needsEmailConfirmation: false });
    expect(state.insertedTenants).toEqual([{ company_name: "New Co", id: "tenant-new-1" }]);
    expect(state.insertedUsers).toEqual([
      {
        id: "user-1",
        email: "founder@example.com",
        full_name: "Founder Name",
        role: "company_admin",
        tenant_id: "tenant-new-1",
      },
    ]);
  });

  it("reports needsEmailConfirmation when signUp returns no session", async () => {
    const supabase = fakeAuthClient({ data: { user: newUser, session: null }, error: null });

    const result = await signUpNewTenant(supabase, baseParams);
    expect(result).toEqual({ needsEmailConfirmation: true });
  });

  it("generalizes an already-registered auth error", async () => {
    const supabase = fakeAuthClient({
      data: { user: null, session: null },
      error: Object.assign(new Error("A user with this email address has already been registered"), {
        code: "email_exists",
      }),
    });

    await expect(signUpNewTenant(supabase, baseParams)).rejects.toThrow("already exists");
    expect(state.insertedTenants).toEqual([]);
  });

  it("treats Supabase's obfuscated/fake user object (empty identities) as an already-registered email, without creating a tenant", async () => {
    const supabase = fakeAuthClient({
      data: { user: { id: "fake-obfuscated-id", identities: [] }, session: null },
      error: null,
    });

    await expect(signUpNewTenant(supabase, baseParams)).rejects.toThrow("already exists");
    expect(state.insertedTenants).toEqual([]);
    expect(state.insertedUsers).toEqual([]);
  });

  it("rolls back the auth user if the tenant insert fails", async () => {
    state.nextTenantInsertError = { message: "insert failed" };
    const supabase = fakeAuthClient({ data: { user: newUser, session: { access_token: "t" } }, error: null });

    await expect(signUpNewTenant(supabase, baseParams)).rejects.toBeTruthy();
    expect(authAdmin.deleteUser).toHaveBeenCalledWith("user-1");
    expect(state.insertedUsers).toEqual([]);
  });

  it("rolls back both the auth user and the tenant if the profile insert fails", async () => {
    state.nextUsersInsertError = { message: "insert failed" };
    const supabase = fakeAuthClient({ data: { user: newUser, session: { access_token: "t" } }, error: null });

    await expect(signUpNewTenant(supabase, baseParams)).rejects.toBeTruthy();
    expect(authAdmin.deleteUser).toHaveBeenCalledWith("user-1");
    expect(state.deletedTenantIds).toEqual(["tenant-new-1"]);
  });
});

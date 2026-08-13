import { describe, it, expect, vi, beforeEach } from "vitest";

const { getCurrentUserMock, getUserMock, signOutMock } = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  getUserMock: vi.fn(),
  signOutMock: vi.fn().mockResolvedValue({ data: null, error: null }),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    auth: { getUser: getUserMock, admin: { signOut: signOutMock } },
  }),
}));

const { revokeOtherSessions } = await import("./actions");

describe("revokeOtherSessions", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    getUserMock.mockReset();
    signOutMock.mockClear();
  });

  it("revokes other sessions when the token resolves to the same user as the caller's own session", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });
    getUserMock.mockResolvedValue({ data: { user: { id: "user-1" } } });

    await revokeOtherSessions("token-abc");

    expect(signOutMock).toHaveBeenCalledWith("token-abc", "others");
  });

  it("does nothing when there's no authenticated caller", async () => {
    getCurrentUserMock.mockResolvedValue(null);

    await revokeOtherSessions("token-abc");

    expect(getUserMock).not.toHaveBeenCalled();
    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("does nothing when the token belongs to a different user than the caller — the case this fix closes", async () => {
    getCurrentUserMock.mockResolvedValue({ id: "user-1" });
    getUserMock.mockResolvedValue({ data: { user: { id: "someone-else" } } });

    await revokeOtherSessions("token-belonging-to-someone-else");

    expect(signOutMock).not.toHaveBeenCalled();
  });

  it("swallows errors instead of throwing (best-effort — the password change already succeeded)", async () => {
    getCurrentUserMock.mockRejectedValue(new Error("boom"));

    await expect(revokeOtherSessions("token-abc")).resolves.toBeUndefined();
  });
});

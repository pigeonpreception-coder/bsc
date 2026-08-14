import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getCurrentUserMock,
  checkMfaChallengeRateLimitMock,
  recordMfaChallengeAttemptMock,
  challengeAndVerifyMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  checkMfaChallengeRateLimitMock: vi.fn(),
  recordMfaChallengeAttemptMock: vi.fn(),
  challengeAndVerifyMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkMfaChallengeRateLimit: checkMfaChallengeRateLimitMock,
  recordMfaChallengeAttempt: recordMfaChallengeAttemptMock,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { mfa: { challengeAndVerify: challengeAndVerifyMock } } }),
}));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: () => "203.0.113.1" }),
}));

const { verifyLoginMfaChallenge } = await import("./actions");

const user = { id: "user-1", email: "a@b.com", full_name: "A B", role: "staff" as const, tenant_id: "tenant-1" };

describe("verifyLoginMfaChallenge", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    checkMfaChallengeRateLimitMock.mockReset();
    recordMfaChallengeAttemptMock.mockReset();
    challengeAndVerifyMock.mockReset();
    getCurrentUserMock.mockResolvedValue(user);
    checkMfaChallengeRateLimitMock.mockResolvedValue({ allowed: true });
  });

  it("succeeds and records a successful attempt", async () => {
    challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null });

    await expect(verifyLoginMfaChallenge("factor-1", "123456")).resolves.toBeUndefined();
    expect(recordMfaChallengeAttemptMock).toHaveBeenCalledWith("user-1", "203.0.113.1", true);
  });

  it("throws and records a failed attempt on a wrong code", async () => {
    challengeAndVerifyMock.mockResolvedValue({ data: null, error: { message: "invalid" } });

    await expect(verifyLoginMfaChallenge("factor-1", "000000")).rejects.toThrow("didn't work");
    expect(recordMfaChallengeAttemptMock).toHaveBeenCalledWith("user-1", "203.0.113.1", false);
  });

  it("rejects before attempting a challenge once rate-limited", async () => {
    checkMfaChallengeRateLimitMock.mockResolvedValue({ allowed: false, reason: "Too many attempts." });

    await expect(verifyLoginMfaChallenge("factor-1", "123456")).rejects.toThrow("Too many attempts.");
    expect(challengeAndVerifyMock).not.toHaveBeenCalled();
  });
});

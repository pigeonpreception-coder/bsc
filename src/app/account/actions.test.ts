import { describe, it, expect, beforeEach, vi } from "vitest";

const {
  getCurrentUserMock,
  enrollMock,
  challengeAndVerifyMock,
  unenrollMock,
  listFactorsMock,
  writeAuditLogMock,
  checkMfaChallengeRateLimitMock,
  recordMfaChallengeAttemptMock,
} = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  enrollMock: vi.fn(),
  challengeAndVerifyMock: vi.fn(),
  unenrollMock: vi.fn(),
  listFactorsMock: vi.fn(),
  writeAuditLogMock: vi.fn(),
  checkMfaChallengeRateLimitMock: vi.fn(),
  recordMfaChallengeAttemptMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      mfa: {
        enroll: enrollMock,
        challengeAndVerify: challengeAndVerifyMock,
        unenroll: unenrollMock,
        listFactors: listFactorsMock,
      },
    },
  }),
}));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));
vi.mock("@/lib/rate-limit", () => ({
  checkMfaChallengeRateLimit: checkMfaChallengeRateLimitMock,
  recordMfaChallengeAttempt: recordMfaChallengeAttemptMock,
}));

const { enrollMfaFactor, verifyMfaEnrollment, unenrollMfaFactor } = await import("./actions");

const staff = { id: "user-1", email: "a@b.com", full_name: "A B", role: "staff" as const, tenant_id: "tenant-1" };
const companyAdmin = {
  id: "admin-1",
  email: "ca@b.com",
  full_name: "CA",
  role: "company_admin" as const,
  tenant_id: "tenant-1",
};

describe("MFA account actions", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    enrollMock.mockReset();
    challengeAndVerifyMock.mockReset();
    unenrollMock.mockReset();
    listFactorsMock.mockReset();
    writeAuditLogMock.mockReset();
    checkMfaChallengeRateLimitMock.mockReset();
    recordMfaChallengeAttemptMock.mockReset();
    checkMfaChallengeRateLimitMock.mockResolvedValue({ allowed: true });
  });

  describe("enrollMfaFactor", () => {
    it("rejects an unauthenticated caller", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      await expect(enrollMfaFactor()).rejects.toThrow("Not authorized");
      expect(enrollMock).not.toHaveBeenCalled();
    });

    it("returns the trimmed factorId/qrCode/secret shape", async () => {
      getCurrentUserMock.mockResolvedValue(staff);
      enrollMock.mockResolvedValue({
        data: { id: "factor-1", type: "totp", totp: { qr_code: "<svg/>", secret: "SECRET", uri: "otpauth://..." } },
        error: null,
      });

      const result = await enrollMfaFactor();
      expect(result).toEqual({ factorId: "factor-1", qrCode: "<svg/>", secret: "SECRET" });
    });
  });

  describe("verifyMfaEnrollment", () => {
    it("audit-logs and records a successful attempt on successful verification", async () => {
      getCurrentUserMock.mockResolvedValue(staff);
      challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null });

      await verifyMfaEnrollment("factor-1", "123456");

      expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
      expect(recordMfaChallengeAttemptMock).toHaveBeenCalledWith("user-1", null, true);
      expect(writeAuditLogMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "enroll_mfa_factor", user_id: "user-1", tenant_id: "tenant-1" }),
      );
    });

    it("does not audit-log and records a failed attempt when verification fails", async () => {
      getCurrentUserMock.mockResolvedValue(staff);
      challengeAndVerifyMock.mockResolvedValue({ data: null, error: { message: "invalid code" } });

      await expect(verifyMfaEnrollment("factor-1", "000000")).rejects.toBeTruthy();
      expect(recordMfaChallengeAttemptMock).toHaveBeenCalledWith("user-1", null, false);
      expect(writeAuditLogMock).not.toHaveBeenCalled();
    });

    it("rejects before attempting a challenge once rate-limited", async () => {
      getCurrentUserMock.mockResolvedValue(staff);
      checkMfaChallengeRateLimitMock.mockResolvedValue({ allowed: false, reason: "Too many attempts." });

      await expect(verifyMfaEnrollment("factor-1", "123456")).rejects.toThrow("Too many attempts.");
      expect(challengeAndVerifyMock).not.toHaveBeenCalled();
    });
  });

  describe("unenrollMfaFactor", () => {
    it("rejects an unauthenticated caller", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      await expect(unenrollMfaFactor("factor-1")).rejects.toThrow("Not authorized");
      expect(unenrollMock).not.toHaveBeenCalled();
    });

    it("audit-logs on success for a role with no mandatory-MFA restriction", async () => {
      getCurrentUserMock.mockResolvedValue(staff);
      unenrollMock.mockResolvedValue({ data: {}, error: null });

      await unenrollMfaFactor("factor-1");

      expect(listFactorsMock).not.toHaveBeenCalled();
      expect(writeAuditLogMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "unenroll_mfa_factor", user_id: "user-1" }),
      );
    });

    it("blocks a company_admin from removing their last verified factor", async () => {
      getCurrentUserMock.mockResolvedValue(companyAdmin);
      listFactorsMock.mockResolvedValue({
        data: { all: [{ id: "factor-1", factor_type: "totp", status: "verified" }] },
        error: null,
      });

      await expect(unenrollMfaFactor("factor-1")).rejects.toThrow("requires two-factor authentication");
      expect(unenrollMock).not.toHaveBeenCalled();
    });

    it("allows a company_admin to remove a factor when another verified factor remains", async () => {
      getCurrentUserMock.mockResolvedValue(companyAdmin);
      listFactorsMock.mockResolvedValue({
        data: {
          all: [
            { id: "factor-1", factor_type: "totp", status: "verified" },
            { id: "factor-2", factor_type: "totp", status: "verified" },
          ],
        },
        error: null,
      });
      unenrollMock.mockResolvedValue({ data: {}, error: null });

      await unenrollMfaFactor("factor-1");
      expect(unenrollMock).toHaveBeenCalledWith({ factorId: "factor-1" });
    });
  });
});

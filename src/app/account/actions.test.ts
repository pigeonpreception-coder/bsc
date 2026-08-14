import { describe, it, expect, beforeEach, vi } from "vitest";

const { getCurrentUserMock, enrollMock, challengeAndVerifyMock, unenrollMock, writeAuditLogMock } = vi.hoisted(
  () => ({
    getCurrentUserMock: vi.fn(),
    enrollMock: vi.fn(),
    challengeAndVerifyMock: vi.fn(),
    unenrollMock: vi.fn(),
    writeAuditLogMock: vi.fn(),
  }),
);

vi.mock("@/lib/auth", () => ({ getCurrentUser: getCurrentUserMock }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: {
      mfa: {
        enroll: enrollMock,
        challengeAndVerify: challengeAndVerifyMock,
        unenroll: unenrollMock,
      },
    },
  }),
}));
vi.mock("@/lib/audit-log", () => ({ writeAuditLog: writeAuditLogMock }));

const { enrollMfaFactor, verifyMfaEnrollment, unenrollMfaFactor } = await import("./actions");

const user = { id: "user-1", email: "a@b.com", full_name: "A B", role: "staff" as const, tenant_id: "tenant-1" };

describe("MFA account actions", () => {
  beforeEach(() => {
    getCurrentUserMock.mockReset();
    enrollMock.mockReset();
    challengeAndVerifyMock.mockReset();
    unenrollMock.mockReset();
    writeAuditLogMock.mockReset();
  });

  describe("enrollMfaFactor", () => {
    it("rejects an unauthenticated caller", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      await expect(enrollMfaFactor()).rejects.toThrow("Not authorized");
      expect(enrollMock).not.toHaveBeenCalled();
    });

    it("returns the trimmed factorId/qrCode/secret shape", async () => {
      getCurrentUserMock.mockResolvedValue(user);
      enrollMock.mockResolvedValue({
        data: { id: "factor-1", type: "totp", totp: { qr_code: "<svg/>", secret: "SECRET", uri: "otpauth://..." } },
        error: null,
      });

      const result = await enrollMfaFactor();
      expect(result).toEqual({ factorId: "factor-1", qrCode: "<svg/>", secret: "SECRET" });
    });
  });

  describe("verifyMfaEnrollment", () => {
    it("audit-logs on successful verification", async () => {
      getCurrentUserMock.mockResolvedValue(user);
      challengeAndVerifyMock.mockResolvedValue({ data: {}, error: null });

      await verifyMfaEnrollment("factor-1", "123456");

      expect(challengeAndVerifyMock).toHaveBeenCalledWith({ factorId: "factor-1", code: "123456" });
      expect(writeAuditLogMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "enroll_mfa_factor", user_id: "user-1", tenant_id: "tenant-1" }),
      );
    });

    it("does not audit-log when verification fails", async () => {
      getCurrentUserMock.mockResolvedValue(user);
      challengeAndVerifyMock.mockResolvedValue({ data: null, error: { message: "invalid code" } });

      await expect(verifyMfaEnrollment("factor-1", "000000")).rejects.toBeTruthy();
      expect(writeAuditLogMock).not.toHaveBeenCalled();
    });
  });

  describe("unenrollMfaFactor", () => {
    it("rejects an unauthenticated caller", async () => {
      getCurrentUserMock.mockResolvedValue(null);
      await expect(unenrollMfaFactor("factor-1")).rejects.toThrow("Not authorized");
      expect(unenrollMock).not.toHaveBeenCalled();
    });

    it("audit-logs on success", async () => {
      getCurrentUserMock.mockResolvedValue(user);
      unenrollMock.mockResolvedValue({ data: {}, error: null });

      await unenrollMfaFactor("factor-1");

      expect(writeAuditLogMock).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ action: "unenroll_mfa_factor", user_id: "user-1" }),
      );
    });
  });
});

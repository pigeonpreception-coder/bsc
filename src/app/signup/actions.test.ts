import { describe, it, expect, beforeEach, vi } from "vitest";

const { checkSignupRateLimitMock, recordSignupAttemptMock, signUpNewTenantMock } = vi.hoisted(() => ({
  checkSignupRateLimitMock: vi.fn(),
  recordSignupAttemptMock: vi.fn(),
  signUpNewTenantMock: vi.fn(),
}));

vi.mock("@/lib/rate-limit", () => ({
  checkSignupRateLimit: checkSignupRateLimitMock,
  recordSignupAttempt: recordSignupAttemptMock,
}));
vi.mock("@/lib/signup", () => ({ signUpNewTenant: signUpNewTenantMock }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({}) }));
vi.mock("next/headers", () => ({
  headers: async () => ({ get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.1" : null) }),
}));

const { signUp } = await import("./actions");

function formDataFor(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) fd.set(key, value);
  return fd;
}

const validFields = {
  email: "Founder@Example.com",
  password: "correct-horse-battery",
  full_name: "Founder Name",
  company_name: "New Co",
};

describe("signUp", () => {
  beforeEach(() => {
    checkSignupRateLimitMock.mockReset();
    recordSignupAttemptMock.mockReset();
    signUpNewTenantMock.mockReset();
    checkSignupRateLimitMock.mockResolvedValue({ allowed: true });
  });

  it("normalizes the email, rate-limits, and records a successful attempt", async () => {
    signUpNewTenantMock.mockResolvedValue({ needsEmailConfirmation: true });

    const result = await signUp(formDataFor(validFields));

    expect(result).toEqual({ needsEmailConfirmation: true });
    expect(checkSignupRateLimitMock).toHaveBeenCalledWith("founder@example.com", "203.0.113.1");
    expect(signUpNewTenantMock).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ email: "founder@example.com", companyName: "New Co", fullName: "Founder Name" }),
    );
    expect(recordSignupAttemptMock).toHaveBeenCalledWith("founder@example.com", "203.0.113.1", true);
  });

  it("rejects before attempting signup once rate-limited", async () => {
    checkSignupRateLimitMock.mockResolvedValue({ allowed: false, reason: "Too many attempts." });

    await expect(signUp(formDataFor(validFields))).rejects.toThrow("Too many attempts.");
    expect(signUpNewTenantMock).not.toHaveBeenCalled();
  });

  it("rejects a password shorter than the minimum, without ever calling signUpNewTenant", async () => {
    await expect(signUp(formDataFor({ ...validFields, password: "short" }))).rejects.toThrow("at least 8 characters");
    expect(signUpNewTenantMock).not.toHaveBeenCalled();
    expect(checkSignupRateLimitMock).not.toHaveBeenCalled();
  });

  it("rejects when a required field is missing", async () => {
    await expect(signUp(formDataFor({ ...validFields, company_name: "" }))).rejects.toThrow("required");
    expect(signUpNewTenantMock).not.toHaveBeenCalled();
  });

  it("records a failed attempt and rethrows when signUpNewTenant throws", async () => {
    signUpNewTenantMock.mockRejectedValue(new Error("An account with this email already exists."));

    await expect(signUp(formDataFor(validFields))).rejects.toThrow("already exists");
    expect(recordSignupAttemptMock).toHaveBeenCalledWith("founder@example.com", "203.0.113.1", false);
  });
});

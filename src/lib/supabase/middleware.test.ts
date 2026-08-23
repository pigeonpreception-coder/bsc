import { describe, it, expect } from "vitest";
import { isPublicPath, needsMfaChallenge, needsMandatoryMfaEnrollment } from "./middleware";

describe("isPublicPath", () => {
  it("treats /login, /signup, and /auth as public", () => {
    expect(isPublicPath("/login")).toBe(true);
    expect(isPublicPath("/signup")).toBe(true);
    expect(isPublicPath("/auth/callback")).toBe(true);
  });

  it("treats every /api route as public — each authenticates itself independently and carries no session cookie", () => {
    expect(isPublicPath("/api/cron/daily-tasks")).toBe(true);
    expect(isPublicPath("/api/cron/performance-recalc")).toBe(true);
    expect(isPublicPath("/api/cron/weekly-advisory")).toBe(true);
    expect(isPublicPath("/api/sentry-check")).toBe(true);
  });

  it("treats dashboard and other app routes as protected", () => {
    expect(isPublicPath("/dashboard")).toBe(false);
    expect(isPublicPath("/dashboard/plan/123")).toBe(false);
    expect(isPublicPath("/")).toBe(false);
  });
});

describe("needsMfaChallenge", () => {
  it("is true once a verified factor exists but this session hasn't cleared the challenge", () => {
    expect(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal2" })).toBe(true);
  });

  it("is false once the session has already cleared the challenge", () => {
    expect(needsMfaChallenge({ currentLevel: "aal2", nextLevel: "aal2" })).toBe(false);
  });

  it("is false for a user with no enrolled factor at all", () => {
    expect(needsMfaChallenge({ currentLevel: "aal1", nextLevel: "aal1" })).toBe(false);
  });

  it("is false when the AAL lookup itself failed", () => {
    expect(needsMfaChallenge(null)).toBe(false);
  });
});

describe("needsMandatoryMfaEnrollment", () => {
  const unenrolled = { currentLevel: "aal1", nextLevel: "aal1" };

  it("requires enrollment for an unenrolled company_admin", () => {
    expect(needsMandatoryMfaEnrollment("company_admin", unenrolled, "/dashboard")).toBe(true);
  });

  it("requires enrollment for an unenrolled super_admin", () => {
    expect(needsMandatoryMfaEnrollment("super_admin", unenrolled, "/admin")).toBe(true);
  });

  it("does not require enrollment for other roles", () => {
    expect(needsMandatoryMfaEnrollment("staff", unenrolled, "/dashboard")).toBe(false);
    expect(needsMandatoryMfaEnrollment("manager", unenrolled, "/dashboard")).toBe(false);
    expect(needsMandatoryMfaEnrollment("viewer", unenrolled, "/dashboard")).toBe(false);
  });

  it("does not loop into the enrollment page itself", () => {
    expect(needsMandatoryMfaEnrollment("company_admin", unenrolled, "/account")).toBe(false);
  });

  it("does not require enrollment once a factor exists, even before the challenge is cleared", () => {
    expect(needsMandatoryMfaEnrollment("company_admin", { currentLevel: "aal1", nextLevel: "aal2" }, "/dashboard")).toBe(
      false,
    );
  });

  it("does not require enrollment once already at aal2", () => {
    expect(needsMandatoryMfaEnrollment("company_admin", { currentLevel: "aal2", nextLevel: "aal2" }, "/dashboard")).toBe(
      false,
    );
  });
});

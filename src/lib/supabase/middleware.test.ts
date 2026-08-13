import { describe, it, expect } from "vitest";
import { isPublicPath } from "./middleware";

describe("isPublicPath", () => {
  it("treats /login and /auth as public", () => {
    expect(isPublicPath("/login")).toBe(true);
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

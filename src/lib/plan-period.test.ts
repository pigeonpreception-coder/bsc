import { describe, it, expect } from "vitest";
import { computePeriodEnd } from "./plan-period";

describe("computePeriodEnd", () => {
  it("computes a period end one day before the anniversary, N years out", () => {
    expect(computePeriodEnd("2026-01-01", 3)).toBe("2028-12-31");
  });

  it("handles a leap-day start correctly across a non-leap target year", () => {
    // 2024-02-29, day-1=28 lands within February in the non-leap target
    // year (2025), so there's no month rollover: 2025-02-28.
    expect(computePeriodEnd("2024-02-29", 1)).toBe("2025-02-28");
  });

  it("returns null when financialYearStart is empty", () => {
    expect(computePeriodEnd("", 3)).toBeNull();
  });

  it("returns null when years is 0 or null-ish", () => {
    expect(computePeriodEnd("2026-01-01", 0)).toBeNull();
  });

  it("returns null for an unparseable date string", () => {
    expect(computePeriodEnd("not-a-date", 3)).toBeNull();
  });

  it("is stable across a year boundary (Dec start)", () => {
    expect(computePeriodEnd("2026-12-15", 1)).toBe("2027-12-14");
  });
});

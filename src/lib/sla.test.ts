import { describe, it, expect } from "vitest";
import { daysSince, classifyReviewAge, REVIEW_REMINDER_DAYS, REVIEW_ESCALATION_DAYS } from "./sla";

describe("daysSince", () => {
  it("computes fractional days between a past timestamp and now", () => {
    const now = new Date("2026-01-10T00:00:00Z");
    expect(daysSince("2026-01-05T00:00:00Z", now)).toBeCloseTo(5, 5);
  });

  it("returns 0 for the current moment", () => {
    const now = new Date("2026-01-10T12:00:00Z");
    expect(daysSince(now.toISOString(), now)).toBe(0);
  });
});

describe("classifyReviewAge", () => {
  it("is 'ok' below the reminder threshold", () => {
    expect(classifyReviewAge(0)).toBe("ok");
    expect(classifyReviewAge(REVIEW_REMINDER_DAYS - 0.01)).toBe("ok");
  });

  it("is 'reminder' at and above the reminder threshold, below escalation", () => {
    expect(classifyReviewAge(REVIEW_REMINDER_DAYS)).toBe("reminder");
    expect(classifyReviewAge(REVIEW_ESCALATION_DAYS - 0.01)).toBe("reminder");
  });

  it("is 'escalation' at and above the escalation threshold", () => {
    expect(classifyReviewAge(REVIEW_ESCALATION_DAYS)).toBe("escalation");
    expect(classifyReviewAge(30)).toBe("escalation");
  });
});

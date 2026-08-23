import { describe, it, expect } from "vitest";
import { computeLinearTrend, projectScore, trendDirection } from "./benchmarking";

describe("computeLinearTrend", () => {
  it("returns null with fewer than 2 points", () => {
    expect(computeLinearTrend([])).toBeNull();
    expect(computeLinearTrend([{ date: "2026-01-01", value: 50 }])).toBeNull();
  });

  it("fits a perfect upward line exactly", () => {
    const points = [
      { date: "2026-01-01", value: 50 },
      { date: "2026-01-02", value: 55 },
      { date: "2026-01-03", value: 60 },
    ];
    const trend = computeLinearTrend(points)!;
    expect(trend.slope).toBeCloseTo(5, 5);
    expect(trend.intercept).toBeCloseTo(50, 5);
  });

  it("fits a flat line with zero slope", () => {
    const points = [
      { date: "2026-01-01", value: 70 },
      { date: "2026-01-05", value: 70 },
      { date: "2026-01-10", value: 70 },
    ];
    const trend = computeLinearTrend(points)!;
    expect(trend.slope).toBeCloseTo(0, 5);
    expect(trend.intercept).toBeCloseTo(70, 5);
  });

  it("is order-independent — unsorted input fits the same line as sorted", () => {
    const sorted = [
      { date: "2026-01-01", value: 40 },
      { date: "2026-01-02", value: 42 },
      { date: "2026-01-03", value: 44 },
    ];
    const shuffled = [sorted[2], sorted[0], sorted[1]];
    expect(computeLinearTrend(shuffled)).toEqual(computeLinearTrend(sorted));
  });

  it("does not divide by zero when every point shares the same date", () => {
    const points = [
      { date: "2026-01-01", value: 60 },
      { date: "2026-01-01", value: 80 },
    ];
    const trend = computeLinearTrend(points)!;
    expect(trend.slope).toBe(0);
    expect(trend.intercept).toBe(70);
  });
});

describe("projectScore", () => {
  it("returns null with insufficient data", () => {
    expect(projectScore([{ date: "2026-01-01", value: 50 }], 30)).toBeNull();
  });

  it("projects forward along the fitted trend", () => {
    const points = [
      { date: "2026-01-01", value: 50 },
      { date: "2026-01-02", value: 51 },
      { date: "2026-01-03", value: 52 },
    ];
    // slope = 1/day, last x = 2 days from origin — 10 days ahead = x=12 -> 50 + 12 = 62
    expect(projectScore(points, 10)).toBeCloseTo(62, 5);
  });

  it("clamps the projection to 100 for a strong upward trend", () => {
    const points = [
      { date: "2026-01-01", value: 90 },
      { date: "2026-01-02", value: 95 },
    ];
    expect(projectScore(points, 30)).toBe(100);
  });

  it("clamps the projection to 0 for a strong downward trend", () => {
    const points = [
      { date: "2026-01-01", value: 20 },
      { date: "2026-01-02", value: 10 },
    ];
    expect(projectScore(points, 30)).toBe(0);
  });
});

describe("trendDirection", () => {
  it("classifies a clearly positive slope as up", () => {
    expect(trendDirection(1)).toBe("up");
  });

  it("classifies a clearly negative slope as down", () => {
    expect(trendDirection(-1)).toBe("down");
  });

  it("classifies a near-zero slope as flat, not noise-driven up/down", () => {
    expect(trendDirection(0.01)).toBe("flat");
    expect(trendDirection(-0.01)).toBe("flat");
    expect(trendDirection(0)).toBe("flat");
  });
});

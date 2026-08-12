import { describe, it, expect } from "vitest";
import {
  computeAutoStatus,
  computeProgressPercent,
  perspectiveSortIndex,
  perspectiveBucket,
} from "./scorecard";

describe("computeProgressPercent", () => {
  it("returns null when actual is unparseable", () => {
    expect(computeProgressPercent(null, "100")).toBeNull();
    expect(computeProgressPercent("", "100")).toBeNull();
    expect(computeProgressPercent("n/a", "100")).toBeNull();
  });

  it("returns null when target is unparseable", () => {
    expect(computeProgressPercent("50", null)).toBeNull();
  });

  it("computes a standard higher-is-better ratio", () => {
    expect(computeProgressPercent("50", "100")).toBe(50);
    expect(computeProgressPercent("120", "100")).toBe(120);
  });

  it("returns null for a zero target on a higher-is-better KPI (undefined ratio)", () => {
    expect(computeProgressPercent("10", "0")).toBeNull();
  });

  it("inverts the ratio for lower-is-better KPIs", () => {
    // Actual 5 against a target of 10 (fewer is better) => 200% (2x better than target)
    expect(computeProgressPercent("5", "10", true)).toBe(200);
    // Actual 20 against a target of 10 => 50% (worse than target)
    expect(computeProgressPercent("20", "10", true)).toBe(50);
  });

  it("treats a zero actual as a fully-met lower-is-better KPI, not a divide-by-zero", () => {
    expect(computeProgressPercent("0", "5", true)).toBe(100);
  });

  it("parses numbers embedded in units/commas", () => {
    expect(computeProgressPercent("1,250 units", "1,000 units")).toBe(125);
  });
});

describe("computeAutoStatus", () => {
  it("is not_yet_measured when unparseable", () => {
    expect(computeAutoStatus(null, "100")).toBe("not_yet_measured");
  });

  it("is on_track at or above 95%", () => {
    expect(computeAutoStatus("95", "100")).toBe("on_track");
    expect(computeAutoStatus("100", "100")).toBe("on_track");
  });

  it("is at_risk between 80% and 94%", () => {
    expect(computeAutoStatus("80", "100")).toBe("at_risk");
    expect(computeAutoStatus("94", "100")).toBe("at_risk");
  });

  it("is off_track below 80%", () => {
    expect(computeAutoStatus("79", "100")).toBe("off_track");
    expect(computeAutoStatus("0", "100")).toBe("off_track");
  });

  it("respects lowerIsBetter when classifying status", () => {
    // Actual 2 against target 10, lower is better => 500% => on_track
    expect(computeAutoStatus("2", "10", true)).toBe("on_track");
    // Actual 15 against target 10, lower is better => 66.7% => off_track
    expect(computeAutoStatus("15", "10", true)).toBe("off_track");
  });
});

describe("perspectiveSortIndex / perspectiveBucket", () => {
  it("orders canonical GES perspectives Financial -> Customer -> Process -> Capacity", () => {
    expect(perspectiveSortIndex("Financial")).toBe(0);
    expect(perspectiveSortIndex("Customer & Stakeholder")).toBe(1);
    expect(perspectiveSortIndex("Internal Processes")).toBe(2);
    expect(perspectiveSortIndex("Organisational Capacity")).toBe(3);
  });

  it("accepts the classic aliases in the same bucket order", () => {
    expect(perspectiveSortIndex("Customer")).toBe(1);
    expect(perspectiveSortIndex("Internal Process")).toBe(2);
    expect(perspectiveSortIndex("Learning & Growth")).toBe(3);
  });

  it("is case/whitespace insensitive", () => {
    expect(perspectiveSortIndex("  financial  ")).toBe(0);
  });

  it("sorts unknown perspectives to the end", () => {
    expect(perspectiveSortIndex("Something Else")).toBe(99);
  });

  it("buckets classic and GES perspective labels to the same fixed DB column", () => {
    expect(perspectiveBucket("Financial")).toBe("financial");
    expect(perspectiveBucket("Customer & Stakeholder")).toBe("customer");
    expect(perspectiveBucket("Customer")).toBe("customer");
    expect(perspectiveBucket("Internal Processes")).toBe("internal_process");
    expect(perspectiveBucket("Learning & Growth")).toBe("learning_growth");
  });

  it("returns null for an unrecognized perspective", () => {
    expect(perspectiveBucket("Something Else")).toBeNull();
  });
});

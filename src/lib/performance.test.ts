import { describe, it, expect } from "vitest";
import {
  weightedAverage,
  computeScorecardScore,
  computeCompositeScore,
  computePositionDepth,
  type CascadeWeights,
} from "./performance";

const WEIGHTS: CascadeWeights = {
  section_own_weight: 0.4,
  section_subordinate_weight: 0.6,
  department_own_weight: 0.3,
  department_subordinate_weight: 0.7,
  executive_own_weight: 0.25,
  executive_subordinate_weight: 0.75,
  corporate_own_weight: 0.2,
  corporate_subordinate_weight: 0.8,
};

describe("weightedAverage", () => {
  it("returns 0 for an empty list (no divide-by-zero)", () => {
    expect(weightedAverage([])).toBe(0);
  });

  it("returns 0 when total weight is zero", () => {
    expect(weightedAverage([{ score: 80, weight: 0 }])).toBe(0);
  });

  it("computes a simple weighted average", () => {
    // (100*1 + 0*1) / 2 = 50
    expect(weightedAverage([{ score: 100, weight: 1 }, { score: 0, weight: 1 }])).toBe(50);
    // (100*3 + 0*1) / 4 = 75
    expect(weightedAverage([{ score: 100, weight: 3 }, { score: 0, weight: 1 }])).toBe(75);
  });
});

describe("computeScorecardScore", () => {
  const baseRow = {
    id: "r1",
    scorecard_id: "sc1",
    objective_weight: 1,
    perspective_weight: null,
    lower_is_better: false,
    status: "not_yet_measured",
  };

  it("returns zeros for an empty scorecard", () => {
    const result = computeScorecardScore([]);
    expect(result.ownScore).toBe(0);
    expect(result.total).toBe(0);
    expect(result.onTrack + result.atRisk + result.offTrack).toBe(0);
  });

  it("ignores rows with unparseable actual/target when scoring, but the row still counts toward total", () => {
    const result = computeScorecardScore([
      { ...baseRow, perspective: "Financial", actual: null, target: "100" },
    ]);
    expect(result.total).toBe(1);
    expect(result.onTrack).toBe(0);
    expect(result.atRisk).toBe(0);
    expect(result.offTrack).toBe(0);
    // No scoreable row in any bucket -> ownScore falls back to 0
    expect(result.ownScore).toBe(0);
  });

  it("classifies rows into on/at-risk/off-track buckets consistently with computeAutoStatus", () => {
    const result = computeScorecardScore([
      { ...baseRow, perspective: "Financial", actual: "100", target: "100" }, // on_track
      { ...baseRow, perspective: "Customer", actual: "85", target: "100" }, // at_risk
      { ...baseRow, perspective: "Internal Process", actual: "50", target: "100" }, // off_track
    ]);
    expect(result.onTrack).toBe(1);
    expect(result.atRisk).toBe(1);
    expect(result.offTrack).toBe(1);
    expect(result.total).toBe(3);
  });

  it("caps an individual KPI's contribution at 100% even if it overshoots", () => {
    const result = computeScorecardScore([
      { ...baseRow, perspective: "Financial", actual: "500", target: "100" },
    ]);
    expect(result.financialScore).toBe(100);
  });

  it("falls back to an equal 25%-per-perspective split when no perspective_weight is set", () => {
    const result = computeScorecardScore([
      { ...baseRow, perspective: "Financial", actual: "0", target: "100" }, // financial 0%
      { ...baseRow, perspective: "Customer", actual: "100", target: "100" }, // customer 100%
    ]);
    // Two perspectives present, equal 25/25 weight between them -> simple average
    expect(result.ownScore).toBe(50);
  });

  it("weights perspectives by their configured perspective_weight", () => {
    const result = computeScorecardScore([
      { ...baseRow, perspective: "Financial", actual: "0", target: "100", perspective_weight: 80 },
      { ...baseRow, perspective: "Customer", actual: "100", target: "100", perspective_weight: 20 },
    ]);
    // 0*80 + 100*20, divided by 100 total weight => 20
    expect(result.ownScore).toBe(20);
  });
});

describe("computeCompositeScore (the cascade rule)", () => {
  it("a leaf position's composite equals its own score", () => {
    expect(computeCompositeScore("individual_staff", 72, [], WEIGHTS)).toBe(72);
  });

  it("blends own and subordinate scores by position_type-specific weights", () => {
    // section_supervisor: 0.4 own / 0.6 subordinate
    const result = computeCompositeScore("section_supervisor", 80, [60], WEIGHTS);
    expect(result).toBeCloseTo(80 * 0.4 + 60 * 0.6, 10);
  });

  it("averages multiple children before applying the subordinate weight", () => {
    const result = computeCompositeScore("non_executive", 90, [40, 60], WEIGHTS);
    const avgChild = (40 + 60) / 2;
    expect(result).toBeCloseTo(90 * WEIGHTS.department_own_weight + avgChild * WEIGHTS.department_subordinate_weight, 10);
  });

  it("uses the executive weight tier for executive positions", () => {
    const result = computeCompositeScore("executive", 50, [50], WEIGHTS);
    expect(result).toBeCloseTo(50 * WEIGHTS.executive_own_weight + 50 * WEIGHTS.executive_subordinate_weight, 10);
  });

  it("falls back to an even 50/50 split for an unrecognized position_type with children", () => {
    const result = computeCompositeScore("board", 100, [0], WEIGHTS);
    expect(result).toBe(50);
  });
});

describe("computePositionDepth", () => {
  it("a root position (no reports_to_id) has depth 0", () => {
    const map = new Map([["root", { reports_to_id: null }]]);
    expect(computePositionDepth("root", map)).toBe(0);
  });

  it("walks a normal chain up to the root", () => {
    const map = new Map([
      ["root", { reports_to_id: null }],
      ["mid", { reports_to_id: "root" }],
      ["leaf", { reports_to_id: "mid" }],
    ]);
    expect(computePositionDepth("leaf", map)).toBe(2);
    expect(computePositionDepth("mid", map)).toBe(1);
    expect(computePositionDepth("root", map)).toBe(0);
  });

  it("returns 0 for a position that isn't in the map at all", () => {
    expect(computePositionDepth("missing", new Map())).toBe(0);
  });

  it("terminates instead of looping forever on a corrupted cyclic hierarchy", () => {
    // a -> b -> c -> a, a data-integrity bug that should never happen through
    // normal use but shouldn't hang or stack-overflow if it ever does
    const map = new Map([
      ["a", { reports_to_id: "b" }],
      ["b", { reports_to_id: "c" }],
      ["c", { reports_to_id: "a" }],
    ]);
    expect(() => computePositionDepth("a", map)).not.toThrow();
    expect(Number.isFinite(computePositionDepth("a", map))).toBe(true);
  });
});

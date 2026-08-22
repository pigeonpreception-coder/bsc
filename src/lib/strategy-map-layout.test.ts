import { describe, it, expect } from "vitest";
import {
  deriveConnectionType,
  edgesCross,
  computeMapOrder,
  resolveConnections,
  dedupeConnections,
  type MapObjective,
  type MapConnection,
} from "./strategy-map-layout";

describe("deriveConnectionType", () => {
  it("returns lateral for same-level edges", () => {
    expect(deriveConnectionType(1, 1)).toBe("lateral");
  });

  it("returns vertical for exactly one level up", () => {
    expect(deriveConnectionType(1, 2)).toBe("vertical");
  });

  it("returns null for a downward edge", () => {
    expect(deriveConnectionType(2, 1)).toBeNull();
  });

  it("returns null for a skipped level", () => {
    expect(deriveConnectionType(0, 2)).toBeNull();
  });
});

describe("edgesCross", () => {
  it("crosses when source order and target order disagree", () => {
    expect(edgesCross(0, 1, 1, 0)).toBe(true);
  });

  it("does not cross when both orders agree", () => {
    expect(edgesCross(0, 0, 1, 1)).toBe(false);
  });

  it("does not cross when the two edges converge on the same target", () => {
    expect(edgesCross(0, 0, 1, 0)).toBe(false);
  });

  it("does not cross when the two edges share a source", () => {
    expect(edgesCross(0, 0, 0, 1)).toBe(false);
  });
});

describe("dedupeConnections", () => {
  it("drops an exact-duplicate VERTICAL connection — the bug this test guards against", () => {
    // Regression test: the original implementation only deduped same-level
    // (lateral) pairs, since that check was conflated with the two-node-
    // cycle guard. A vertical connection named twice by the AI passed
    // straight through, double-counting the source's outgoing edges and
    // persisting a duplicate row with no DB constraint to catch it either.
    const candidates: MapConnection[] = [
      { from: "A1", to: "B1", type: "vertical" },
      { from: "A1", to: "B1", type: "vertical" },
    ];
    expect(dedupeConnections(candidates)).toEqual([{ from: "A1", to: "B1", type: "vertical" }]);
  });

  it("drops an exact-duplicate lateral connection", () => {
    const candidates: MapConnection[] = [
      { from: "A1", to: "A2", type: "lateral" },
      { from: "A1", to: "A2", type: "lateral" },
    ];
    expect(dedupeConnections(candidates)).toEqual([{ from: "A1", to: "A2", type: "lateral" }]);
  });

  it("collapses a two-node lateral cycle to whichever direction was seen first", () => {
    const candidates: MapConnection[] = [
      { from: "A1", to: "A2", type: "lateral" },
      { from: "A2", to: "A1", type: "lateral" },
    ];
    expect(dedupeConnections(candidates)).toEqual([{ from: "A1", to: "A2", type: "lateral" }]);
  });

  it("keeps distinct vertical connections from the same source to different targets", () => {
    const candidates: MapConnection[] = [
      { from: "A1", to: "B1", type: "vertical" },
      { from: "A1", to: "B2", type: "vertical" },
    ];
    expect(dedupeConnections(candidates)).toEqual(candidates);
  });
});

describe("computeMapOrder", () => {
  // The spec's own worked example (§10): four objectives across four
  // levels, deliberately laid out so a naive left-to-right pass without
  // barycenter sorting would cross.
  const objectives: MapObjective[] = [
    { id: "A1", level: 0 },
    { id: "A2", level: 0 },
    { id: "B1", level: 1 },
    { id: "B2", level: 1 },
    { id: "C1", level: 2 },
    { id: "C2", level: 2 },
    { id: "D1", level: 3 },
  ];
  const connections: MapConnection[] = [
    { from: "A1", to: "B1", type: "vertical" },
    { from: "A1", to: "A2", type: "lateral" },
    { from: "A2", to: "B1", type: "vertical" },
    { from: "A2", to: "B2", type: "vertical" },
    { from: "B1", to: "C1", type: "vertical" },
    { from: "B2", to: "C1", type: "vertical" },
    { from: "B2", to: "C2", type: "vertical" },
    { from: "C1", to: "C2", type: "lateral" },
    { from: "C1", to: "D1", type: "vertical" },
    { from: "C2", to: "D1", type: "vertical" },
  ];

  it("produces the spec's documented order (A1<A2, B1<B2, C1<C2) with zero crossings", () => {
    const order = computeMapOrder(objectives, connections);
    expect(order.get("A1")).toBeLessThan(order.get("A2")!);
    expect(order.get("B1")).toBeLessThan(order.get("B2")!);
    expect(order.get("C1")).toBeLessThan(order.get("C2")!);

    const resolved = resolveConnections(connections, order, new Map(objectives.map((o) => [o.id, o.level])));
    // All 10 edges survive: both lateral edges (A1-A2, C1-C2) connect
    // objectives that are adjacent in the final order, and no vertical
    // crossing exists to throw on.
    expect(resolved).toHaveLength(10);
  });

  it("still reaches a crossing-free layout when the input order would otherwise cross", () => {
    // Deliberately reverse B1/B2's input order relative to what the
    // barycenter pass wants (B1 should end up left of B2, given A1/A2's
    // connections) — the transpose pass must correct this, not just the
    // initial barycenter sort.
    const reordered: MapObjective[] = [
      { id: "A1", level: 0 },
      { id: "A2", level: 0 },
      { id: "B2", level: 1 },
      { id: "B1", level: 1 },
      { id: "C1", level: 2 },
      { id: "C2", level: 2 },
      { id: "D1", level: 3 },
    ];
    const order = computeMapOrder(reordered, connections);
    expect(order.get("B1")).toBeLessThan(order.get("B2")!);
  });

  it("does not collapse an objective with no incoming vertical edge to position zero", () => {
    // E1 (level 1) has no incoming edge from level 0 at all — it should
    // keep a position near its own input order, not jump to the front.
    const withOrphan: MapObjective[] = [
      { id: "A1", level: 0 },
      { id: "A2", level: 0 },
      { id: "B1", level: 1 },
      { id: "E1", level: 1 },
      { id: "B2", level: 1 },
    ];
    const orphanConnections: MapConnection[] = [
      { from: "A1", to: "B1", type: "vertical" },
      { from: "A2", to: "B2", type: "vertical" },
    ];
    const order = computeMapOrder(withOrphan, orphanConnections);
    // E1 was placed between B1 and B2 in the input — it should stay there,
    // not collapse to order 0 ahead of B1.
    expect(order.get("B1")).toBeLessThan(order.get("E1")!);
    expect(order.get("E1")).toBeLessThan(order.get("B2")!);
  });

  it("handles a single-objective row without error", () => {
    const order = computeMapOrder(
      [{ id: "D1", level: 3 }],
      [],
    );
    expect(order.get("D1")).toBe(0);
  });
});

describe("resolveConnections", () => {
  const levelById = new Map([
    ["A1", 0],
    ["A2", 0],
    ["A3", 0],
  ]);

  it("drops a lateral edge whose endpoints aren't adjacent in the final order", () => {
    const order = new Map([
      ["A1", 0],
      ["A2", 1],
      ["A3", 2],
    ]);
    const connections: MapConnection[] = [{ from: "A1", to: "A3", type: "lateral" }];
    expect(resolveConnections(connections, order, levelById)).toEqual([]);
  });

  it("keeps a lateral edge whose endpoints are adjacent", () => {
    const order = new Map([
      ["A1", 0],
      ["A2", 1],
      ["A3", 2],
    ]);
    const connections: MapConnection[] = [{ from: "A1", to: "A2", type: "lateral" }];
    expect(resolveConnections(connections, order, levelById)).toEqual(connections);
  });

  it("throws when a vertical crossing survives", () => {
    const crossingLevels = new Map([
      ["S1", 0],
      ["S2", 0],
      ["T1", 1],
      ["T2", 1],
    ]);
    // S1 is left of S2, but S1 targets T2 (right) while S2 targets T1
    // (left) — a genuine, unresolved crossing.
    const order = new Map([
      ["S1", 0],
      ["S2", 1],
      ["T1", 0],
      ["T2", 1],
    ]);
    const connections: MapConnection[] = [
      { from: "S1", to: "T2", type: "vertical" },
      { from: "S2", to: "T1", type: "vertical" },
    ];
    expect(() => resolveConnections(connections, order, crossingLevels)).toThrow(/regenerating/);
  });
});

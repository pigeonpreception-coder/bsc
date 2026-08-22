// Deterministic strategy-map layout: given objectives (each with a causal
// "level", 0 = bottom) and the connections an LLM already decided between
// them, compute a left-to-right order per row such that no connecting line
// crosses another when rendered. This is plain combinatorial code on
// purpose, not LLM reasoning — a well-established layered-graph-drawing
// technique (barycenter + transpose, the same family Graphviz's `dot` uses)
// is a far more reliable way to guarantee zero crossings than free-form
// model output, especially as objective count grows.

export type MapObjective = { id: string; level: number };
export type MapConnectionType = "vertical" | "lateral";
export type MapConnection = { from: string; to: string; type: MapConnectionType };

/** Direction Constraint: same level (lateral), or exactly one level up (vertical).
 *  Returns null when neither holds — i.e. the edge is invalid and must be rejected. */
export function deriveConnectionType(fromLevel: number, toLevel: number): MapConnectionType | null {
  if (toLevel === fromLevel) return "lateral";
  if (toLevel === fromLevel + 1) return "vertical";
  return null;
}

/**
 * Drops exact-duplicate connections (an LLM's tool-call output can name
 * the same (from, to) pair twice — nothing in a JSON Schema forbids it),
 * and collapses a two-node lateral cycle (A→B and B→A at the same level)
 * down to whichever direction was seen first. Vertical edges can never
 * form a two-node cycle — their direction is fixed by the two distinct
 * levels involved — so only the exact-duplicate check applies to them.
 */
export function dedupeConnections(candidates: MapConnection[]): MapConnection[] {
  const seenDirected = new Set<string>();
  const seenLateral = new Set<string>();
  const result: MapConnection[] = [];

  for (const c of candidates) {
    const directedKey = `${c.from}>${c.to}`;
    if (seenDirected.has(directedKey)) continue;
    seenDirected.add(directedKey);

    if (c.type === "lateral") {
      const undirectedKey = [c.from, c.to].sort().join("|");
      if (seenLateral.has(undirectedKey)) continue;
      seenLateral.add(undirectedKey);
    }

    result.push(c);
  }

  return result;
}

/**
 * Two edges between the same pair of adjacent rows cross iff their source
 * order and target order disagree. Converging targets (t1 === t2) are
 * never a crossing — two arrows landing on the same objective just meet.
 */
export function edgesCross(s1: number, t1: number, s2: number, t2: number): boolean {
  if (t1 === t2) return false;
  return (s1 < s2 && t1 > t2) || (s1 > s2 && t1 < t2);
}

function countCrossings(
  rowOrder: string[],
  belowIndex: Map<string, number>,
  verticalEdges: { from: string; to: string }[],
): number {
  const rowIndex = new Map(rowOrder.map((id, i) => [id, i]));
  const relevant = verticalEdges.filter((e) => belowIndex.has(e.from) && rowIndex.has(e.to));
  let count = 0;
  for (let i = 0; i < relevant.length; i++) {
    for (let j = i + 1; j < relevant.length; j++) {
      const e1 = relevant[i];
      const e2 = relevant[j];
      if (
        edgesCross(belowIndex.get(e1.from)!, rowIndex.get(e1.to)!, belowIndex.get(e2.from)!, rowIndex.get(e2.to)!)
      ) {
        count++;
      }
    }
  }
  return count;
}

// Adjacent-pair swap, repeated to a fixed point — reliably reaches zero
// crossings for typical BSC row sizes (3-6 objectives). Only checks against
// the row below, per the barycenter pass's own bottom-to-top direction;
// edges between non-adjacent levels never occur (rejected upstream), so
// this is a safe no-op for a row with no real level directly below it.
function transposeRefine(rowOrder: string[], belowOrder: string[], verticalEdges: { from: string; to: string }[]): string[] {
  const belowIndex = new Map(belowOrder.map((id, i) => [id, i]));
  let current = [...rowOrder];
  let improved = true;
  while (improved) {
    improved = false;
    for (let i = 0; i < current.length - 1; i++) {
      const before = countCrossings(current, belowIndex, verticalEdges);
      const swapped = [...current];
      [swapped[i], swapped[i + 1]] = [swapped[i + 1], swapped[i]];
      const after = countCrossings(swapped, belowIndex, verticalEdges);
      if (after < before) {
        current = swapped;
        improved = true;
      }
    }
  }
  return current;
}

/**
 * Computes each objective's left-to-right position within its row.
 * Bottom row keeps its input order (§7.1 — "any reasonable order"). Each
 * row above is barycenter-sorted by the average position of its vertical
 * sources one level below, then transpose-refined. An objective with no
 * incoming vertical edge falls back to its own original index as the sort
 * key (not 0), so it doesn't collapse to the left edge — a stable sort
 * naturally keeps it near its original neighbours.
 */
export function computeMapOrder(objectives: MapObjective[], connections: MapConnection[]): Map<string, number> {
  const levels = Array.from(new Set(objectives.map((o) => o.level))).sort((a, b) => a - b);

  const verticalByTarget = new Map<string, string[]>();
  const verticalEdges: { from: string; to: string }[] = [];
  for (const c of connections) {
    if (c.type !== "vertical") continue;
    verticalEdges.push({ from: c.from, to: c.to });
    const list = verticalByTarget.get(c.to) ?? [];
    list.push(c.from);
    verticalByTarget.set(c.to, list);
  }

  const order = new Map<string, number>();
  let previousRowOrder: string[] | null = null;

  for (const level of levels) {
    const idsAtLevel = objectives.filter((o) => o.level === level).map((o) => o.id);

    let rowOrder: string[];
    if (previousRowOrder === null) {
      rowOrder = idsAtLevel;
    } else {
      rowOrder = idsAtLevel
        .map((id, i) => {
          const sources = verticalByTarget.get(id) ?? [];
          const positions = sources.map((s) => order.get(s)).filter((p): p is number => p !== undefined);
          const barycenter = positions.length > 0 ? positions.reduce((a, b) => a + b, 0) / positions.length : i;
          return { id, key: barycenter };
        })
        .sort((a, b) => a.key - b.key)
        .map((x) => x.id);
      rowOrder = transposeRefine(rowOrder, previousRowOrder, verticalEdges);
    }

    rowOrder.forEach((id, i) => order.set(id, i));
    previousRowOrder = rowOrder;
  }

  return order;
}

/**
 * Post-layout cleanup: drops any lateral edge whose endpoints didn't end up
 * immediately adjacent (§9 — a lateral edge may only connect neighbours;
 * re-running causal reasoning for just that edge is out of scope for a
 * first version, so it's simply excluded rather than re-prompted). Throws
 * if a vertical-edge crossing survives the transpose pass — this should be
 * rare for typical BSC row sizes; the caller is expected to surface this as
 * a "please regenerate" error, same as every other AI-output validation
 * failure in this codebase.
 */
export function resolveConnections(
  connections: MapConnection[],
  order: Map<string, number>,
  levelById: Map<string, number>,
): MapConnection[] {
  const resolved = connections.filter((c) => {
    if (c.type !== "lateral") return true;
    const oa = order.get(c.from);
    const ob = order.get(c.to);
    return oa !== undefined && ob !== undefined && Math.abs(oa - ob) === 1;
  });

  const levels = Array.from(new Set(levelById.values())).sort((a, b) => a - b);
  for (let i = 0; i < levels.length - 1; i++) {
    const lower = levels[i];
    const upper = levels[i + 1];
    const edgesHere = resolved.filter(
      (c) => c.type === "vertical" && levelById.get(c.from) === lower && levelById.get(c.to) === upper,
    );
    for (let a = 0; a < edgesHere.length; a++) {
      for (let b = a + 1; b < edgesHere.length; b++) {
        const e1 = edgesHere[a];
        const e2 = edgesHere[b];
        if (edgesCross(order.get(e1.from)!, order.get(e1.to)!, order.get(e2.from)!, order.get(e2.to)!)) {
          throw new Error(
            "Strategy map layout couldn't resolve a line crossing between two objectives — please try regenerating.",
          );
        }
      }
    }
  }

  return resolved;
}

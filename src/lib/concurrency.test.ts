import { describe, it, expect } from "vitest";
import { mapWithConcurrency } from "./concurrency";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("mapWithConcurrency", () => {
  it("processes every item and returns an empty array for empty input", async () => {
    expect(await mapWithConcurrency([], 5, async (n: number) => n * 2)).toEqual([]);
  });

  it("returns results in the original input order, not completion order", async () => {
    const gates = [deferred<void>(), deferred<void>(), deferred<void>()];
    const promise = mapWithConcurrency([0, 1, 2], 3, async (item, index) => {
      await gates[index].promise;
      return item;
    });

    // Resolve out of order: slowest-declared item finishes first.
    gates[2].resolve();
    gates[0].resolve();
    gates[1].resolve();

    expect(await promise).toEqual([0, 1, 2]);
  });

  it("never runs more than `concurrency` items at once", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    await mapWithConcurrency(Array.from({ length: 10 }, (_, i) => i), 3, async (item) => {
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 1));
      inFlight--;
      return item;
    });

    expect(maxInFlight).toBeLessThanOrEqual(3);
  });

  it("processes every item exactly once when concurrency exceeds item count", async () => {
    const seen: number[] = [];
    const result = await mapWithConcurrency([1, 2], 10, async (item) => {
      seen.push(item);
      return item * 10;
    });
    expect(seen.sort()).toEqual([1, 2]);
    expect(result).toEqual([10, 20]);
  });

  it("propagates an error from fn instead of silently skipping that item", async () => {
    await expect(
      mapWithConcurrency([1, 2, 3], 2, async (item) => {
        if (item === 2) throw new Error("boom");
        return item;
      }),
    ).rejects.toThrow("boom");
  });
});

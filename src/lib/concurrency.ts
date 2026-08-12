/**
 * Runs `fn` over `items` with at most `concurrency` in flight at once,
 * returning results in the original input order regardless of completion
 * order. Used by the cron routes (src/app/api/cron/*) so a growing tenant
 * count doesn't mean fully serial processing — see the current-state
 * assessment's cron-scaling finding.
 *
 * A worker-pool, not chunked batches: each of `concurrency` workers pulls
 * the next unclaimed item as soon as it finishes its current one, so a few
 * slow items don't stall a whole batch behind them.
 *
 * An error thrown by `fn` rejects the whole call (standard Promise.all
 * semantics) — it does NOT skip that item and keep going. Callers that want
 * one item's failure to not affect the others (every current cron route
 * does, to keep processing every tenant even if one throws) need to catch
 * inside `fn` and return an error-shaped result instead of throwing.
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker() {
    while (nextIndex < items.length) {
      const current = nextIndex++;
      results[current] = await fn(items[current], current);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}

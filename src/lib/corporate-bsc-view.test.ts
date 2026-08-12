import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression coverage for the tenant-isolation fix in corporate-bsc-view.ts:
 * getCorporateBscView() now asserts tenantId itself instead of trusting the
 * caller to have pre-filtered via RLS (see SECURITY_ARCHITECTURE_ASSESSMENT.md).
 * This fakes the admin (RLS-bypassing) Supabase client to prove the function
 * won't return another tenant's scorecard even when the plan_id matches.
 */

type Row = Record<string, unknown>;

const { tables, setTables } = vi.hoisted(() => {
  let current: Record<string, Row[]> = {};
  return {
    tables: () => current,
    setTables: (next: Record<string, Row[]>) => {
      current = next;
    },
  };
});

class FakeQueryBuilder implements PromiseLike<{ data: unknown; error: null }> {
  private rows: Row[];
  private filters: Array<(row: Row) => boolean> = [];
  private orderKey: string | null = null;
  private orderAsc = true;
  private limitCount: number | null = null;

  constructor(table: string) {
    this.rows = tables()[table] ?? [];
  }
  select() {
    return this;
  }
  eq(key: string, value: unknown) {
    this.filters.push((row) => row[key] === value);
    return this;
  }
  in(key: string, values: unknown[]) {
    this.filters.push((row) => values.includes(row[key]));
    return this;
  }
  order(key: string, opts?: { ascending?: boolean }) {
    this.orderKey = key;
    this.orderAsc = opts?.ascending ?? true;
    return this;
  }
  limit(n: number) {
    this.limitCount = n;
    return this;
  }
  private run(): Row[] {
    let result = this.rows.filter((row) => this.filters.every((f) => f(row)));
    if (this.orderKey) {
      const key = this.orderKey;
      const dir = this.orderAsc ? 1 : -1;
      result = [...result].sort((a, b) => ((a[key] as number) > (b[key] as number) ? dir : -dir));
    }
    if (this.limitCount !== null) result = result.slice(0, this.limitCount);
    return result;
  }
  maybeSingle() {
    const result = this.run();
    return Promise.resolve({ data: result[0] ?? null, error: null });
  }
  then<TResult1 = { data: unknown; error: null }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: null }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): PromiseLike<TResult1 | TResult2> {
    return Promise.resolve({ data: this.run(), error: null }).then(onfulfilled, onrejected);
  }
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => new FakeQueryBuilder(table),
  }),
}));

const { getCorporateBscView } = await import("./corporate-bsc-view");

describe("getCorporateBscView tenant isolation", () => {
  beforeEach(() => {
    setTables({
      scorecards: [
        { id: "sc-1", name: "Corp Scorecard", plan_id: "plan-1", tenant_id: "tenant-a", scorecard_type: "corporate", created_at: "2026-01-01" },
      ],
      scorecard_rows: [
        {
          id: "row-1",
          perspective: "Financial",
          strategic_objective: "Grow revenue",
          intended_result: null,
          key_initiatives: null,
          kpi: "Revenue",
          unit: "USD",
          baseline: "0",
          target: "100",
          measurement_frequency: "Monthly",
          responsible_person: null,
          sort_order: 1,
          scorecard_id: "sc-1",
        },
      ],
      users: [],
    });
  });

  it("returns the scorecard when planId and tenantId both match", async () => {
    const view = await getCorporateBscView("plan-1", "tenant-a");
    expect(view).not.toBeNull();
    expect(view?.scorecardName).toBe("Corp Scorecard");
    expect(view?.perspectiveGroups[0]?.rows[0]?.kpi).toBe("Revenue");
  });

  it("returns null when the plan_id matches but the tenantId does not (cross-tenant access attempt)", async () => {
    const view = await getCorporateBscView("plan-1", "tenant-b");
    expect(view).toBeNull();
  });

  it("returns null when no corporate scorecard exists for the plan at all", async () => {
    const view = await getCorporateBscView("plan-does-not-exist", "tenant-a");
    expect(view).toBeNull();
  });
});

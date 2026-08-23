import { describe, it, expect, beforeEach, vi } from "vitest";

const { state } = vi.hoisted(() => ({
  state: {
    tenant: { license_status: "active", max_users: 10, is_unlimited_users: false } as Record<string, unknown>,
    userCount: 0,
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "tenants") {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: state.tenant, error: null }),
            }),
          }),
        };
      }
      // users table — count-only query
      return {
        select: () => ({
          eq: async () => ({ count: state.userCount, error: null }),
        }),
      };
    },
  }),
}));

const { getEntitlement, canReduceSeatsTo, LICENSE_TIER_DEFAULT_SEATS } = await import("./licensing");

describe("getEntitlement", () => {
  beforeEach(() => {
    state.tenant = { license_status: "active", max_users: 10, is_unlimited_users: false };
    state.userCount = 0;
  });

  it("computes remaining seats for a capped tenant", async () => {
    state.userCount = 7;
    const entitlement = await getEntitlement("tenant-1");
    expect(entitlement).toEqual({
      tenantId: "tenant-1",
      licenseStatus: "active",
      maxUsers: 10,
      isUnlimitedUsers: false,
      currentUserCount: 7,
      remainingSeats: 3,
    });
  });

  it("never reports negative remaining seats even if somehow over capacity", async () => {
    state.userCount = 15;
    const entitlement = await getEntitlement("tenant-1");
    expect(entitlement.remainingSeats).toBe(0);
  });

  it("reports null remainingSeats for an unlimited tenant regardless of usage", async () => {
    state.tenant = { license_status: "active", max_users: null, is_unlimited_users: true };
    state.userCount = 1245;
    const entitlement = await getEntitlement("tenant-1");
    expect(entitlement.remainingSeats).toBeNull();
    expect(entitlement.isUnlimitedUsers).toBe(true);
  });
});

describe("canReduceSeatsTo", () => {
  beforeEach(() => {
    state.tenant = { license_status: "active", max_users: 100, is_unlimited_users: false };
    state.userCount = 0;
  });

  it("allows reducing to a limit at or above current usage", async () => {
    state.userCount = 50;
    await expect(canReduceSeatsTo("tenant-1", 50)).resolves.toEqual({ allowed: true });
    await expect(canReduceSeatsTo("tenant-1", 75)).resolves.toEqual({ allowed: true });
  });

  it("rejects reducing below current usage, with the exact wording pattern", async () => {
    state.userCount = 100;
    const result = await canReduceSeatsTo("tenant-1", 50);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.reason).toContain("currently has 100 users");
      expect(result.reason).toContain("selected limit supports 50");
    }
  });
});

describe("LICENSE_TIER_DEFAULT_SEATS", () => {
  it("gives enterprise unlimited users via a real boolean, not a sentinel number", () => {
    expect(LICENSE_TIER_DEFAULT_SEATS.enterprise).toEqual({ maxUsers: null, isUnlimitedUsers: true });
  });

  it("gives basic and professional finite, distinct seat counts", () => {
    expect(LICENSE_TIER_DEFAULT_SEATS.basic.isUnlimitedUsers).toBe(false);
    expect(LICENSE_TIER_DEFAULT_SEATS.professional.isUnlimitedUsers).toBe(false);
    expect(LICENSE_TIER_DEFAULT_SEATS.basic.maxUsers).toBeLessThan(LICENSE_TIER_DEFAULT_SEATS.professional.maxUsers!);
  });
});

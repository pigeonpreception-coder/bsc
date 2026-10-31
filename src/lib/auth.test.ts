import { describe, it, expect } from "vitest";
import { isBlockedUserStatus, isTenantAccessBlocked } from "./auth";

describe("isBlockedUserStatus", () => {
  it("blocks a suspended user", () => {
    expect(isBlockedUserStatus("suspended")).toBe(true);
  });

  it("blocks a deactivated user", () => {
    expect(isBlockedUserStatus("deactivated")).toBe(true);
  });

  it("allows an active user", () => {
    expect(isBlockedUserStatus("active")).toBe(false);
  });
});

describe("isTenantAccessBlocked", () => {
  it("blocks a suspended tenant", () => {
    expect(isTenantAccessBlocked({ license_status: "suspended" })).toBe(true);
  });

  it("blocks an expired tenant", () => {
    expect(isTenantAccessBlocked({ license_status: "expired" })).toBe(true);
  });

  it("blocks when the tenant row can't be read at all (RLS hides it)", () => {
    expect(isTenantAccessBlocked(null)).toBe(true);
  });

  it("allows an active tenant", () => {
    expect(isTenantAccessBlocked({ license_status: "active" })).toBe(false);
  });
});

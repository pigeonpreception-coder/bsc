import { describe, it, expect } from "vitest";
import { isPathOwnedByTenant } from "./document-extract";

describe("isPathOwnedByTenant", () => {
  it("accepts a path under the tenant's own folder", () => {
    expect(isPathOwnedByTenant("tenant-1/onboarding/1700000000-profile.pdf", "tenant-1")).toBe(true);
  });

  it("rejects a path under a different tenant's folder", () => {
    expect(isPathOwnedByTenant("tenant-2/onboarding/1700000000-profile.pdf", "tenant-1")).toBe(false);
  });

  it("rejects a prefix collision (tenant-1 vs tenant-10) — requires an exact segment match", () => {
    expect(isPathOwnedByTenant("tenant-10/onboarding/file.pdf", "tenant-1")).toBe(false);
  });

  it("rejects a bare path with no folder segment at all", () => {
    expect(isPathOwnedByTenant("tenant-1", "tenant-1")).toBe(false);
  });
});

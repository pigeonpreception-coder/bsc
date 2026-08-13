import { describe, it, expect } from "vitest";
import { isPathOwnedByTenant, isPrivateOrReservedIp } from "./document-extract";

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

describe("isPrivateOrReservedIp", () => {
  it("accepts a normal public IPv4 address", () => {
    expect(isPrivateOrReservedIp("93.184.216.34")).toBe(false);
  });

  it("rejects loopback", () => {
    expect(isPrivateOrReservedIp("127.0.0.1")).toBe(true);
  });

  it("rejects RFC1918 private ranges", () => {
    expect(isPrivateOrReservedIp("10.0.0.5")).toBe(true);
    expect(isPrivateOrReservedIp("172.16.5.5")).toBe(true);
    expect(isPrivateOrReservedIp("192.168.1.1")).toBe(true);
  });

  it("rejects link-local, including the cloud metadata address", () => {
    expect(isPrivateOrReservedIp("169.254.169.254")).toBe(true);
  });

  it("does not treat a public address in the 172.x range outside 172.16.0.0/12 as private", () => {
    expect(isPrivateOrReservedIp("172.32.0.1")).toBe(false);
  });

  it("rejects IPv6 loopback and unique-local", () => {
    expect(isPrivateOrReservedIp("::1")).toBe(true);
    expect(isPrivateOrReservedIp("fd00::1")).toBe(true);
  });

  it("fails closed on an unparseable address", () => {
    expect(isPrivateOrReservedIp("not-an-ip")).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import { isBlockedUserStatus } from "./auth";

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

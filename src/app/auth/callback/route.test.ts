import { describe, it, expect } from "vitest";
import { isSafeRedirectPath } from "./route";

describe("isSafeRedirectPath", () => {
  it("accepts a normal relative path", () => {
    expect(isSafeRedirectPath("/auth/reset-password")).toBe(true);
  });

  it("accepts the bare root path", () => {
    expect(isSafeRedirectPath("/")).toBe(true);
  });

  it("rejects a protocol-relative URL (//evil.com)", () => {
    expect(isSafeRedirectPath("//evil.com/phish")).toBe(false);
  });

  it("rejects a backslash-prefixed path (/\\evil.com), a browser-parsing bypass for the // check", () => {
    expect(isSafeRedirectPath("/\\evil.com")).toBe(false);
  });

  it("rejects a userinfo-splice payload with no leading slash at all (@evil.com/phish)", () => {
    expect(isSafeRedirectPath("@evil.com/phish")).toBe(false);
  });

  it("rejects an absolute URL with a scheme", () => {
    expect(isSafeRedirectPath("https://evil.com")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isSafeRedirectPath("")).toBe(false);
  });
});

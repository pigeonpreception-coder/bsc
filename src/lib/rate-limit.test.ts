import { describe, it, expect } from "vitest";
import { evaluateRateLimit, MAX_ATTEMPTS_PER_EMAIL, MAX_ATTEMPTS_PER_IP } from "./rate-limit";

describe("evaluateRateLimit", () => {
  it("allows a fresh email/IP with no prior attempts", () => {
    expect(evaluateRateLimit(0, 0)).toEqual({ allowed: true });
  });

  it("allows attempts right up to the email threshold", () => {
    expect(evaluateRateLimit(MAX_ATTEMPTS_PER_EMAIL - 1, 0)).toEqual({ allowed: true });
  });

  it("blocks once the email threshold is reached", () => {
    const result = evaluateRateLimit(MAX_ATTEMPTS_PER_EMAIL, 0);
    expect(result.allowed).toBe(false);
  });

  it("blocks once the IP threshold is reached, even with a fresh email", () => {
    const result = evaluateRateLimit(0, MAX_ATTEMPTS_PER_IP);
    expect(result.allowed).toBe(false);
  });

  it("checks the email threshold before the IP threshold", () => {
    const result = evaluateRateLimit(MAX_ATTEMPTS_PER_EMAIL, MAX_ATTEMPTS_PER_IP);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.reason).toMatch(/this account/i);
  });

  it("skips the IP check entirely when no IP was resolvable (null, not 0)", () => {
    // A huge email count still blocks; but with ipAttempts passed as null,
    // there's no possible IP-based reason string in the result.
    const result = evaluateRateLimit(0, null);
    expect(result).toEqual({ allowed: true });
  });
});

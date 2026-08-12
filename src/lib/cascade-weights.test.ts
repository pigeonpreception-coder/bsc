import { describe, it, expect } from "vitest";
import { parseOwnWeightPercent } from "./cascade-weights";

describe("parseOwnWeightPercent", () => {
  it("accepts the boundary values 0 and 100", () => {
    expect(parseOwnWeightPercent("0")).toBe(0);
    expect(parseOwnWeightPercent("100")).toBe(100);
  });

  it("accepts a typical value and rounds fractional input", () => {
    expect(parseOwnWeightPercent("40")).toBe(40);
    expect(parseOwnWeightPercent("40.6")).toBe(41);
  });

  it("rejects a negative value", () => {
    expect(() => parseOwnWeightPercent("-1")).toThrow(/between 0 and 100/);
  });

  it("rejects a value over 100", () => {
    expect(() => parseOwnWeightPercent("101")).toThrow(/between 0 and 100/);
  });

  it("rejects non-numeric input", () => {
    expect(() => parseOwnWeightPercent("abc")).toThrow(/between 0 and 100/);
  });

  it("rejects a missing field", () => {
    expect(() => parseOwnWeightPercent(null)).toThrow(/between 0 and 100/);
  });
});

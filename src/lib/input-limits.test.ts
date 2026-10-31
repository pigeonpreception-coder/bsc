import { describe, it, expect } from "vitest";
import { assertMaxLength, TEXT_LIMITS } from "./input-limits";

describe("assertMaxLength", () => {
  it("accepts a value at exactly the limit", () => {
    expect(() => assertMaxLength("a".repeat(TEXT_LIMITS.title), TEXT_LIMITS.title, "Title")).not.toThrow();
  });

  it("rejects a value one character over, naming the field and the limit", () => {
    expect(() => assertMaxLength("a".repeat(TEXT_LIMITS.title + 1), TEXT_LIMITS.title, "Title")).toThrow(
      `Title is too long (maximum ${TEXT_LIMITS.title} characters).`,
    );
  });
});

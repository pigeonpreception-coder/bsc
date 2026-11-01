import { describe, it, expect } from "vitest";
import { sectionAnchor } from "./plan-document-html";

describe("sectionAnchor", () => {
  it("turns a normal section number into a simple id", () => {
    expect(sectionAnchor("2.3.3")).toBe("sec-2-3-3");
  });

  it("strips anything that could break out of an HTML attribute", () => {
    const anchor = sectionAnchor('9" onload="alert(1)"><img src=x>');
    expect(anchor).toMatch(/^sec-[0-9A-Za-z-]+$/);
    expect(anchor).not.toMatch(/["'<>= ]/);
  });
});

import { describe, it, expect } from "vitest";
import { escapeHtml } from "./plan-document-html";

describe("escapeHtml", () => {
  it("leaves plain text untouched", () => {
    expect(escapeHtml("Grow revenue by 15%")).toBe("Grow revenue by 15%");
  });

  it("escapes & first, so it doesn't double-escape entities produced by the < and > passes", () => {
    expect(escapeHtml("Marketing & Sales < Ops > Finance")).toBe("Marketing &amp; Sales &lt; Ops &gt; Finance");
  });

  it("neutralizes a script-tag injection attempt", () => {
    expect(escapeHtml('<script>alert("x")</script>')).toBe("&lt;script&gt;alert(\"x\")&lt;/script&gt;");
  });

  it("neutralizes an attribute-breakout attempt", () => {
    expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe('"&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it("treats a literal & as a raw character, not an existing entity — always escapes it, even inside what looks like one", () => {
    expect(escapeHtml("Q1 &amp; Q2")).toBe("Q1 &amp;amp; Q2");
  });
});

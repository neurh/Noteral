import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { renderInline } from "./markdownView";

describe("renderInline", () => {
  it("terminates on every prefix of nested emphasis (streaming replies)", () => {
    const src = "This page plans the **spring launch**: *a* review, `code` and [link](https://example.com).";
    for (let i = 1; i <= src.length; i++) {
      const out = renderInline(src.slice(0, i), { keyPrefix: "t" });
      expect(out.length).toBeLessThan(40);
    }
  });

  it("keeps nested markup", () => {
    const out = renderInline("**bold `code`** then _em_", { keyPrefix: "t" });
    const strong = out.find((node) => isValidElement(node) && node.type === "strong");
    expect(strong).toBeTruthy();
    expect(out.some((node) => isValidElement(node) && node.type === "em")).toBe(true);
  });
});

// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { renderTemplate, sanitizeCss, sanitizeHtml, TemplateError } from "./cellTemplate";

describe("renderTemplate", () => {
  it("prints escaped values and nested paths", () => {
    expect(renderTemplate("{{value}} / {{config.max}}", { value: "<b>", config: { max: 5 } })).toBe("&lt;b&gt; / 5");
    expect(renderTemplate("{{missing.deep}}|", {})).toBe("|");
  });

  it("supports if / else / unless with comparisons", () => {
    const t = "{{#if value >= 3}}high{{else}}low{{/if}}{{#unless empty}}!{{/unless}}";
    expect(renderTemplate(t, { value: 4, empty: false })).toBe("high!");
    expect(renderTemplate(t, { value: 1, empty: true })).toBe("low");
    expect(renderTemplate("{{#if a and !b}}y{{/if}}", { a: true, b: false })).toBe("y");
  });

  it("repeats with @number and compares to outer data", () => {
    const t = `{{#repeat config.max}}<i class="{{#if @number <= value}}on{{/if}}"></i>{{/repeat}}`;
    expect(renderTemplate(t, { value: 2, config: { max: 3 } })).toBe(`<i class="on"></i><i class="on"></i><i class=""></i>`);
  });

  it("iterates arrays with locals and else", () => {
    expect(renderTemplate("{{#each value}}{{@index}}:{{this}}{{#unless @last}},{{/unless}}{{/each}}", { value: ["a", "b"] })).toBe("0:a,1:b");
    expect(renderTemplate("{{#each value}}x{{else}}none{{/each}}", { value: [] })).toBe("none");
  });

  it("applies filters", () => {
    expect(renderTemplate("{{value | percent}}", { value: 0.425 })).toMatch(/^4[23]%$/);
    expect(renderTemplate("{{value | fixed:1}}", { value: 3.14159 })).toBe("3.1");
    expect(renderTemplate(`{{value | default:"—"}}`, { value: "" })).toBe("—");
    expect(renderTemplate("{{value | upper}}", { value: "ab" })).toBe("AB");
    expect(renderTemplate(`{{value | join:", "}}`, { value: [1, 2] })).toBe("1, 2");
  });

  it("rejects unbalanced blocks", () => {
    expect(() => renderTemplate("{{#if a}}x", {})).toThrow(TemplateError);
  });
});

describe("sanitizeHtml", () => {
  it("drops scripts, handlers and unsafe urls", () => {
    const out = sanitizeHtml(`<span onclick="x()">a</span><script>bad()</script><a href="javascript:x">l</a><img src="https://e.com/t.png">`);
    expect(out).not.toMatch(/onclick|script|javascript|e\.com/);
    expect(out).toContain("<span>a</span>");
  });

  it("keeps data attributes and safe links", () => {
    const out = sanitizeHtml(`<button data-value="3" data-toggle>★</button><a href="https://example.com">x</a>`);
    expect(out).toContain(`data-value="3"`);
    expect(out).toContain(`href="https://example.com"`);
    expect(out).toContain(`rel="noreferrer"`);
  });
});

describe("sanitizeCss", () => {
  it("removes imports and remote urls", () => {
    const out = sanitizeCss(`@import url(https://x.com/a.css); .a{background:url(https://x.com/i.png);color:red}`);
    expect(out).not.toContain("x.com");
    expect(out).toContain("color:red");
  });
});

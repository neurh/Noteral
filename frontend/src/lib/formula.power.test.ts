import { describe, it, expect } from "vitest";
import {
  StyledText,
  checkFormula,
  completionsAt,
  evaluateFormula,
  formatFormulaValue,
  formulaPosition,
  formulaSpans,
  isDateRange,
  matchingBracket,
  signatureAt,
  type FormulaValue,
} from "./formula";

const NOW = new Date(2024, 2, 15, 10, 30, 0); // Fri Mar 15 2024, 10:30 local
const ctx = (props: Record<string, FormulaValue> = {}) => ({
  now: NOW,
  prop(name: string): FormulaValue {
    if (!(name in props)) throw new Error(`No property named "${name}"`);
    return props[name];
  },
});
function run(src: string, props?: Record<string, FormulaValue>): FormulaValue {
  const r = evaluateFormula(src, ctx(props));
  if (r.error) throw new Error(`${src}: ${r.error}`);
  return r.value;
}
const err = (src: string, props?: Record<string, FormulaValue>) => evaluateFormula(src, ctx(props));
const d = (y: number, m: number, day: number) => new Date(y, m - 1, day);

describe("styled text", () => {
  it("styles text and keeps it text everywhere else", () => {
    const v = run('style("Late", "b", "red")');
    expect(v).toBeInstanceOf(StyledText);
    expect(formulaSpans(v)).toEqual([{ text: "Late", bold: true, color: "red" }]);
    expect(formatFormulaValue(v)).toBe("Late");
    expect(run('style("Late", "b") == "Late"')).toBe(true);
    expect(run('length(style("Late", "i"))')).toBe(4);
    expect(run('upper(style("x", "b"))')).toBe("X");
    expect(run('style("a", "b").contains("a")')).toBe(true);
  });
  it("concatenates styled pieces with +, concat and join", () => {
    const v = run('style("Due ", "b") + "soon" + 1');
    expect(formulaSpans(v)).toEqual([{ text: "Due ", bold: true }, { text: "soon1" }]);
    expect(formulaSpans(run('concat(style("a", "u"), "b")'))).toEqual([{ text: "a", underline: true }, { text: "b" }]);
    expect(formulaSpans(run('join([style("a", "c"), "b"], " · ")'))).toEqual([{ text: "a", code: true }, { text: " · b" }]);
  });
  it("supports backgrounds, nesting, lists of styles and unstyle", () => {
    expect(formulaSpans(run('style(style("x", "b"), "blue_background", "i")'))).toEqual([
      { text: "x", bold: true, background: "blue", italic: true },
    ]);
    expect(formulaSpans(run('style("x", ["s", "gray"])'))).toEqual([{ text: "x", strike: true, color: "gray" }]);
    expect(run('unstyle(style("x", "b"))')).toBe("x");
    expect(formulaSpans(run('unstyle(style("x", "b", "red"), "b")'))).toEqual([{ text: "x", color: "red" }]);
  });
  it("explains unknown styles", () => {
    expect(err('style("x", "bolt")').error).toBe('style(): unknown style "bolt". Did you mean "bold"? Use b, i, u, s, c, a color like "red" or "red_background"');
  });
  it("renders lists with styled items", () => {
    expect(formulaSpans(run('[style("a", "b"), 2]'))).toEqual([{ text: "a", bold: true }, { text: ", 2" }]);
    expect(formulaSpans(run("[1, 2]"))).toBeNull();
    expect(formulaSpans("plain")).toBeNull();
  });
  it("makes safe links", () => {
    expect(formulaSpans(run('link("Docs", "example.com/docs")'))).toEqual([{ text: "Docs", href: "https://example.com/docs" }]);
    expect(formulaSpans(run('link("mailto:a@b.co")'))).toEqual([{ text: "mailto:a@b.co", href: "mailto:a@b.co" }]);
    expect(err('link("x", "javascript:alert(1)")').error).toMatch(/isn't a web, email or phone link/);
    expect(run('link("x", "")')).toBe("x");
  });
});

describe("new functions", () => {
  it("does number helpers", () => {
    expect(run("clamp(12, 0, 10)")).toBe(10);
    expect(run("clamp(-1, 0, 10)")).toBe(0);
    expect(run("between(5, 1, 10)")).toBe(true);
    expect(run("percent(1, 3, 1)")).toBe(33.3);
    expect(run("percent(1, 0)")).toBeNull();
    expect(run("product(2, [3, 4])")).toBe(24);
    expect(run("avg([2, 4])")).toBe(3);
    expect(run("toFixed(2.5, 0)")).toBe("3");
    expect(run("toFixed(1)")).toBe("1.00");
    expect(run('formatNumber(1234.5, "dollar")')).toBe("$1,234.50");
    expect(run('formatNumber(0.256, "percent", 1)')).toBe("25.6%");
    expect(run("formatNumber(1234567)")).toBe("1,234,567");
    expect(err('formatNumber(1, "yuan")').error).toMatch(/unknown format "yuan"/);
  });
  it("does text helpers", () => {
    expect(run('left("abc", 2)')).toBe("ab");
    expect(run('right("abc", 0)')).toBe("");
    expect(run('wordCount("  ")')).toBe(0);
    expect(run('slugify("  Ça va? Oui!  ")')).toBe("ca-va-oui");
    expect(run('titleCase("hello WORLD-wide")')).toBe("Hello World-Wide");
    expect(run('truncate("short", 10)')).toBe("short");
    expect(run('truncate("abcdef", 4, "...")')).toBe("a...");
    expect(run('pluralize(1, "task")')).toBe("1 task");
    expect(run('pluralize(2, "person", "people")')).toBe("2 people");
  });
  it("does logic helpers", () => {
    expect(run('switch(3, 1, "a", 2, "b")')).toBeNull();
    expect(run('switch({S}, "Done", "✓", "…")', { S: "Done" })).toBe("✓");
    expect(run('ifError(1 / "x", "bad")')).toBe("bad");
    expect(run("ifError(1, 2)")).toBe(1);
  });
  it("does date helpers", () => {
    expect(run('isWeekend(parseDate("2024-03-10"))')).toBe(true);
    expect(run("isWeekend(now())")).toBe(false);
    expect(run('workdaysBetween(parseDate("2024-03-04"), parseDate("2024-03-17"))')).toBe(10);
    expect(run('workdaysBetween(parseDate("2024-03-08"), parseDate("2024-03-01"))')).toBe(-6);
    expect(run('addWorkdays(parseDate("2024-03-08"), 6)')).toEqual(d(2024, 3, 18));
    expect(run('addWorkdays(parseDate("2024-03-11"), -1)')).toEqual(d(2024, 3, 8));
    expect(run('startOf(now(), "week")')).toEqual(d(2024, 3, 11));
    expect(run('startOf(now(), "quarter")')).toEqual(d(2024, 1, 1));
    expect(run('endOf(now(), "year")')).toEqual(d(2024, 12, 31));
    expect(run("quarter(now())")).toBe(1);
    expect(run("fromNow(dateAdd(today(), 3))")).toBe("in 3 days");
    expect(run("fromNow(dateSubtract(today(), 14))")).toBe("2 weeks ago");
    expect(run('fromNow(dateAdd(now(), 90, "minutes"))')).toBe("in 1 hour");
    expect(run("fromNow(today())")).toBe("today");
    expect(run("fromNow(dateAdd(today(), 400))")).toBe("in 1 year");
    expect(run('formatDate(now(), "Do [of] MMMM, [Q]Q, [W]W")')).toBe("15th of March, Q1, W11");
    expect(run('formatDate(dateAdd(today(), 1), "relative")')).toBe("Tomorrow");
    expect(run('formatDate(today(), "iso")')).toBe("2024-03-15");
  });
  it("builds date ranges", () => {
    const v = run("dateRange(dateAdd(today(), 2), today())");
    expect(isDateRange(v)).toBe(true);
    expect(v).toEqual([d(2024, 3, 15), d(2024, 3, 17)]);
    expect(run("start(dateRange(today(), dateAdd(today(), 2)))")).toEqual(d(2024, 3, 15));
    expect(run("dateEnd(dateRange(today(), dateAdd(today(), 2)))")).toEqual(d(2024, 3, 17));
    expect(isDateRange(run("[today(), today()]"))).toBe(false);
  });
  it("does list helpers", () => {
    expect(run('zip([1, 2, 3], ["a", "b"])')).toEqual([[1, "a"], [2, "b"]]);
    expect(run("chunk([1, 2, 3], 2)")).toEqual([[1, 2], [3]]);
    expect(err("chunk([1], 0)").error).toBe("chunk() size must be at least 1");
    expect(run('compact([0, "", empty(), false])')).toEqual([0, false]);
    expect(run("reduce([1, 2, 3], acc + current * index, 0)")).toBe(8);
    expect(run("[1, 2, 3].reduce(max(acc, current))")).toBe(3);
    expect(evaluateFormula("acc + 1", ctx()).error).toMatch(/"acc" only works inside reduce/);
  });
});

describe("errors with positions", () => {
  it("points at the expression that failed at runtime", () => {
    const src = 'let(x, 1,\n  x + sqrt("a"))';
    const r = err(src);
    expect(r.error).toBe("sqrt() needs a number, got text");
    expect(src.slice(r.span!.start, r.span!.end)).toBe('sqrt("a")');
    expect(formulaPosition(src, r.span!.start)).toEqual({ line: 2, column: 7 });
  });
  it("points at missing properties", () => {
    const src = "1 + {Pricee}";
    const r = err(src, { Price: 1 });
    expect(r.error).toBe('No property named "Pricee"');
    expect(src.slice(r.span!.start, r.span!.end)).toBe("{Pricee}");
  });
  it("checks property names against a schema", () => {
    expect(checkFormula("{Price} * 2", ["Name", "Price"])).toBeNull();
    expect(checkFormula('prop("Prise") * 2', ["Name", "Price"])).toEqual({
      message: 'No property named "Prise". Did you mean prop("Price")?',
      start: 0,
      end: 13,
    });
    expect(checkFormula("Price * 2", ["Name", "Price"])!.message).toBe('"Price" is a property — write {Price} or prop("Price")');
    expect(checkFormula("1 +", ["Name"])!.message).toBe('Missing a value after "+"');
  });
});

describe("editor helpers", () => {
  it("finds the call and argument under the caret", () => {
    const src = 'if({Done}, style("x", ';
    const s = signatureAt(src, src.length)!;
    expect(s.doc.name).toBe("style");
    expect(s.arg).toBe(1);
    expect(signatureAt("if(a, [1, 2", 11)!.doc.name).toBe("if");
    expect(signatureAt("{A}.dateAdd(", 12)!.arg).toBe(1);
    expect(signatureAt("1 + 2", 5)).toBeNull();
  });
  it("matches brackets outside strings", () => {
    expect(matchingBracket('max(1, ")", 2)', 4)).toEqual([3, 13]);
    expect(matchingBracket("[1, (2)]", 8)).toEqual([0, 7]);
    expect(matchingBracket("1 + 2", 2)).toBeNull();
  });
  it("offers {Name} when a property name is typed bare", () => {
    const c = completionsAt("Pri", 3, ["Price", "Name"]);
    expect(c.items.find((i) => i.kind === "property")).toMatchObject({ label: "Price", insert: "{Price}" });
  });
});

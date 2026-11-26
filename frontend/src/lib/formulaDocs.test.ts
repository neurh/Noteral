import { describe, expect, it } from "vitest";
import { FORMULA_FUNCTIONS, compileFormula, evaluateFormula } from "./formula";
import {
  FORMULA_DETAILS,
  FORMULA_EXAMPLE_NOW,
  FORMULA_EXAMPLE_PROPS,
  detailsOf,
  formulaExampleContext,
  showFormulaValue,
} from "./formulaDocs";

const NAMES = FORMULA_FUNCTIONS.map((f) => f.name);
/** Entries that aren't called like name(...): properties, list variables and operators. */
const NOT_CALLABLE = new Set(["prop", "{Name}", "current", "index", "+ - * / % ^", "== != > < >= <=", "and or not", "? :"]);
const isErrorExample = (note?: string) => !!note && /^shows an error/i.test(note);

const arityError = (src: string) => {
  const c = compileFormula(src);
  return !c.ok && / takes .* arguments?, got /.test(c.error.message) ? c.error.message : null;
};
const callWith = (name: string, n: number) => `${name}(${Array.from({ length: n }, () => "1").join(", ")})`;

describe("formula docs", () => {
  it("documents every FORMULA_FUNCTIONS entry, and nothing else", () => {
    expect(NAMES.filter((n) => !FORMULA_DETAILS[n])).toEqual([]);
    expect(Object.keys(FORMULA_DETAILS).filter((n) => !NAMES.includes(n))).toEqual([]);
  });

  it("looks details up case-insensitively", () => {
    expect(detailsOf("DATEADD")).toBe(FORMULA_DETAILS.dateAdd);
    expect(detailsOf(" toNumber ")).toBe(FORMULA_DETAILS.toNumber);
    expect(detailsOf("nope")).toBeUndefined();
  });

  it("only relates to documented entries, never to itself", () => {
    const bad: string[] = [];
    for (const [name, d] of Object.entries(FORMULA_DETAILS)) {
      for (const r of d.related ?? []) if (!NAMES.includes(r) || r === name) bad.push(`${name} → ${r}`);
    }
    expect(bad).toEqual([]);
  });

  it("has 2–4ish examples and well-formed params everywhere", () => {
    for (const [name, d] of Object.entries(FORMULA_DETAILS)) {
      expect(d.examples.length, name).toBeGreaterThanOrEqual(2);
      expect(d.examples.length, name).toBeLessThanOrEqual(5);
      expect(d.returns, name).toBeTruthy();
      for (const p of d.params) expect(p.name && p.type && p.description, `${name}.${p.name}`).toBeTruthy();
    }
  });

  it("matches each function's documented parameter count to its real arity", () => {
    const bad: string[] = [];
    for (const name of NAMES) {
      if (NOT_CALLABLE.has(name)) continue;
      const params = FORMULA_DETAILS[name].params;
      const min = params.filter((p) => !p.optional).length;
      const max = params.some((p) => p.repeat) ? Infinity : params.length;
      if (arityError(callWith(name, min))) bad.push(`${name}: ${min} args rejected`);
      const top = max === Infinity ? min + 9 : max;
      if (arityError(callWith(name, top))) bad.push(`${name}: ${top} args rejected`);
      // `not(x)` parses as the unary operator, so it is never arity-checked.
      if (name === "not") continue;
      if (min > 0 && !arityError(callWith(name, min - 1))) bad.push(`${name}: ${min - 1} args accepted`);
      if (max !== Infinity && !arityError(callWith(name, max + 1))) bad.push(`${name}: ${max + 1} args accepted`);
    }
    expect(bad).toEqual([]);
  });

  it("uses a sample row whose display strings are the shown values", () => {
    expect(FORMULA_EXAMPLE_PROPS.length).toBeGreaterThanOrEqual(6);
    expect(FORMULA_EXAMPLE_PROPS.length).toBeLessThanOrEqual(10);
    expect(new Date(FORMULA_EXAMPLE_NOW).getDay()).toBe(4);
    expect(Object.fromEntries(FORMULA_EXAMPLE_PROPS.map((p) => [p.name, p.display]))).toMatchObject({
      Price: "25",
      Tags: '["Design", "Web", "Urgent"]',
      "Due date": "2026-03-20",
      Notes: "empty",
    });
  });

  const ctx = formulaExampleContext();
  const cases = Object.entries(FORMULA_DETAILS).flatMap(([name, d]) => d.examples.map((e) => ({ name, ...e })));

  it.each(cases)("$name: $code", ({ code, result, note }) => {
    const r = evaluateFormula(code, ctx);
    if (isErrorExample(note)) {
      expect(r.error, "expected an error").toBeTruthy();
      expect(r.error).toBe(result);
    } else {
      expect(r.error).toBeUndefined();
      expect(showFormulaValue(r.value)).toBe(result);
    }
  });
});

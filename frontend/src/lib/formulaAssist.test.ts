import { describe, expect, it } from "vitest";
import type { PageMeta } from "./api";
import { defaultSchema, rowsOf, type DatabaseSchema } from "./database";
import {
  FORMULA_ASK_SYSTEM,
  checkProposal,
  formulaAskPrompt,
  formulaLanguageGuide,
  formulaRepairPrompt,
  parseFormulaReply,
  schemaGuide,
  type FormulaAskInput,
} from "./formulaAssist";

function meta(id: string, title: string, values: Record<string, unknown> = {}): PageMeta {
  return {
    id,
    title,
    parentId: "db",
    position: 1,
    icon: "",
    cover: "",
    kind: "page",
    data: JSON.stringify({ values }),
    createdAt: "2026-01-01T10:00:00Z",
    updatedAt: "2026-01-02T10:00:00Z",
  } as unknown as PageMeta;
}

function fixture() {
  const schema: DatabaseSchema = defaultSchema();
  schema.properties.push({ id: "prop_price", name: "Price", type: "number" });
  schema.properties.push({ id: "prop_fx", name: "Total", type: "formula", formula: "{Price} * 2" });
  const rows = rowsOf([meta("r1", "Lamp", { prop_price: 40 }), meta("r2", "Desk", { prop_price: 250 })], "db");
  const input: FormulaAskInput = { mode: "write", request: "price with 20% tax", source: "", schema, rows, propertyId: "prop_fx" };
  return { schema, rows, input };
}

describe("formula assist prompts", () => {
  it("teaches every function and the syntax", () => {
    const guide = formulaLanguageGuide();
    for (const name of ["style(", "link(", "dateBetween(", "reduce(", "formatNumber("]) expect(guide).toContain(name);
    expect(guide).toContain("{Name}");
    expect(FORMULA_ASK_SYSTEM).toContain("```formula");
  });

  it("lists properties with types and samples, without the edited formula", () => {
    const { schema, rows } = fixture();
    const guide = schemaGuide(schema, rows, "prop_fx");
    expect(guide).toContain("- Price — number; e.g. \"250\", \"40\"");
    expect(guide).toContain("Lamp");
    expect(guide).not.toContain("Total");
  });

  it("builds write, fix and explain prompts", () => {
    const { input } = fixture();
    expect(formulaAskPrompt(input)).toContain("Write a formula that: price with 20% tax");
    const change = formulaAskPrompt({ ...input, source: "{Price}" });
    expect(change).toContain("Current formula:");
    expect(change).toContain("Change the formula as asked");
    const fix = formulaAskPrompt({ ...input, mode: "fix", source: "{Price * 2", error: "Missing }" });
    expect(fix).toContain("It has this error: Missing }");
    expect(fix).toContain("Fix the formula");
    expect(formulaAskPrompt({ ...input, mode: "explain", source: "{Price} * 2" })).toContain("Explain what the current formula does");
    const repair = formulaRepairPrompt(input, "{Prise} * 1.2", 'No property named "Prise"');
    expect(repair).toContain("{Prise} * 1.2");
    expect(repair).toContain('It fails with: No property named "Prise"');
  });
});

describe("parseFormulaReply", () => {
  it("prefers the formula block and keeps the explanation", () => {
    const reply = parseFormulaReply("Here you go:\n```js\nnope\n```\n```formula\n{Price} * 1.2\n```\nAdds 20% tax.");
    expect(reply.formula).toBe("{Price} * 1.2");
    expect(reply.note).toContain("Adds 20% tax.");
    expect(reply.note).not.toContain("{Price} * 1.2");
  });

  it("falls back to any fence, keeps multi-line formulas, and survives a missing closing fence", () => {
    expect(parseFormulaReply("```\nlet(x, {Price},\n  x * 2)\n```").formula).toBe("let(x, {Price},\n  x * 2)");
    expect(parseFormulaReply("```formula\nround({Price})").formula).toBe("round({Price})");
  });

  it("accepts a bare one-line formula and rejects prose", () => {
    expect(parseFormulaReply("round({Price} * 1.2, 2)")).toEqual({ formula: "round({Price} * 1.2, 2)", note: "" });
    const prose = parseFormulaReply("It multiplies the price (in euros) by two.");
    expect(prose.formula).toBeUndefined();
    expect(prose.note).toBe("It multiplies the price (in euros) by two.");
  });
});

describe("checkProposal", () => {
  it("accepts valid formulas and flags unknown or self references", () => {
    const { schema } = fixture();
    expect(checkProposal("{Price} * 1.2", schema, "prop_fx")).toBeNull();
    expect(checkProposal('prop("Name") + "!"', schema, "prop_fx")).toBeNull();
    expect(checkProposal("{Prise} * 1.2", schema, "prop_fx")?.message).toMatch(/Price/);
    expect(checkProposal("{Total} + 1", schema, "prop_fx")).not.toBeNull();
    expect(checkProposal("round({Price}", schema, "prop_fx")).not.toBeNull();
  });
});

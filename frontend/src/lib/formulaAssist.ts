/**
 * "Ask AI" for the formula editor: builds a compact prompt that teaches the
 * model the formula language and the database's properties, and pulls the
 * formula back out of its reply. Pure (no model calls) so it is testable.
 */
import { TITLE_ID, propertyById, type DatabaseRow, type DatabaseSchema, type Property } from "./database";
import { formulaInput } from "./databaseFormulas";
import { FORMULA_FUNCTIONS, checkFormula, formatFormulaValue, type FormulaError } from "./formula";

export type FormulaAskMode = "write" | "fix" | "explain";

export interface FormulaAskInput {
  mode: FormulaAskMode;
  /** What the user wants (write) or extra context (fix / explain). */
  request: string;
  /** The formula in the editor now (may be empty). */
  source: string;
  error?: string;
  schema: DatabaseSchema;
  rows: DatabaseRow[];
  /** The formula property being edited (excluded from the property list). */
  propertyId: string;
}

const SAMPLE_ROWS = 3;

/** The language, one line per function: the model sees exactly what the engine supports. */
export function formulaLanguageGuide(): string {
  const lines = FORMULA_FUNCTIONS.map((fn) => `- ${fn.signature}: ${fn.description}${fn.example ? ` e.g. ${fn.example}${fn.result ? ` → ${fn.result}` : ""}` : ""}`);
  return [
    "Formula language (Noteral databases, similar to Notion formulas 2.0):",
    '- Refer to properties as {Name} or prop("Name"). Strings in "double" or \'single\' quotes. Lists: [1, 2, 3].',
    "- Operators: + - * / % ^, == != > < >= <=, and or not (also && || !), cond ? a : b. + joins text and lists.",
    "- Methods: x.fn(args) is fn(x, args), e.g. {Tags}.filter(current != \"Old\").length().",
    "- In map/filter/find/some/every/count/sort, `current` is the item and `index` its position; reduce(list, acc + current, 0) folds.",
    "- let(name, value, expr) and lets(a, 1, b, 2, expr) bind variables. Comments: // line and /* block */. Formulas may span lines.",
    "- Results: number, text (style() and link() make formatted text), checkbox, date (dateRange() for a range) or list.",
    "- Empty values: empty(), \"\" and [] are empty; math treats empty as 0.",
    "Functions:",
    ...lines,
  ].join("\n");
}

function describeProperty(property: Property): string {
  const type = property.type === "formula" ? `formula (${property.resultType ?? "text"})` : property.type;
  const options = property.options?.length ? `; options: ${property.options.slice(0, 12).map((o) => JSON.stringify(o.name)).join(", ")}` : "";
  return `${property.name} — ${type}${options}`;
}

/** Properties with types and a few sample values, as the model needs them. */
export function schemaGuide(schema: DatabaseSchema, rows: DatabaseRow[], propertyId: string): string {
  const props = [propertyById(schema, TITLE_ID)!, ...schema.properties].filter((p) => p && p.id !== propertyId);
  const lines = props.map((property) => {
    const samples = rows
      .slice(0, SAMPLE_ROWS)
      .map((row) => {
        try {
          return formatFormulaValue(formulaInput(row, property), { dateFormat: "iso" });
        } catch {
          return "";
        }
      })
      .filter((v) => v !== "")
      .map((v) => JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}…` : v));
    return `- ${describeProperty(property)}${samples.length ? `; e.g. ${samples.join(", ")}` : ""}`;
  });
  return ["Properties of this database:", ...lines].join("\n");
}

export const FORMULA_ASK_SYSTEM = `You write and explain formulas for database properties in the Noteral notes app.
Only use functions and syntax from the guide below; never invent functions. Refer to properties by their exact names.
When you write a formula, reply with exactly one fenced block tagged formula, then one short sentence saying what it does:
\`\`\`formula
<the formula>
\`\`\`
Prefer {Name} references, readable multi-line formulas with let() for anything long, and empty() instead of "" for no value.`;

/** The user message for a request. */
export function formulaAskPrompt(input: FormulaAskInput): string {
  const parts = [formulaLanguageGuide(), "", schemaGuide(input.schema, input.rows, input.propertyId), ""];
  const current = input.source.trim();
  if (current) parts.push("Current formula:", "```formula", current, "```", "");
  if (input.error) parts.push(`It has this error: ${input.error}`, "");
  if (input.mode === "explain") {
    parts.push(
      "Explain what the current formula does in plain words for a non-programmer: 2–4 short sentences or bullets, mentioning the properties it uses. Do not rewrite it unless it has a bug; if it does, point it out and give the fixed formula in a formula block.",
    );
    if (input.request.trim()) parts.push(`Question: ${input.request.trim()}`);
  } else if (input.mode === "fix") {
    parts.push("Fix the formula so it works and keeps its intent.");
    if (input.request.trim()) parts.push(`Also: ${input.request.trim()}`);
  } else {
    parts.push(current ? `Change the formula as asked (or write a new one if that's what is asked): ${input.request.trim()}` : `Write a formula that: ${input.request.trim()}`);
  }
  return parts.join("\n");
}

/** Follow-up when the model's formula didn't compile. */
export function formulaRepairPrompt(previous: FormulaAskInput, formula: string, error: string): string {
  return `${formulaAskPrompt(previous)}\n\nYour previous answer was:\n\`\`\`formula\n${formula}\n\`\`\`\nIt fails with: ${error}\nReply with the corrected formula in a formula block and one short sentence.`;
}

export interface FormulaReply {
  /** The proposed formula, if the reply contains one. */
  formula?: string;
  /** The reply without the formula block (the explanation). */
  note: string;
}

/** Extracts the formula block (```formula, or any fenced block) and the remaining text. */
export function parseFormulaReply(text: string): FormulaReply {
  const fences = [...text.matchAll(/```[ \t]*([\w-]*)[^\n]*\n([\s\S]*?)(?:```|$)/g)];
  const block = fences.find((m) => m[1].toLowerCase() === "formula") ?? fences[0];
  if (!block) {
    // A bare one-line answer that is itself a formula.
    const single = text.trim();
    if (single && !single.includes("\n") && /[({]/.test(single) && !/[.!?]$/.test(single) && checkFormula(single) === null)
      return { formula: single, note: "" };
    return { note: text.trim() };
  }
  const formula = block[2].replace(/\s+$/, "").replace(/^\n+/, "");
  const note = (text.slice(0, block.index) + text.slice(block.index! + block[0].length)).replace(/\n{3,}/g, "\n\n").trim();
  return { formula: formula || undefined, note };
}

/** A schema-aware check for a proposed formula (null when it compiles and refers only to real properties). */
export function checkProposal(formula: string, schema: DatabaseSchema, propertyId: string): FormulaError | null {
  const names = [propertyById(schema, TITLE_ID)!, ...schema.properties].filter((p) => p && p.id !== propertyId).map((p) => p.name);
  return checkFormula(formula, names);
}

/**
 * Formula properties: evaluates every "formula" property of a database for
 * each row and writes the results into the row values, so tables, filters,
 * sorts, groups, calculations and charts treat them like stored values.
 *
 * Results are never saved: row writes read the stored page data, not these
 * computed rows.
 */
import {
  TITLE_ID,
  cellValue,
  dateStart,
  optionById,
  propertyById,
  type DatabaseRow,
  type DatabaseSchema,
  type FormulaResultType,
  type Property,
} from "./database";
import { compileFormula, formatFormulaValue, typeOfValue, type FormulaValue } from "./formula";

export interface FormulaIssue {
  propertyId: string;
  message: string;
  start?: number;
  end?: number;
}

export interface FormulaResult {
  rows: DatabaseRow[];
  schema: DatabaseSchema;
  /** Compile errors and cycles, per formula property. */
  issues: FormulaIssue[];
  /** Runtime errors: row id → property id → message. */
  rowErrors: Map<string, Record<string, string>>;
}

/** Parses a stored date (YYYY-MM-DD or RFC 3339) as a local Date. */
function toDate(value: string): Date | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  const date = match ? new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** A stored cell as a formula value. */
export function formulaInput(row: DatabaseRow, property: Property): FormulaValue {
  const value = cellValue(row, property);
  switch (property.type) {
    case "number":
      return typeof value === "number" && Number.isFinite(value) ? value : null;
    case "checkbox":
      return !!value;
    case "select":
    case "status":
      return optionById(property, value)?.name ?? null;
    case "multiSelect":
      return (Array.isArray(value) ? value : []).map((id) => optionById(property, id)?.name ?? "").filter(Boolean);
    case "date": {
      const start = dateStart(value);
      return start ? toDate(start) : null;
    }
    case "createdTime":
    case "lastEdited":
      return typeof value === "string" ? toDate(value) : null;
    default:
      return typeof value === "string" ? (value === "" ? null : value) : value == null ? null : String(value);
  }
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** A formula result as a stored-like cell value. */
function toCell(value: FormulaValue): unknown {
  if (value === null || value === undefined) return undefined;
  if (value instanceof Date) {
    const midnight = value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0;
    const day = `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
    return { start: midnight ? day : value.toISOString() };
  }
  if (Array.isArray(value)) return value.length ? formatFormulaValue(value) : undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  return value;
}

function resultTypeOf(counts: Map<FormulaResultType, number>): FormulaResultType {
  let best: FormulaResultType = "text";
  let most = 0;
  for (const [type, n] of counts) {
    if (n > most) {
      best = type;
      most = n;
    }
  }
  return best;
}

const cache = new WeakMap<DatabaseRow[], { schema: DatabaseSchema; result: FormulaResult }>();

/**
 * Evaluates the schema's formula properties for every row. Formulas may refer
 * to other formulas; cycles are reported, not looped.
 */
export function withFormulas(rows: DatabaseRow[], schema: DatabaseSchema, now: Date = new Date()): FormulaResult {
  const formulas = schema.properties.filter((p) => p.type === "formula");
  if (!formulas.length) return { rows, schema, issues: [], rowErrors: new Map() };
  const hit = cache.get(rows);
  if (hit && hit.schema === schema) return hit.result;

  const byName = new Map<string, Property>();
  for (const property of [propertyById(schema, TITLE_ID)!, ...schema.properties]) {
    const key = property.name.trim().toLowerCase();
    if (key && !byName.has(key)) byName.set(key, property);
  }
  const issues: FormulaIssue[] = [];
  const compiled = new Map<string, ReturnType<typeof compileFormula>>();
  for (const property of formulas) {
    const program = compileFormula(property.formula ?? "");
    compiled.set(property.id, program);
    if (!program.ok && (property.formula ?? "").trim()) {
      issues.push({ propertyId: property.id, message: program.error.message, start: program.error.start, end: program.error.end });
    }
  }

  const rowErrors = new Map<string, Record<string, string>>();
  const counts = new Map<string, Map<FormulaResultType, number>>();
  const cycles = new Set<string>();

  const out = rows.map((row) => {
    const results = new Map<string, FormulaValue>();
    const stack: string[] = [];
    const evaluate = (property: Property): FormulaValue => {
      if (results.has(property.id)) return results.get(property.id)!;
      if (stack.includes(property.id)) {
        cycles.add(property.id);
        throw new Error(`"${property.name}" refers to itself`);
      }
      const program = compiled.get(property.id);
      if (!program || !program.ok) return null;
      stack.push(property.id);
      try {
        const value = program.run({ prop: resolve, now });
        results.set(property.id, value);
        return value;
      } finally {
        stack.pop();
      }
    };
    const resolve = (name: string): FormulaValue => {
      const property = byName.get(name.trim().toLowerCase());
      if (!property) throw new Error(`No property named "${name}"`);
      return property.type === "formula" ? evaluate(property) : formulaInput(row, property);
    };
    const values = { ...row.values };
    for (const property of formulas) {
      let value: FormulaValue = null;
      try {
        value = evaluate(property);
      } catch (error) {
        const errors = rowErrors.get(row.id) ?? {};
        errors[property.id] = error instanceof Error ? error.message : String(error);
        rowErrors.set(row.id, errors);
        results.set(property.id, null);
      }
      values[property.id] = toCell(value);
      const kind = typeOfValue(value);
      if (kind !== "empty") {
        const type: FormulaResultType = kind === "list" ? "text" : kind;
        const tally = counts.get(property.id) ?? new Map<FormulaResultType, number>();
        tally.set(type, (tally.get(type) ?? 0) + 1);
        counts.set(property.id, tally);
      }
    }
    return { ...row, values };
  });

  for (const id of cycles) {
    const property = formulas.find((p) => p.id === id);
    if (property) issues.push({ propertyId: id, message: `"${property.name}" refers to itself through other formulas.` });
  }
  const typedSchema: DatabaseSchema = {
    ...schema,
    properties: schema.properties.map((p) => (p.type === "formula" ? { ...p, resultType: resultTypeOf(counts.get(p.id) ?? new Map()) } : p)),
  };
  const result = { rows: out, schema: typedSchema, issues, rowErrors };
  cache.set(rows, { schema, result });
  return result;
}

/** Evaluates one formula against one row (live preview in the editor). */
export function previewFormula(source: string, row: DatabaseRow | undefined, schema: DatabaseSchema, now: Date = new Date()): { value: FormulaValue; error?: string } {
  const program = compileFormula(source);
  if (!program.ok) return { value: null, error: program.error.message };
  if (!row) return { value: null };
  const result = withFormulas([row], schema, now);
  // Other formulas resolve to their computed cells.
  const byName = new Map<string, Property>();
  for (const property of [propertyById(schema, TITLE_ID)!, ...schema.properties]) byName.set(property.name.trim().toLowerCase(), property);
  const computed = result.rows[0];
  try {
    const value = program.run({
      now,
      prop: (name) => {
        const property = byName.get(name.trim().toLowerCase());
        if (!property) throw new Error(`No property named "${name}"`);
        if (property.type === "formula") {
          const cell = computed.values[property.id];
          if (cell && typeof cell === "object" && "start" in (cell as object)) return toDate(String((cell as { start: string }).start));
          return (cell as FormulaValue) ?? null;
        }
        return formulaInput(row, property);
      },
    });
    return { value };
  } catch (error) {
    return { value: null, error: error instanceof Error ? error.message : String(error) };
  }
}

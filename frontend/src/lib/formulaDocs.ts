/**
 * In-app reference for the formula language: parameters, return types,
 * worked examples and gotchas for every entry in FORMULA_FUNCTIONS.
 *
 * Every example is evaluated by formulaDocs.test.ts against the sample row
 * FORMULA_EXAMPLE_PROPS with now() fixed to FORMULA_EXAMPLE_NOW, and must
 * produce exactly its `result` (as shown by showFormulaValue). An example
 * whose note starts with "Shows an error" must fail, and its `result` is the
 * error message.
 */
import { StyledText, isDateRange, formatFormulaValue } from "./formula";
import type { FormulaContext, FormulaValue } from "./formula";

export interface FormulaParamDoc {
  name: string;
  type: string;
  description: string;
  optional?: boolean;
  repeat?: boolean;
}
export interface FormulaExampleDoc {
  code: string;
  result: string;
  note?: string;
}
export interface FormulaFunctionDetails {
  /** Optional longer explanation (1–3 sentences); may use `code` backticks. */
  summary?: string;
  /** In order; empty for no-argument functions. */
  params: FormulaParamDoc[];
  /** Result type in plain words. */
  returns: string;
  /** Simple first, then a realistic one using properties, then an edge case. */
  examples: FormulaExampleDoc[];
  /** Gotchas: empty handling, rounding, time zones, 0- vs 1-based… */
  notes?: string[];
  /** Names of other entries in FORMULA_FUNCTIONS. */
  related?: string[];
}

// ───────────────────────────── Display ─────────────────────────────

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/** "2026-03-20", or "2026-03-12 09:30" / "…09:30:15" / "…23:59:59.999" when there is a time. */
function showDate(d: Date): string {
  const day = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const [h, m, s, ms] = [d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds()];
  if (!h && !m && !s && !ms) return day;
  let time = `${pad(h)}:${pad(m)}`;
  if (s || ms) time += `:${pad(s)}`;
  if (ms) time += `.${pad(ms, 3)}`;
  return `${day} ${time}`;
}

/**
 * A formula value as it is written in the docs: text quoted ("Total: 20"),
 * lists in brackets ([2, 3]), dates as 2026-03-20 (with a time when there is
 * one), date ranges as "start → end", `empty` for no value, true/false for
 * checkboxes. Styled text shows its plain text, quoted.
 */
export function showFormulaValue(value: FormulaValue): string {
  if (value === null || value === undefined) return "empty";
  if (typeof value === "number") return formatFormulaValue(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") return JSON.stringify(value);
  if (value instanceof StyledText) return JSON.stringify(value.text);
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "empty" : showDate(value);
  if (isDateRange(value)) return `${showDate(value[0])} → ${showDate(value[1])}`;
  return `[${value.map(showFormulaValue).join(", ")}]`;
}

// ───────────────────────────── Sample row ─────────────────────────────

/** now() for every example: Thursday, March 12, 2026, 9:30 AM (local time). */
export const FORMULA_EXAMPLE_NOW = "2026-03-12T09:30:00";

const sample: { name: string; type: string; value: FormulaValue }[] = [
  { name: "Name", type: "title", value: "Website refresh" },
  { name: "Status", type: "status", value: "In progress" },
  { name: "Price", type: "number", value: 25 },
  { name: "Quantity", type: "number", value: 4 },
  { name: "Budget", type: "number", value: 1200 },
  { name: "Done", type: "checkbox", value: false },
  { name: "Tags", type: "multi-select", value: ["Design", "Web", "Urgent"] },
  { name: "Start", type: "date", value: new Date(2026, 2, 2) },
  { name: "Due date", type: "date", value: new Date(2026, 2, 20) },
  { name: "Notes", type: "text", value: null },
];

/** The sample project-tracker row the examples read with prop() / {Name}. */
export const FORMULA_EXAMPLE_PROPS: { name: string; type: string; value: unknown; display: string }[] = sample.map((p) => ({
  ...p,
  display: showFormulaValue(p.value),
}));

/** A formula context over FORMULA_EXAMPLE_PROPS with now() = FORMULA_EXAMPLE_NOW (for live examples). */
export function formulaExampleContext(): FormulaContext {
  return {
    now: new Date(FORMULA_EXAMPLE_NOW),
    prop(name: string): FormulaValue {
      const hit = sample.find((p) => p.name === name);
      if (!hit) throw new Error(`No property named "${name}"`);
      return hit.value;
    },
  };
}

// ───────────────────────────── Helpers ─────────────────────────────

const param = (name: string, type: string, description: string): FormulaParamDoc => ({ name, type, description });
const opt = (name: string, type: string, description: string): FormulaParamDoc => ({ name, type, description, optional: true });
const many = (name: string, type: string, description: string, optional = false): FormulaParamDoc => ({
  name,
  type,
  description,
  repeat: true,
  ...(optional ? { optional: true } : {}),
});
const ex = (code: string, result: string, note?: string): FormulaExampleDoc => (note ? { code, result, note } : { code, result });

const UNIT_TEXT = '"years", "quarters", "months", "weeks", "days", "hours", "minutes", "seconds" (singular works too)';
const EMPTY_NUM = "An empty input gives an empty result.";
const LOCAL_TIME = "Dates use your computer's local time zone.";

/** Details for an alias: same params and notes, examples rewritten to use the alias name. */
function aliasOf(name: string, of: string, base: FormulaFunctionDetails): FormulaFunctionDetails {
  const re = new RegExp(`\\b${of}\\(`, "g");
  return {
    ...base,
    summary: `Another name for \`${of}()\` — it behaves exactly the same.${base.summary ? ` ${base.summary}` : ""}`,
    examples: base.examples.map((e) => ({ ...e, code: e.code.replace(re, `${name}(`) })),
    related: [of, ...(base.related ?? []).filter((r) => r !== name)],
  };
}

// ───────────────────────────── Math ─────────────────────────────

const MATH: Record<string, FormulaFunctionDetails> = {
  abs: {
    params: [param("number", "number", "Any number.")],
    returns: "number",
    examples: [ex("abs(-3)", "3"), ex("abs({Price} * {Quantity} - {Budget})", "1100"), ex("abs({Notes})", "empty")],
    notes: [EMPTY_NUM],
    related: ["sign", "round"],
  },
  round: {
    summary: "Rounds half away from zero, so 2.5 becomes 3 and -2.5 becomes -3. Negative `digits` round to tens, hundreds and so on.",
    params: [param("number", "number", "The number to round."), opt("digits", "number", "Decimal places to keep (default 0). Negative values round left of the decimal point.")],
    returns: "number",
    examples: [
      ex("round(3.14159, 2)", "3.14"),
      ex("round({Budget} / 7, 1)", "171.4"),
      ex("round(-2.5)", "-3"),
      ex("round(1234, -2)", "1200"),
    ],
    notes: [
      "Rounding is decimal-exact: round(1.005, 2) is 1.01 (toFixed() would give \"1.00\").",
      EMPTY_NUM,
    ],
    related: ["floor", "ceil", "trunc", "toFixed", "formatNumber"],
  },
  floor: {
    params: [param("number", "number", "Any number.")],
    returns: "number",
    examples: [ex("floor(2.7)", "2"), ex("floor({Budget} / {Price} / 7)", "6"), ex("floor(-2.3)", "-3", "Rounds down, so negative numbers move away from zero.")],
    notes: [EMPTY_NUM],
    related: ["ceil", "round", "trunc"],
  },
  ceil: {
    params: [param("number", "number", "Any number.")],
    returns: "number",
    examples: [ex("ceil(2.1)", "3"), ex("ceil({Quantity} / 3)", "2", "How many boxes of 3 are needed for 4 items."), ex("ceil(-2.7)", "-2")],
    notes: [EMPTY_NUM],
    related: ["floor", "round", "trunc"],
  },
  trunc: {
    params: [param("number", "number", "Any number.")],
    returns: "number",
    examples: [ex("trunc(-2.7)", "-2"), ex("trunc({Budget} / 7)", "171"), ex("trunc(2.999)", "2")],
    notes: ["Always moves toward zero, unlike floor() which always moves down.", EMPTY_NUM],
    related: ["floor", "ceil", "round"],
  },
  min: {
    summary: "Takes any mix of numbers and lists of numbers. If every value is a date, it returns the earliest date.",
    params: [many("values", "number, date or list", "Numbers or dates, or lists of them.")],
    returns: "number (or date)",
    examples: [
      ex("min(4, 2, 8)", "2"),
      ex("min({Price}, 20)", "20"),
      ex("min({Start}, {Due date})", "2026-03-02"),
      ex("min([])", "empty"),
    ],
    notes: ["Empty values are skipped; with nothing left the result is empty.", "Text, or a mix of dates and numbers, is an error."],
    related: ["max", "clamp", "sort"],
  },
  max: {
    summary: "Takes any mix of numbers and lists of numbers. If every value is a date, it returns the latest date.",
    params: [many("values", "number, date or list", "Numbers or dates, or lists of them.")],
    returns: "number (or date)",
    examples: [
      ex("max([4, 2, 8])", "8"),
      ex("max(0, {Budget} - 1500)", "0", "A floor of zero: never show a negative amount."),
      ex("max({Start}, {Due date})", "2026-03-20"),
      ex("max({Tags})", 'max() needs a number, got text', "Shows an error: text can't be compared as numbers."),
    ],
    notes: ["Empty values are skipped; with nothing left the result is empty."],
    related: ["min", "clamp", "sort"],
  },
  sum: {
    params: [many("values", "number or list", "Numbers, or lists of numbers.", true)],
    returns: "number",
    examples: [
      ex("sum([1, 2, 3])", "6"),
      ex("sum({Price} * {Quantity}, 50)", "150"),
      ex("sum(map([120, 45.5, 300], current * 2))", "931"),
      ex("sum(empty(), 5)", "5", "Empty values are skipped."),
    ],
    notes: ["With no numbers at all (sum() or sum([])) the result is 0.", "Text inside the values is an error."],
    related: ["product", "mean", "reduce", "count"],
  },
  mean: {
    params: [many("values", "number or list", "Numbers, or lists of numbers.")],
    returns: "number",
    examples: [ex("mean(1, 2, 6)", "3"), ex("mean([120, 80, {Price} * {Quantity}])", "100"), ex("mean([])", "empty")],
    notes: ["Empty values are skipped and not counted.", "No numbers gives empty, not 0."],
    related: ["median", "sum", "stdev", "average", "avg"],
  },
  median: {
    summary: "Sorts the numbers and takes the middle one; with an even count it averages the two middle numbers.",
    params: [many("values", "number or list", "Numbers, or lists of numbers.")],
    returns: "number",
    examples: [ex("median([3, 1, 4, 2])", "2.5"), ex("median(5, 1, 9)", "5"), ex("median([{Price}, 30, 400])", "30"), ex("median([])", "empty")],
    notes: ["Empty values are skipped; no numbers gives empty."],
    related: ["mean", "min", "max"],
  },
  mod: {
    params: [param("number", "number", "The number to divide."), param("divisor", "number", "The number to divide by.")],
    returns: "number",
    examples: [
      ex("mod(7, 3)", "1"),
      ex("mod({Quantity}, 2) == 0", "true", "Is the quantity even?"),
      ex("mod(-7, 3)", "-1", "The sign follows the first number."),
      ex("mod(5, 0)", "empty"),
    ],
    notes: ["Same as the % operator. Dividing by 0 gives empty."],
    related: ["+ - * / % ^", "trunc"],
  },
  pow: {
    params: [param("base", "number", "The number to raise."), param("exponent", "number", "The power; fractions give roots.")],
    returns: "number",
    examples: [
      ex("pow(2, 10)", "1024"),
      ex("round({Budget} * pow(1.05, 3), 2)", "1389.15", "Budget after three years of 5% growth."),
      ex("pow(9, 0.5)", "3"),
      ex("pow(0, -1)", "empty", "Results that aren't finite numbers become empty."),
    ],
    notes: ["Same as base ^ exponent."],
    related: ["sqrt", "exp", "+ - * / % ^"],
  },
  sqrt: {
    params: [param("number", "number", "A number ≥ 0.")],
    returns: "number",
    examples: [ex("sqrt(16)", "4"), ex("sqrt(2)", "1.41421356237"), ex("sqrt(-1)", "empty", "Negative numbers have no real square root.")],
    notes: ["Results are shown to 12 significant digits.", EMPTY_NUM],
    related: ["cbrt", "pow"],
  },
  cbrt: {
    params: [param("number", "number", "Any number.")],
    returns: "number",
    examples: [ex("cbrt(27)", "3"), ex("cbrt({Budget} / 150)", "2"), ex("cbrt(-8)", "-2")],
    notes: [EMPTY_NUM],
    related: ["sqrt", "pow"],
  },
  exp: {
    params: [param("number", "number", "The power to raise e to.")],
    returns: "number",
    examples: [ex("exp(1)", "2.71828182846"), ex("exp(0)", "1"), ex("round({Budget} * exp(0.05), 2)", "1261.53", "Continuous 5% growth.")],
    notes: [EMPTY_NUM],
    related: ["ln", "e", "pow"],
  },
  ln: {
    params: [param("number", "number", "A number > 0.")],
    returns: "number",
    examples: [ex("ln(e())", "1"), ex("round(ln({Budget}), 3)", "7.09"), ex("ln(0)", "empty")],
    notes: ["0 and negative numbers give empty."],
    related: ["exp", "log10", "log2"],
  },
  log10: {
    params: [param("number", "number", "A number > 0.")],
    returns: "number",
    examples: [ex("log10(1000)", "3"), ex("floor(log10({Budget})) + 1", "4", "Number of digits in the budget."), ex("log10(-5)", "empty")],
    notes: ["0 and negative numbers give empty."],
    related: ["ln", "log2"],
  },
  log2: {
    params: [param("number", "number", "A number > 0.")],
    returns: "number",
    examples: [ex("log2(8)", "3"), ex("ceil(log2({Quantity} * 10))", "6"), ex("log2(0)", "empty")],
    notes: ["0 and negative numbers give empty."],
    related: ["ln", "log10"],
  },
  sign: {
    params: [param("number", "number", "Any number.")],
    returns: "number",
    examples: [ex("sign(-5)", "-1"), ex("sign({Budget} - {Price} * {Quantity})", "1"), ex("sign(0)", "0")],
    notes: [EMPTY_NUM],
    related: ["abs"],
  },
  pi: {
    params: [],
    returns: "number",
    examples: [ex("pi()", "3.14159265359"), ex("round(pi() * 3 ^ 2, 2)", "28.27", "Area of a circle with radius 3."), ex("pi * 2", "6.28318530718", "The parentheses are optional.")],
    related: ["e", "round"],
  },
  e: {
    params: [],
    returns: "number",
    examples: [ex("e()", "2.71828182846"), ex("ln(e() ^ 2)", "2"), ex("round(e, 3)", "2.718", "The parentheses are optional.")],
    related: ["exp", "ln", "pi"],
  },
  clamp: {
    params: [param("number", "number", "The number to limit."), param("min", "number", "Lowest allowed value."), param("max", "number", "Highest allowed value.")],
    returns: "number",
    examples: [
      ex("clamp(12, 0, 10)", "10"),
      ex("clamp({Budget} / 10, 0, 100)", "100", "A progress value that never goes past 100."),
      ex("clamp(-4, 0, 10)", "0"),
      ex("clamp(5, 10, 0)", "5", "min and max can be given in either order."),
    ],
    notes: ["An empty number gives empty; empty bounds are an error."],
    related: ["min", "max", "between"],
  },
  between: {
    summary: "Checks low ≤ value ≤ high, both ends included. Works with numbers, text (alphabetical) and dates, as long as all three are the same type.",
    params: [param("value", "number, text or date", "The value to check."), param("low", "same as value", "Lower bound (included)."), param("high", "same as value", "Upper bound (included).")],
    returns: "checkbox",
    examples: [
      ex("between(5, 1, 10)", "true"),
      ex("between(today(), {Start}, {Due date})", "true", "Is the project running right now?"),
      ex("between({Price}, 25, 50)", "true", "Both ends count."),
      ex("between({Notes}, 1, 10)", "false", "Any empty input gives false."),
    ],
    notes: ["Mixing types (a number with text, say) is an error."],
    related: ["clamp", "== != > < >= <="],
  },
  percent: {
    params: [
      param("part", "number", "The portion."),
      param("total", "number", "The whole."),
      opt("digits", "number", "Decimal places to round to (default 0, up to 10)."),
    ],
    returns: "number",
    examples: [
      ex("percent(3, 8)", "38"),
      ex("percent({Price} * {Quantity}, {Budget}, 1)", "8.3", "Share of the budget spent."),
      ex('percent({Price} * {Quantity}, {Budget}) + "%"', '"8%"'),
      ex("percent(5, 0)", "empty", "A total of 0 gives empty instead of an error."),
    ],
    notes: ["Returns 0–100, not 0–1. To show 0.083 as \"8.3%\", use formatNumber(x, \"percent\") instead.", "Either input empty gives empty."],
    related: ["formatNumber", "round", "+ - * / % ^"],
  },
  product: {
    params: [many("values", "number or list", "Numbers, or lists of numbers.")],
    returns: "number",
    examples: [ex("product([2, 3, 4])", "24"), ex("product({Price}, {Quantity})", "100"), ex("product([])", "empty")],
    notes: ["Empty values are skipped; no numbers at all gives empty (sum() gives 0)."],
    related: ["sum", "pow"],
  },
  stdev: {
    summary: "The sample standard deviation (divides by n − 1), a measure of how spread out the numbers are.",
    params: [many("values", "number or list", "Numbers, or lists of numbers.")],
    returns: "number",
    examples: [ex("stdev([2, 4, 4, 4, 5, 5, 7, 9])", "2.1380899353"), ex("round(stdev([{Price}, 30, 35]), 2)", "5"), ex("stdev([5])", "empty", "Needs at least two numbers.")],
    notes: ["Empty values are skipped."],
    related: ["mean", "median"],
  },
  toFixed: {
    params: [param("number", "number", "The number to format."), opt("digits", "number", "Decimal places, 0–20 (default 2).")],
    returns: "text",
    examples: [
      ex("toFixed(3.14159, 2)", '"3.14"'),
      ex('"$" + toFixed({Price}, 2)', '"$25.00"'),
      ex("toFixed({Quantity})", '"4.00"'),
      ex("toFixed(1.005, 2)", '"1.00"', "Uses binary rounding, so some halves round down. Use round() first when exact halves matter."),
    ],
    notes: ["The result is text, so it can't be used in further maths; use round() for a number.", EMPTY_NUM],
    related: ["round", "formatNumber", "toText"],
  },
  formatNumber: {
    params: [
      param("number", "number", "The number to format."),
      opt("format", "text", '"number", "commas" (default), "percent", "dollar", "euro", "pound" or "yen".'),
      opt("digits", "number", "Fixed decimal places, 0–10. Leave out to show as many as needed."),
    ],
    returns: "text",
    examples: [
      ex('formatNumber(1234.5, "commas", 2)', '"1,234.50"'),
      ex('formatNumber({Budget}, "dollar")', '"$1,200.00"'),
      ex('formatNumber({Price} * {Quantity} / {Budget}, "percent", 1)', '"8.3%"', '"percent" multiplies by 100.'),
      ex('formatNumber({Budget}, "pound", 0)', '"£1,200"'),
    ],
    notes: [
      "The result is text — format at the very end of a formula.",
      '"euro" uses German style (1.200,00 €) and "yen" Japanese style; "commas" and "percent" always use 1,234.5 style.',
      "An unknown format name is an error.",
      EMPTY_NUM,
    ],
    related: ["toFixed", "percent", "round", "toText"],
  },
};
MATH.average = aliasOf("average", "mean", MATH.mean);
MATH.avg = aliasOf("avg", "mean", MATH.mean);

// ───────────────────────────── Text ─────────────────────────────

const TEXT: Record<string, FormulaFunctionDetails> = {
  concat: {
    summary: "Joins values into one piece of text. Numbers, dates and lists are converted the way a cell shows them. If every argument is a list, the lists are joined into one list instead.",
    params: [many("values", "any", "Values to join.")],
    returns: "text (or list when every value is a list)",
    examples: [
      ex('concat("a", "b", 1)', '"ab1"'),
      ex('concat({Name}, " (", {Status}, ")")', '"Website refresh (In progress)"'),
      ex('concat({Tags}, ["Q2"])', '["Design", "Web", "Urgent", "Q2"]'),
      ex('concat("Tags: ", {Tags})', '"Tags: Design, Web, Urgent"', "A list mixed with text becomes comma-separated text."),
    ],
    notes: ["Empty values add nothing.", "Keeps styling from style() and link()."],
    related: ["join", "+ - * / % ^", "format"],
  },
  join: {
    params: [param("list", "list", "The items to join."), opt("separator", "text", 'Put between items (default ", ").')],
    returns: "text",
    examples: [
      ex('join(["a", "b"], "-")', '"a-b"'),
      ex('join({Tags}, " · ")', '"Design · Web · Urgent"'),
      ex("join({Tags})", '"Design, Web, Urgent"'),
      ex("join([])", '""'),
    ],
    notes: ["An empty list (or empty value) gives empty text \"\".", "Passing text instead of a list is an error — use it directly."],
    related: ["split", "concat", "map"],
  },
  length: {
    params: [param("value", "text or list", "Text to measure, or a list to count.")],
    returns: "number",
    examples: [
      ex('length("hello")', "5"),
      ex("length({Tags})", "3"),
      ex("length({Name})", "15"),
      ex("length({Notes})", "0"),
    ],
    notes: [
      "Empty counts as 0.",
      "Other values are measured as their text: length(12345) is 5.",
      "count() skips empty items in a list; length() counts every item.",
    ],
    related: ["count", "wordCount", "slice"],
  },
  lower: {
    params: [param("text", "text", "Text to convert.")],
    returns: "text",
    examples: [ex('lower("ABC")', '"abc"'), ex("lower({Status})", '"in progress"'), ex("lower({Notes})", '""', "Empty becomes empty text.")],
    notes: ["Handy for case-insensitive checks: contains(lower({Name}), \"web\")."],
    related: ["upper", "capitalize", "titleCase"],
  },
  upper: {
    params: [param("text", "text", "Text to convert.")],
    returns: "text",
    examples: [ex('upper("abc")', '"ABC"'), ex("upper({Name})", '"WEBSITE REFRESH"'), ex("upper(left({Status}, 1))", '"I"')],
    notes: ["Empty becomes empty text \"\"."],
    related: ["lower", "capitalize", "titleCase"],
  },
  trim: {
    params: [param("text", "text", "Text to clean up.")],
    returns: "text",
    examples: [ex('trim("  hi  ")', '"hi"'), ex('trim("  " + {Name} + "\\n")', '"Website refresh"', "Removes tabs and line breaks too."), ex("trim({Notes})", '""')],
    notes: ["Spaces inside the text are kept."],
    related: ["replaceAll", "slugify"],
  },
  capitalize: {
    params: [param("text", "text", "Text to convert.")],
    returns: "text",
    examples: [ex('capitalize("hello world")', '"Hello world"'), ex("capitalize(lower({Status}))", '"In progress"'), ex('capitalize("")', '""')],
    notes: ["Only the first character changes; the rest is left as it is."],
    related: ["titleCase", "upper", "lower"],
  },
  replace: {
    summary: "Replaces only the first match. `find` is plain text, or a regular expression written between slashes, like \"/[0-9]+/\" (add i after the closing slash to ignore case).",
    params: [
      param("text", "text", "The text to change."),
      param("find", "text", "Plain text, or a /regex/ with optional flags."),
      param("replacement", "text", "What to put instead. With a regex, $1, $2… insert captured groups."),
    ],
    returns: "text",
    examples: [
      ex('replace("a-b-c", "-", "+")', '"a+b-c"'),
      ex('replace({Name}, "refresh", "redesign")', '"Website redesign"'),
      ex('replace("Order 123", "/[0-9]+/", "#")', '"Order #"'),
      ex('replace("2026-03", "/([0-9]+)-([0-9]+)/", "$2/$1")', '"03/2026"'),
    ],
    notes: ["Matching is case-sensitive unless you use a regex with the i flag.", "No match leaves the text unchanged."],
    related: ["replaceAll", "test", "match"],
  },
  replaceAll: {
    summary: "Replaces every match. `find` is plain text, or a regular expression written between slashes, like \"/[0-9]/\".",
    params: [
      param("text", "text", "The text to change."),
      param("find", "text", "Plain text, or a /regex/ with optional flags."),
      param("replacement", "text", "What to put instead. With a regex, $1, $2… insert captured groups."),
    ],
    returns: "text",
    examples: [
      ex('replaceAll("a-b-c", "-", "+")', '"a+b+c"'),
      ex('replaceAll(lower({Name}), " ", "_")', '"website_refresh"'),
      ex('replaceAll("a1b22", "/[0-9]/", "#")', '"a#b##"'),
    ],
    notes: ["Case-sensitive unless you use a regex with the i flag, e.g. \"/web/i\"."],
    related: ["replace", "split", "slugify"],
  },
  contains: {
    params: [param("value", "text or list", "The text to search, or a list to look in."), param("search", "any", "What to look for.")],
    returns: "checkbox",
    examples: [
      ex('contains("Hello", "ell")', "true"),
      ex('contains({Tags}, "Urgent")', "true", "For a list, an item must equal the value exactly."),
      ex('contains({Name}, "web")', "false", "Case-sensitive."),
      ex('contains(lower({Name}), "web")', "true"),
    ],
    notes: ["Same as includes().", "On text, numbers and dates are compared as their text."],
    related: ["includes", "test", "indexOf", "startsWith"],
  },
  test: {
    summary: "Checks text against a regular expression. Write the pattern plainly (\"[0-9]+\") or between slashes to add flags (\"/^web/i\").",
    params: [param("text", "text", "The text to check."), param("pattern", "text", "A regular expression.")],
    returns: "checkbox",
    examples: [
      ex('test("ID-42", "[0-9]+")', "true"),
      ex('test({Name}, "/^web/i")', "true", "The i flag ignores case."),
      ex('test({Status}, "^Done$")', "false"),
      ex('test({Name}, "(")', "test(): invalid pattern — Invalid regular expression: /(/: Unterminated group", "Shows an error: the pattern isn't a valid regex."),
    ],
    notes: ["To match a literal . ( ) [ ? + * write a backslash before it, doubled inside quotes: \"\\\\.\"."],
    related: ["match", "contains", "replace"],
  },
  match: {
    params: [param("text", "text", "The text to search."), param("pattern", "text", "A regular expression, plain or /between slashes/ with flags.")],
    returns: "list of text",
    examples: [
      ex('match("a1b22", "[0-9]+")', '["1", "22"]'),
      ex('match("Fix #12 and #7", "#[0-9]+")', '["#12", "#7"]'),
      ex('length(match({Name}, "/[aeiou]/i"))', "5", "Count the vowels."),
      ex('match({Name}, "[0-9]")', "[]", "No match gives an empty list."),
    ],
    notes: ["Always returns every match (the g flag is implied)."],
    related: ["test", "replaceAll", "split"],
  },
  slice: {
    summary: "Takes part of text or a list, from `start` up to but not including `end`. Positions are 0-based; negative positions count from the end.",
    params: [
      param("value", "text or list", "The text or list to cut."),
      param("start", "number", "First position to keep (0 is the first)."),
      opt("end", "number", "Position to stop before. Leave out to go to the end."),
    ],
    returns: "same as input (text or list)",
    examples: [
      ex('slice("Hello", 1, 3)', '"el"'),
      ex("slice({Tags}, 0, 2)", '["Design", "Web"]'),
      ex("slice({Name}, -7)", '"refresh"'),
      ex("slice({Notes}, 2)", '""', "Empty is treated as empty text."),
    ],
    notes: ["Out-of-range positions are clamped, so slicing never fails."],
    related: ["left", "right", "at", "substring", "split"],
  },
  split: {
    params: [
      param("text", "text", "The text to split."),
      opt("separator", "text", 'Where to cut: plain text or a /regex/. Leave out to split into single characters.'),
    ],
    returns: "list of text",
    examples: [
      ex('split("a,b,c", ",")', '["a", "b", "c"]'),
      ex('split("Design; Web, Ops", "/[,;] */")', '["Design", "Web", "Ops"]'),
      ex('split("abc")', '["a", "b", "c"]'),
      ex('split({Notes}, ",")', '[""]', "Empty text gives a list with one empty item; wrap in compact() to drop it."),
    ],
    notes: ["Spaces around the separator are kept; trim them with map(…, trim(current)) or a regex separator."],
    related: ["join", "match", "compact"],
  },
  startsWith: {
    params: [param("text", "text", "The text to check."), param("prefix", "text", "The start to look for.")],
    returns: "checkbox",
    examples: [ex('startsWith("Noteral", "Note")', "true"), ex('startsWith({Name}, "Web")', "true"), ex('startsWith({Name}, "web")', "false", "Case-sensitive.")],
    related: ["endsWith", "contains", "left"],
  },
  endsWith: {
    params: [param("text", "text", "The text to check."), param("suffix", "text", "The ending to look for.")],
    returns: "checkbox",
    examples: [ex('endsWith("report.pdf", ".pdf")', "true"), ex('endsWith(lower("REPORT.PDF"), ".pdf")', "true"), ex('endsWith({Notes}, "")', "true", "Every text ends with empty text.")],
    notes: ["Case-sensitive."],
    related: ["startsWith", "contains", "right"],
  },
  padStart: {
    params: [
      param("text", "text", "The text to pad."),
      param("length", "number", "The length to reach."),
      opt("fill", "text", 'What to pad with (default a space).'),
    ],
    returns: "text",
    examples: [
      ex('padStart("7", 3, "0")', '"007"'),
      ex('"#" + padStart(format({Quantity}), 4, "0")', '"#0004"'),
      ex('padStart("12345", 3, "0")', '"12345"', "Text already long enough is unchanged."),
    ],
    notes: ["Numbers are padded as text: padStart(7, 3, \"0\") also gives \"007\"."],
    related: ["padEnd", "repeat"],
  },
  padEnd: {
    params: [
      param("text", "text", "The text to pad."),
      param("length", "number", "The length to reach."),
      opt("fill", "text", 'What to pad with (default a space).'),
    ],
    returns: "text",
    examples: [ex('padEnd("ab", 4, ".")', '"ab.."'), ex('padEnd({Status}, 14, ".")', '"In progress..."'), ex('padEnd("abc", 2)', '"abc"')],
    related: ["padStart", "repeat"],
  },
  repeat: {
    params: [param("text", "text", "The text to repeat."), param("times", "number", "How many copies.")],
    returns: "text",
    examples: [
      ex('repeat("ab", 3)', '"ababab"'),
      ex('repeat("★", {Quantity}) + repeat("☆", 5 - {Quantity})', '"★★★★☆"', "A simple rating bar."),
      ex('repeat("x", -1)', '""', "Zero or negative times gives empty text."),
    ],
    notes: ["Fractional times are truncated."],
    related: ["padStart", "padEnd"],
  },
  format: {
    params: [param("value", "any", "The value to convert.")],
    returns: "text",
    examples: [
      ex("format(42)", '"42"'),
      ex("format({Due date})", '"Mar 20, 2026"'),
      ex("format({Tags})", '"Design, Web, Urgent"'),
      ex("format({Notes})", '""'),
    ],
    notes: ["Same as toText(). Dates use the short style; use formatDate() to choose one."],
    related: ["toText", "formatDate", "formatNumber"],
  },
  indexOf: {
    params: [param("value", "text or list", "The text or list to search."), param("search", "any", "What to find.")],
    returns: "number",
    examples: [ex('indexOf("hello", "l")', "2"), ex('indexOf({Tags}, "Web")', "1"), ex('indexOf({Name}, "x")', "-1", "Not found.")],
    notes: ["Positions are 0-based: the first character or item is 0."],
    related: ["findIndex", "contains", "at"],
  },
  left: {
    params: [param("text", "text", "The text."), param("count", "number", "How many characters to keep.")],
    returns: "text",
    examples: [ex('left("Noteral", 4)', '"Note"'), ex("left({Name}, 7)", '"Website"'), ex('left("Hi", 10)', '"Hi"')],
    notes: ["Emoji and other symbols count as one character."],
    related: ["right", "slice", "truncate"],
  },
  right: {
    params: [param("text", "text", "The text."), param("count", "number", "How many characters to keep.")],
    returns: "text",
    examples: [ex('right("report.pdf", 3)', '"pdf"'), ex("right({Name}, 7)", '"refresh"'), ex('right("abc", 0)', '""')],
    notes: ["Emoji and other symbols count as one character."],
    related: ["left", "slice", "endsWith"],
  },
  wordCount: {
    params: [param("text", "text", "The text to count.")],
    returns: "number",
    examples: [ex('wordCount("one two  three")', "3"), ex("wordCount({Name})", "2"), ex('wordCount("state-of-the-art design")', "2", "Hyphenated words count once."), ex("wordCount({Notes})", "0")],
    notes: ["A word is a run of letters, digits, apostrophes, hyphens or underscores."],
    related: ["length", "split"],
  },
  slugify: {
    params: [param("text", "text", "The text to convert.")],
    returns: "text",
    examples: [ex('slugify("Hello, Wörld!")', '"hello-world"'), ex("slugify({Name})", '"website-refresh"'), ex('slugify("  Q2 — Café launch ")', '"q2-cafe-launch"')],
    notes: ["Accents are removed, every run of other characters becomes one dash, and dashes at the ends are dropped."],
    related: ["lower", "replaceAll", "titleCase"],
  },
  titleCase: {
    params: [param("text", "text", "The text to convert.")],
    returns: "text",
    examples: [ex('titleCase("the quick fox")', '"The Quick Fox"'), ex("titleCase({Status})", '"In Progress"'), ex('titleCase("iOS app")', '"Ios App"', "Other letters are lowercased first.")],
    related: ["capitalize", "upper", "lower"],
  },
  truncate: {
    params: [
      param("text", "text", "The text to shorten."),
      param("length", "number", "Maximum length, including the ending."),
      opt("ending", "text", 'Added when the text is cut (default "…").'),
    ],
    returns: "text",
    examples: [
      ex('truncate("Quarterly report", 9)', '"Quarterl…"'),
      ex("truncate({Name}, 10)", '"Website r…"'),
      ex('truncate({Name}, 10, "...")', '"Website..."'),
      ex('truncate("Short", 10)', '"Short"', "Text that fits is unchanged."),
    ],
    related: ["left", "slice"],
  },
  pluralize: {
    params: [
      param("count", "number", "How many."),
      param("word", "text", "The singular word."),
      opt("plural", "text", 'The plural form (default word + "s").'),
    ],
    returns: "text",
    examples: [
      ex('pluralize(3, "task")', '"3 tasks"'),
      ex('pluralize(length({Tags}), "tag")', '"3 tags"'),
      ex('pluralize(1, "person", "people")', '"1 person"'),
      ex('pluralize({Notes}, "note")', '"0 notes"', "An empty count is 0."),
    ],
    notes: ["Only exactly 1 uses the singular; 0 and 1.5 use the plural."],
    related: ["count", "length", "+ - * / % ^"],
  },
  style: {
    summary: "Adds formatting to text. Combine any number of styles: \"b\" bold, \"i\" italic, \"u\" underline, \"s\" strikethrough, \"c\" code, a color like \"red\" or a background like \"red_background\".",
    params: [
      param("text", "text", "The text to format (other values are converted to text)."),
      many("styles", "text", 'Style names: b, i, u, s, c (or bold, italic…), gray, brown, orange, yellow, green, blue, purple, pink, red, or a color + "_background".'),
    ],
    returns: "styled text",
    examples: [
      ex('style("Overdue", "b", "red")', '"Overdue"'),
      ex('if({Done}, style("Done", "green"), style({Status}, "i", "yellow_background"))', '"In progress"'),
      ex('style("Due ", "b") + {Due date}', '"Due Mar 20, 2026"', "Joining with + keeps the styling of each part."),
      ex('style({Name}, "bolt")', 'style(): unknown style "bolt". Did you mean "bold"? Use b, i, u, s, c, a color like "red" or "red_background"', "Shows an error: unknown style names are rejected."),
    ],
    notes: ["Styled text still acts like plain text in comparisons, filters and text functions.", "\"default\" removes a color."],
    related: ["unstyle", "link", "concat"],
  },
  unstyle: {
    params: [param("text", "styled text", "The text to clean."), many("styles", "text", "Only remove these styles. Leave out to remove all formatting.", true)],
    returns: "text (styled text when some styles remain)",
    examples: [
      ex('unstyle(style("Hi", "b"))', '"Hi"'),
      ex('typeOf(unstyle(style({Status}, "b", "red"), "red"))', '"text"', "Still bold, no longer red."),
      ex("unstyle({Name})", '"Website refresh"', "Plain text passes through."),
    ],
    related: ["style", "link"],
  },
  link: {
    summary: "Makes clickable text. Web addresses without a scheme get https:// added; mailto: and tel: links work too.",
    params: [param("label", "text", "The text to show (and the address when `url` is left out)."), opt("url", "text", "Where the link goes.")],
    returns: "styled text",
    examples: [
      ex('link("Docs", "noteral.app/docs")', '"Docs"'),
      ex('link("Email Maya", "mailto:maya@example.com")', '"Email Maya"'),
      ex('link("https://example.com")', '"https://example.com"'),
      ex('link("Files", "ftp://files.example.com")', 'link(): "ftp://files.example.com" isn\'t a web, email or phone link', "Shows an error: only web, mailto: and tel: links are allowed."),
    ],
    notes: ["An empty url leaves the label as plain, unlinked text."],
    related: ["style", "concat"],
  },
};
TEXT.substring = aliasOf("substring", "slice", TEXT.slice);

// ───────────────────────────── Logic ─────────────────────────────

const LOGIC: Record<string, FormulaFunctionDetails> = {
  if: {
    params: [
      param("condition", "any", "Tested for truth: false, 0, empty, \"\" and [] are false."),
      param("then", "any", "Result when the condition is true."),
      opt("else", "any", "Result otherwise (default empty)."),
    ],
    returns: "same as then / else",
    examples: [
      ex('if(5 > 3, "yes", "no")', '"yes"'),
      ex('if({Done}, "✅ Done", "Due " + formatDate({Due date}, "MMM D"))', '"Due Mar 20"'),
      ex('if({Price} > 100, "Over limit")', "empty", "No else gives empty."),
    ],
    notes: ["Only the chosen branch is evaluated, so the other may contain errors.", "You can also write condition ? then : else."],
    related: ["ifs", "switch", "? :", "coalesce"],
  },
  ifs: {
    summary: "Checks conditions in order and returns the value paired with the first true one. A final unpaired argument is the fallback.",
    params: [
      many("condition", "any", "A condition to test."),
      many("value", "any", "Result when that condition is the first true one."),
      opt("else", "any", "Result when no condition is true (default empty)."),
    ],
    returns: "same as the values",
    examples: [
      ex('ifs(1 > 2, "a", 2 > 1, "b", "c")', '"b"'),
      ex('ifs({Price} > 100, "High", {Price} > 20, "Medium", "Low")', '"Medium"'),
      ex('ifs({Done}, "Done", daysUntil({Due date}) < 0, "Late")', "empty", "No match and no fallback gives empty."),
    ],
    related: ["if", "switch"],
  },
  and: {
    params: [many("values", "any", "Values to test.")],
    returns: "checkbox",
    examples: [ex("and(true, 1 > 0)", "true"), ex("and(not {Done}, {Price} > 10)", "true"), ex("and({Tags}, {Notes})", "false", "Empty values are false.")],
    notes: ["Stops at the first false value.", "Also written a and b, or a && b."],
    related: ["or", "not", "and or not"],
  },
  or: {
    params: [many("values", "any", "Values to test.")],
    returns: "checkbox",
    examples: [ex("or(false, 1 > 0)", "true"), ex('or({Done}, {Status} == "In progress")', "true"), ex('or(empty(), "", 0)', "false")],
    notes: ["Stops at the first true value.", "Also written a or b, or a || b."],
    related: ["and", "not", "and or not"],
  },
  not: {
    params: [param("value", "any", "The value to flip.")],
    returns: "checkbox",
    examples: [ex("not(true)", "false"), ex("not({Done})", "true"), ex("not({Notes})", "true", "Empty is false, so not gives true.")],
    notes: ["Also written not x or !x. not binds tightly: write not({Price} > 10), not not {Price} > 10."],
    related: ["and", "or", "and or not", "isEmpty"],
  },
  empty: {
    summary: "Without an argument it is the empty value (like a blank cell). With one, it checks whether that value is empty.",
    params: [opt("value", "any", "The value to check.")],
    returns: "empty, or checkbox when given a value",
    examples: [
      ex('empty("")', "true"),
      ex('if(empty({Notes}), "No notes", {Notes})', '"No notes"'),
      ex("empty(0)", "false", "0 and false are real values, not empty."),
      ex('if({Done}, "Shipped", empty())', "empty"),
    ],
    notes: ["Empty, \"\" and [] count as empty.", "empty can be written without parentheses."],
    related: ["isEmpty", "coalesce", "compact"],
  },
  isEmpty: {
    params: [param("value", "any", "The value to check.")],
    returns: "checkbox",
    examples: [ex("isEmpty([])", "true"), ex("isEmpty({Notes})", "true"), ex("isEmpty({Tags})", "false"), ex("isEmpty(false)", "false", "false is a value, not empty.")],
    notes: ["Empty, \"\" and [] count as empty; 0 and false don't."],
    related: ["empty", "coalesce", "not"],
  },
  coalesce: {
    params: [many("values", "any", "Candidates, tried in order.")],
    returns: "same as the first non-empty value",
    examples: [
      ex('coalesce(empty(), "", "fallback")', '"fallback"'),
      ex('coalesce({Notes}, "No notes yet")', '"No notes yet"'),
      ex("coalesce({Notes}, empty())", "empty", "Empty when every value is empty."),
    ],
    notes: ["Stops at the first non-empty value; later ones aren't evaluated.", "0 and false are not empty, so they are returned."],
    related: ["if", "empty", "ifError"],
  },
  equal: {
    params: [param("a", "any", "First value."), param("b", "any", "Second value.")],
    returns: "checkbox",
    examples: [
      ex("equal([1, 2], [1, 2])", "true"),
      ex('equal({Status}, "In progress")', "true"),
      ex("equal(0.1 + 0.2, 0.3)", "true", "Tiny floating-point differences are ignored."),
      ex('equal({Notes}, "")', "true", "Empty equals empty text."),
    ],
    notes: ["Same as a == b. Different types are never equal: equal(1, \"1\") is false.", "Text comparison is case-sensitive."],
    related: ["unequal", "== != > < >= <="],
  },
  unequal: {
    params: [param("a", "any", "First value."), param("b", "any", "Second value.")],
    returns: "checkbox",
    examples: [ex('unequal(1, "1")', "true", "A number and text always differ."), ex('unequal({Status}, "Done")', "true"), ex("unequal({Notes}, [])", "false", "Empty, \"\" and [] are all equal.")],
    notes: ["Same as a != b (or a <> b)."],
    related: ["equal", "== != > < >= <="],
  },
  let: {
    summary: "Gives a value a name so you can reuse it in the expression without repeating (or recomputing) it.",
    params: [
      param("name", "name", "A variable name (letters, no quotes)."),
      param("value", "any", "The value to store."),
      param("expression", "any", "The result, which can use the name."),
    ],
    returns: "same as expression",
    examples: [
      ex("let(x, 4, x * x)", "16"),
      ex('let(total, {Price} * {Quantity}, total > 50 ? "Big order" : "Small order")', '"Big order"'),
      ex('let(days, daysUntil({Due date}), days < 0 ? "Late" : pluralize(days, "day") + " left")', '"8 days left"'),
    ],
    related: ["lets"],
  },
  lets: {
    params: [
      many("name", "name", "A variable name."),
      many("value", "any", "Its value; may use names defined before it."),
      param("expression", "any", "The result, which can use all the names."),
    ],
    returns: "same as expression",
    examples: [
      ex("lets(a, 2, b, a + 1, a * b)", "6"),
      ex('lets(spent, {Price} * {Quantity}, remaining, {Budget} - spent, "Left: " + remaining)', '"Left: 1100"'),
      ex("lets(d, {Due date}, s, {Start}, dateBetween(d, s, \"weeks\"))", "2"),
    ],
    related: ["let"],
  },
  switch: {
    summary: "Compares one value with each case in turn and returns the result paired with the first equal case. A final unpaired argument is the default.",
    params: [
      param("value", "any", "The value to compare."),
      many("case", "any", "A value to compare with."),
      many("result", "any", "Result when the case matches."),
      opt("default", "any", "Result when nothing matches (default empty)."),
    ],
    returns: "same as the results",
    examples: [
      ex('switch("b", "a", 1, "b", 2, 0)', "2"),
      ex('switch({Status}, "Not started", "⚪", "In progress", "🟡", "Done", "🟢", "?")', '"🟡"'),
      ex('switch({Status}, "Done", 1)', "empty", "No match and no default."),
    ],
    notes: ["Cases are compared like ==, so text is case-sensitive."],
    related: ["ifs", "if"],
  },
  ifError: {
    params: [param("value", "any", "The expression to try."), param("fallback", "any", "Used if the expression fails.")],
    returns: "same as value / fallback",
    examples: [
      ex('ifError(sqrt("x"), 0)', "0"),
      ex("ifError(sum({Tags}), 0)", "0", "sum() of text would be an error."),
      ex('ifError(dateAdd({Due date}, 1, {Status}), {Due date})', "2026-03-20"),
      ex('ifError(10 / 0, "n/a")', "empty", "Dividing by 0 gives empty, not an error — use coalesce() for that."),
    ],
    notes: ["Only catches errors while computing; typos like an unknown function still show an error."],
    related: ["coalesce", "if"],
  },
};

// ───────────────────────────── Dates ─────────────────────────────

const DATE: Record<string, FormulaFunctionDetails> = {
  now: {
    params: [],
    returns: "date (with time)",
    examples: [ex("now()", "2026-03-12 09:30"), ex('formatDate(now(), "h:mm A")', '"9:30 AM"'), ex("dateAdd(now, 2, \"hours\")", "2026-03-12 11:30", "The parentheses are optional.")],
    notes: ["Updates when the database is re-computed, so results change over time.", LOCAL_TIME],
    related: ["today", "dateAdd", "fromNow"],
  },
  today: {
    params: [],
    returns: "date",
    examples: [ex("today()", "2026-03-12"), ex("{Due date} < today()", "false", "Is the task overdue?"), ex('formatDate(today, "dddd")', '"Thursday"', "The parentheses are optional.")],
    notes: ["Same as now() with the time set to midnight — better for comparing with date-only properties."],
    related: ["now", "daysUntil", "dateBetween"],
  },
  dateAdd: {
    params: [
      param("date", "date", "The starting date (text like \"2026-03-02\" also works)."),
      param("amount", "number", "How much to add; negative goes back."),
      opt("unit", "text", `${UNIT_TEXT}. Default "days".`),
    ],
    returns: "date",
    examples: [
      ex('dateAdd({Due date}, 1, "week")', "2026-03-27"),
      ex("dateAdd({Start}, 2)", "2026-03-04"),
      ex('dateAdd(parseDate("2026-01-31"), 1, "month")', "2026-02-28", "Month ends are clamped."),
      ex('dateAdd(now(), 90, "minutes")', "2026-03-12 11:00"),
    ],
    notes: [
      "For years, quarters, months, weeks and days the amount is truncated to a whole number; hours, minutes and seconds may be fractional.",
      "An empty amount returns the date unchanged; an empty date gives empty.",
      'An unknown unit is an error, e.g. "fortnights".',
    ],
    related: ["dateSubtract", "addWorkdays", "dateBetween"],
  },
  dateSubtract: {
    params: [
      param("date", "date", "The starting date."),
      param("amount", "number", "How much to take away."),
      opt("unit", "text", `${UNIT_TEXT}. Default "days".`),
    ],
    returns: "date",
    examples: [
      ex('dateSubtract({Due date}, 2, "days")', "2026-03-18"),
      ex('dateSubtract(today(), 1, "month")', "2026-02-12"),
      ex('dateSubtract(parseDate("2024-02-29"), 1, "year")', "2023-02-28", "Leap days clamp to Feb 28."),
    ],
    notes: ["Same as dateAdd() with a negative amount."],
    related: ["dateAdd", "dateBetween"],
  },
  dateBetween: {
    summary: "Counts whole units from date2 to date1 (date1 − date2). Partial units are dropped, so it rounds toward zero.",
    params: [
      param("date1", "date", "The later date, for a positive result."),
      param("date2", "date", "The earlier date."),
      opt("unit", "text", `${UNIT_TEXT}. Default "days".`),
    ],
    returns: "number",
    examples: [
      ex("dateBetween({Due date}, {Start})", "18"),
      ex('dateBetween({Due date}, {Start}, "weeks")', "2"),
      ex("dateBetween({Start}, {Due date})", "-18", "Negative when date1 is earlier."),
      ex("dateBetween({Due date}, now())", "7", "now() has a time (9:30), so only 7 whole days remain — use daysUntil() for calendar days."),
    ],
    notes: ["Either date empty gives empty.", "Day and week counts ignore daylight-saving shifts."],
    related: ["daysUntil", "workdaysBetween", "dateAdd"],
  },
  daysUntil: {
    params: [param("date", "date", "The target date.")],
    returns: "number",
    examples: [
      ex("daysUntil({Due date})", "8"),
      ex('if(daysUntil({Due date}) <= 7, "Due soon", "On track")', '"On track"'),
      ex("daysUntil({Start})", "-10", "Negative for past dates."),
      ex("daysUntil(today())", "0"),
    ],
    notes: ["Counts calendar days between today and the date; times of day are ignored.", "An empty date gives empty."],
    related: ["dateBetween", "fromNow", "today", "workdaysBetween"],
  },
  formatDate: {
    summary: "Turns a date into text using a pattern of tokens, or one of the named styles \"relative\", \"short\", \"long\", \"full\" and \"iso\".",
    params: [
      param("date", "date", "The date to format."),
      opt(
        "pattern",
        "text",
        "Tokens: YYYY/YY year, Q quarter, MMMM/MMM/MM/M month, Do/DD/D day, dddd/ddd/dd weekday, W/WW ISO week, HH/H/hh/h hour, mm minute, ss second, SSS ms, A/a AM/PM; [text] is kept as is. Default \"MMMM D, YYYY\".",
      ),
    ],
    returns: "text",
    examples: [
      ex("formatDate({Due date})", '"March 20, 2026"'),
      ex('formatDate({Due date}, "ddd, MMM Do")', '"Fri, Mar 20th"'),
      ex('formatDate({Due date}, "[Week] W · [Q]Q YYYY")', '"Week 12 · Q1 2026"'),
      ex('formatDate(now(), "relative")', '"Today 9:30 AM"', '"relative" says Today/Tomorrow/In 3 days within a week, else the short date.'),
      ex('formatDate({Due date}, "full")', '"Friday, March 20, 2026"'),
    ],
    notes: [
      'Styles: "short" Mar 20, 2026 · "long" March 20, 2026 · "full" Friday, March 20, 2026 · "iso" 2026-03-20. Times are added when the date has one.',
      "Letters that aren't tokens are kept; put words in [brackets] so their letters aren't read as tokens.",
      "An empty date gives empty.",
    ],
    related: ["parseDate", "fromNow", "format"],
  },
  parseDate: {
    params: [param("text", "text", 'A date such as "2026-03-05", "2026-03-05T14:30" or "March 5, 2026".')],
    returns: "date",
    examples: [
      ex('parseDate("2026-03-05")', "2026-03-05"),
      ex('parseDate("2026-03-05T14:30")', "2026-03-05 14:30"),
      ex('dateBetween({Due date}, parseDate("2026-03-01"))', "19"),
      ex('parseDate("2026-02-30")', "empty", "Impossible dates (and text without a date) give empty."),
    ],
    notes: ["YYYY-MM-DD is read as local midnight, not UTC.", "Most date functions also accept text like \"2026-03-05\" directly."],
    related: ["formatDate", "fromTimestamp", "toNumber"],
  },
  year: {
    params: [param("date", "date", "A date.")],
    returns: "number",
    examples: [ex("year({Due date})", "2026"), ex('"FY" + (year(today()) + 1)', '"FY2027"'), ex("year({Notes})", "empty")],
    notes: ["An empty date gives empty."],
    related: ["month", "quarter", "day"],
  },
  month: {
    params: [param("date", "date", "A date.")],
    returns: "number",
    examples: [ex("month({Due date})", "3"), ex('month(parseDate("2026-12-25"))', "12"), ex("month(today()) == month({Due date})", "true", "Due this month?")],
    notes: ["1 = January … 12 = December (not 0-based).", "An empty date gives empty."],
    related: ["year", "day", "quarter", "formatDate"],
  },
  day: {
    params: [param("date", "date", "A date.")],
    returns: "number",
    examples: [ex("day({Due date})", "20"), ex('day(parseDate("2026-03-05"))', "5"), ex('day(endOf({Due date}, "month"))', "31", "Days in the month.")],
    notes: ["This is the day of the month; use weekday() for the day of the week."],
    related: ["weekday", "month", "year"],
  },
  weekday: {
    params: [param("date", "date", "A date.")],
    returns: "number",
    examples: [ex("weekday({Due date})", "5"), ex("weekday(today())", "4"), ex('weekday(parseDate("2026-03-15"))', "7", "Sunday is 7.")],
    notes: ["1 = Monday … 7 = Sunday.", 'For the name, use formatDate(date, "dddd").'],
    related: ["isWeekend", "day", "formatDate"],
  },
  week: {
    params: [param("date", "date", "A date.")],
    returns: "number",
    examples: [ex("week({Due date})", "12"), ex('week(parseDate("2026-01-01"))', "1"), ex('week(parseDate("2027-01-01"))', "53", "Early January can belong to the last ISO week of the year before.")],
    notes: ["ISO weeks start on Monday; week 1 holds the year's first Thursday."],
    related: ["weekday", "formatDate", "startOf"],
  },
  hour: {
    params: [param("date", "date", "A date with a time.")],
    returns: "number",
    examples: [ex("hour(now())", "9"), ex('hour(parseDate("2026-03-05T14:30"))', "14"), ex("hour({Due date})", "0", "Dates without a time are at midnight.")],
    notes: ["0–23, in local time."],
    related: ["minute", "second", "formatDate"],
  },
  minute: {
    params: [param("date", "date", "A date with a time.")],
    returns: "number",
    examples: [ex("minute(now())", "30"), ex('minute(parseDate("2026-03-05T14:05"))', "5"), ex("minute({Due date})", "0")],
    notes: ["0–59."],
    related: ["hour", "second"],
  },
  second: {
    params: [param("date", "date", "A date with a time.")],
    returns: "number",
    examples: [ex("second(now())", "0"), ex('second(parseDate("2026-03-05T14:30:15"))', "15"), ex("second({Notes})", "empty")],
    notes: ["0–59."],
    related: ["minute", "hour"],
  },
  timestamp: {
    params: [param("date", "date", "A date.")],
    returns: "number",
    examples: [
      ex('timestamp(dateAdd(now(), 1, "hour")) - timestamp(now())', "3600000"),
      ex("timestamp(fromTimestamp(1700000000000))", "1700000000000"),
      ex("timestamp({Notes})", "empty"),
    ],
    notes: ["Milliseconds since January 1, 1970 (UTC), so the value for a given wall-clock date depends on your time zone."],
    related: ["fromTimestamp", "toNumber"],
  },
  fromTimestamp: {
    params: [param("milliseconds", "number", "Milliseconds since January 1, 1970 (UTC).")],
    returns: "date",
    examples: [
      ex("fromTimestamp(timestamp({Due date}))", "2026-03-20"),
      ex("fromTimestamp(timestamp(now()) + 15 * 60 * 1000)", "2026-03-12 09:45"),
      ex("fromTimestamp(empty())", "empty"),
    ],
    notes: [LOCAL_TIME],
    related: ["timestamp", "parseDate"],
  },
  start: {
    summary: "Reads the start of a date range, or the first date of a list. A single date is returned as it is.",
    params: [param("date", "date, date range or list", "A date range from dateRange(), a list of dates, or a date.")],
    returns: "date",
    examples: [
      ex("start(dateRange({Due date}, {Start}))", "2026-03-02"),
      ex("start({Due date})", "2026-03-20", "A plain date is its own start."),
      ex("start([])", "empty"),
    ],
    notes: ["Date properties currently pass only their start date to formulas, so start() and end() of a date property return the same date."],
    related: ["end", "dateRange", "dateStart", "startOf"],
  },
  end: {
    summary: "Reads the end of a date range, or the last date of a list. A single date is returned as it is.",
    params: [param("date", "date, date range or list", "A date range from dateRange(), a list of dates, or a date.")],
    returns: "date",
    examples: [
      ex("end(dateRange({Start}, {Due date}))", "2026-03-20"),
      ex('end([{Start}, "2026-04-01"])', "2026-04-01", "Text items are read as dates."),
      ex("end({Start})", "2026-03-02"),
    ],
    notes: ["Date properties currently pass only their start date to formulas, so end() of a date property is its start."],
    related: ["start", "dateRange", "dateEnd", "endOf"],
  },
  dateRange: {
    params: [param("start", "date", "One end of the range."), param("end", "date", "The other end.")],
    returns: "date range",
    examples: [
      ex("dateRange({Start}, {Due date})", "2026-03-02 → 2026-03-20"),
      ex("dateRange(today(), dateAdd(today(), 7))", "2026-03-12 → 2026-03-19"),
      ex("dateRange({Due date}, {Start})", "2026-03-02 → 2026-03-20", "The earlier date always comes first."),
      ex("dateRange({Start}, empty())", "2026-03-02", "With one date empty, you get the other date on its own."),
    ],
    notes: ["As a formula result it shows like a date property with an end date.", 'typeOf() reports a range as "list".'],
    related: ["start", "end", "dateBetween"],
  },
  quarter: {
    params: [param("date", "date", "A date.")],
    returns: "number",
    examples: [ex("quarter({Due date})", "1"), ex('"Q" + quarter(parseDate("2026-08-15")) + " " + year(today())', '"Q3 2026"'), ex("quarter({Notes})", "empty")],
    notes: ["Calendar quarters: Jan–Mar is 1, Oct–Dec is 4."],
    related: ["month", "year", "startOf"],
  },
  isWeekend: {
    params: [param("date", "date", "A date.")],
    returns: "checkbox",
    examples: [ex('isWeekend(parseDate("2026-03-14"))', "true"), ex("isWeekend({Due date})", "false"), ex("isWeekend({Notes})", "empty", "An empty date gives empty, not false.")],
    notes: ["Saturday and Sunday count as the weekend."],
    related: ["weekday", "addWorkdays", "workdaysBetween"],
  },
  workdaysBetween: {
    params: [param("start", "date", "First day (included)."), param("end", "date", "Last day (included).")],
    returns: "number",
    examples: [
      ex("workdaysBetween({Start}, {Due date})", "15"),
      ex("workdaysBetween(today(), {Due date})", "7", "Working days left, counting today."),
      ex("workdaysBetween({Due date}, {Start})", "-15"),
      ex('workdaysBetween(parseDate("2026-03-14"), parseDate("2026-03-15"))', "0", "A weekend has no workdays."),
    ],
    notes: ["Both ends are counted, so the same weekday gives 1.", "Public holidays aren't known and count as workdays."],
    related: ["addWorkdays", "dateBetween", "isWeekend"],
  },
  addWorkdays: {
    params: [param("date", "date", "The starting date."), param("days", "number", "Weekdays to move; negative goes back.")],
    returns: "date",
    examples: [
      ex("addWorkdays(today(), 3)", "2026-03-17", "Thursday + 3 workdays skips the weekend."),
      ex("addWorkdays({Due date}, 1)", "2026-03-23"),
      ex('addWorkdays(parseDate("2026-03-14"), 1)', "2026-03-16", "From a Saturday, 1 workday is Monday."),
      ex("addWorkdays({Start}, -1)", "2026-02-27"),
    ],
    notes: ["Fractional days are truncated. 0 returns the date unchanged.", "Public holidays aren't skipped."],
    related: ["workdaysBetween", "dateAdd", "isWeekend"],
  },
  startOf: {
    params: [param("date", "date", "A date."), param("unit", "text", '"year", "quarter", "month", "week", "day", "hour", "minute" or "second".')],
    returns: "date",
    examples: [
      ex('startOf({Due date}, "month")', "2026-03-01"),
      ex('startOf(now(), "week")', "2026-03-09", "Weeks start on Monday."),
      ex('startOf(now(), "quarter")', "2026-01-01"),
      ex('startOf(now(), "hour")', "2026-03-12 09:00"),
    ],
    notes: ["An empty date gives empty."],
    related: ["endOf", "today", "week"],
  },
  endOf: {
    summary: "For year, quarter, month and week it returns the last day (at midnight). For day, hour and minute it returns the very last moment.",
    params: [param("date", "date", "A date."), param("unit", "text", '"year", "quarter", "month", "week", "day", "hour", "minute" or "second".')],
    returns: "date",
    examples: [
      ex('endOf({Due date}, "month")', "2026-03-31"),
      ex('endOf(now(), "week")', "2026-03-15", "Weeks end on Sunday."),
      ex('endOf(parseDate("2028-02-10"), "month")', "2028-02-29"),
      ex('endOf(today(), "day")', "2026-03-12 23:59:59.999"),
    ],
    notes: ["An empty date gives empty."],
    related: ["startOf", "day"],
  },
  fromNow: {
    params: [param("date", "date", "The date to describe.")],
    returns: "text",
    examples: [
      ex("fromNow({Due date})", '"in 1 week"'),
      ex("fromNow({Start})", '"1 week ago"'),
      ex("fromNow(dateAdd(today(), 1))", '"tomorrow"'),
      ex('fromNow(dateAdd(now(), 90, "minutes"))', '"in 1 hour"', "Times today are described in minutes or hours."),
    ],
    notes: ["Rounds down to whole units: 8 days is \"in 1 week\".", "Changes as time passes, like now()."],
    related: ["daysUntil", "formatDate", "dateBetween"],
  },
};
DATE.date = aliasOf("date", "day", DATE.day);
DATE.dateStart = aliasOf("dateStart", "start", DATE.start);
DATE.dateEnd = aliasOf("dateEnd", "end", DATE.end);

// ───────────────────────────── Lists ─────────────────────────────

const LIST: Record<string, FormulaFunctionDetails> = {
  at: {
    params: [param("list", "list or text", "A list (or text, for its characters)."), param("index", "number", "0-based position; negative counts from the end.")],
    returns: "same as the item",
    examples: [ex("at([10, 20, 30], -1)", "30"), ex("at({Tags}, 0)", '"Design"'), ex("at({Name}, 0)", '"W"'), ex("at({Tags}, 5)", "empty", "Past the end gives empty.")],
    notes: ["0 is the first item; -1 is the last."],
    related: ["first", "last", "slice", "indexOf"],
  },
  first: {
    params: [param("list", "list", "A list.")],
    returns: "same as the item",
    examples: [ex("first([3, 4])", "3"), ex("first({Tags})", '"Design"'), ex("first(sort([{Due date}, {Start}]))", "2026-03-02"), ex("first([])", "empty")],
    notes: ["Text isn't a list here — use left(text, 1)."],
    related: ["last", "at", "find"],
  },
  last: {
    params: [param("list", "list", "A list.")],
    returns: "same as the item",
    examples: [ex("last([3, 4])", "4"), ex("last({Tags})", '"Urgent"'), ex('last(split({Name}, " "))', '"refresh"'), ex("last([])", "empty")],
    related: ["first", "at"],
  },
  sort: {
    summary: "Sorts ascending: numbers, then text (alphabetical), then dates, then checkboxes, with empty items last. With a key expression, items are ordered by that key instead.",
    params: [param("list", "list", "The list to sort."), opt("key", "expression", "What to sort by, using `current` (and `index`). Use -current for descending numbers.")],
    returns: "list",
    examples: [
      ex("sort([3, 1, 2])", "[1, 2, 3]"),
      ex("sort({Tags})", '["Design", "Urgent", "Web"]'),
      ex("sort([12, 3, 7], -current)", "[12, 7, 3]", "Descending."),
      ex("sort({Tags}, length(current))", '["Web", "Design", "Urgent"]', "Ties keep their original order."),
    ],
    notes: ["For descending text, use reverse(sort(list)).", "Text sorts alphabetically, ignoring case differences where possible."],
    related: ["reverse", "unique", "min", "max"],
  },
  reverse: {
    params: [param("list", "list or text", "A list, or text to reverse character by character.")],
    returns: "same as input (list or text)",
    examples: [ex("reverse([1, 2, 3])", "[3, 2, 1]"), ex("reverse(sort({Tags}))", '["Web", "Urgent", "Design"]'), ex('reverse("abc")', '"cba"'), ex("reverse({Notes})", "empty")],
    related: ["sort"],
  },
  unique: {
    params: [param("list", "list", "A list.")],
    returns: "list",
    examples: [ex("unique([1, 2, 1])", "[1, 2]"), ex('unique(concat({Tags}, ["Web", "Ops"]))', '["Design", "Web", "Urgent", "Ops"]'), ex('unique([1, "1", "a", "A"])', '[1, "1", "a", "A"]', "Types and letter case must match to count as duplicates.")],
    notes: ["Keeps the first copy of each item, in the original order."],
    related: ["sort", "compact", "count"],
  },
  flat: {
    params: [param("list", "list", "A list that contains lists."), opt("depth", "number", "How many levels to flatten (default 1).")],
    returns: "list",
    examples: [
      ex("flat([[1, 2], [3]])", "[1, 2, 3]"),
      ex('flat(map({Tags}, [current, lower(current)]))', '["Design", "design", "Web", "web", "Urgent", "urgent"]'),
      ex("flat([1, [2, [3, [4]]]], 2)", "[1, 2, 3, [4]]"),
    ],
    related: ["concat", "chunk", "map"],
  },
  map: {
    params: [param("list", "list", "The list to transform."), param("expression", "expression", "The new value for each item, using `current` and `index`.")],
    returns: "list",
    examples: [
      ex("map([1, 2, 3], current * 10)", "[10, 20, 30]"),
      ex("map({Tags}, upper(current))", '["DESIGN", "WEB", "URGENT"]'),
      ex('map({Tags}, index + 1 + ". " + current)', '["1. Design", "2. Web", "3. Urgent"]'),
      ex("map([], current * 2)", "[]"),
    ],
    notes: ["`index` is 0-based."],
    related: ["filter", "reduce", "current", "index"],
  },
  filter: {
    params: [param("list", "list", "The list to filter."), param("condition", "expression", "Kept when true, using `current` and `index`.")],
    returns: "list",
    examples: [
      ex("filter([1, 5, 9], current > 2)", "[5, 9]"),
      ex('filter({Tags}, current != "Urgent")', '["Design", "Web"]'),
      ex("filter({Tags}, index > 0)", '["Web", "Urgent"]'),
      ex("filter([1, 2], current > 5)", "[]"),
    ],
    related: ["map", "find", "count", "compact"],
  },
  find: {
    params: [param("list", "list", "The list to search."), param("condition", "expression", "Tested for each item with `current` and `index`.")],
    returns: "same as the item",
    examples: [ex("find([1, 5, 9], current > 2)", "5"), ex('find({Tags}, startsWith(current, "W"))', '"Web"'), ex("find([1, 2], current > 5)", "empty")],
    related: ["findIndex", "filter", "some"],
  },
  findIndex: {
    params: [param("list", "list", "The list to search."), param("condition", "expression", "Tested for each item with `current` and `index`.")],
    returns: "number",
    examples: [ex("findIndex([1, 5, 9], current > 2)", "1"), ex('findIndex({Tags}, current == "Web")', "1"), ex('findIndex({Tags}, current == "Ops")', "-1")],
    notes: ["0-based; -1 when nothing matches."],
    related: ["find", "indexOf"],
  },
  some: {
    params: [param("list", "list", "The list to check."), param("condition", "expression", "Tested for each item with `current` and `index`.")],
    returns: "checkbox",
    examples: [ex("some([1, 5], current > 4)", "true"), ex('some({Tags}, current == "Urgent")', "true"), ex("some([], true)", "false", "An empty list has no matching item.")],
    notes: ["Stops at the first match."],
    related: ["every", "includes", "find"],
  },
  every: {
    params: [param("list", "list", "The list to check."), param("condition", "expression", "Tested for each item with `current` and `index`.")],
    returns: "checkbox",
    examples: [ex("every([1, 5], current > 4)", "false"), ex("every({Tags}, length(current) >= 3)", "true"), ex("every([], false)", "true", "An empty list passes every check.")],
    related: ["some", "filter"],
  },
  includes: {
    params: [param("list", "list or text", "A list to look in, or text to search."), param("value", "any", "The value to look for.")],
    returns: "checkbox",
    examples: [ex('includes(["a", "b"], "b")', "true"), ex('includes({Tags}, "Web")', "true"), ex('includes({Tags}, "web")', "false", "Items must match exactly, including case."), ex('includes({Name}, "site")', "true")],
    notes: ["Same as contains()."],
    related: ["contains", "some", "indexOf"],
  },
  count: {
    params: [param("list", "list", "The list to count."), opt("condition", "expression", "Only count items where this is true, using `current` and `index`.")],
    returns: "number",
    examples: [
      ex("count([1, 5, 9], current > 2)", "2"),
      ex("count({Tags})", "3"),
      ex('count([1, empty(), "", 0])', "2", "Without a condition, empty items aren't counted (0 is a value)."),
      ex("count({Tags}, length(current) > 3)", "2"),
    ],
    related: ["length", "filter", "sum"],
  },
  range: {
    summary: "Makes a list of numbers from `start` up to, but not including, `end`. With one argument it counts from 0.",
    params: [
      param("start", "number", "First number (or the end, when it's the only argument)."),
      opt("end", "number", "Stop before this number."),
      opt("step", "number", "Gap between numbers (default 1; negative counts down)."),
    ],
    returns: "list of numbers",
    examples: [
      ex("range(1, 4)", "[1, 2, 3]"),
      ex("range(5)", "[0, 1, 2, 3, 4]"),
      ex("range(10, 0, -3)", "[10, 7, 4, 1]"),
      ex('map(range({Quantity}), "Seat " + (current + 1))', '["Seat 1", "Seat 2", "Seat 3", "Seat 4"]'),
    ],
    notes: ["A step of 0 is an error. A range that can't reach its end is empty: range(3, 1) is []."],
    related: ["map", "repeat"],
  },
  zip: {
    params: [many("lists", "list", "Lists to pair up.")],
    returns: "list of lists",
    examples: [
      ex('zip([1, 2], ["a", "b"])', '[[1, "a"], [2, "b"]]'),
      ex("zip({Tags}, [1, 2, 3])", '[["Design", 1], ["Web", 2], ["Urgent", 3]]'),
      ex('zip([1, 2, 3], ["a"])', '[[1, "a"]]', "Stops at the shortest list."),
    ],
    related: ["map", "chunk", "flat"],
  },
  chunk: {
    params: [param("list", "list", "The list to split."), param("size", "number", "Items per group (at least 1).")],
    returns: "list of lists",
    examples: [
      ex("chunk([1, 2, 3, 4, 5], 2)", "[[1, 2], [3, 4], [5]]"),
      ex("chunk({Tags}, 2)", '[["Design", "Web"], ["Urgent"]]'),
      ex("chunk({Tags}, 0)", "chunk() size must be at least 1", "Shows an error: the size must be 1 or more."),
    ],
    notes: ["The last group holds whatever is left over."],
    related: ["slice", "zip", "flat"],
  },
  compact: {
    params: [param("list", "list", "A list.")],
    returns: "list",
    examples: [
      ex('compact([1, "", 2, empty()])', "[1, 2]"),
      ex('compact(split("Design,,Web,", ","))', '["Design", "Web"]'),
      ex("compact([0, false, []])", "[0, false]", "0 and false are values and are kept."),
    ],
    related: ["filter", "count", "isEmpty"],
  },
  reduce: {
    summary: "Combines a list into one value. For each item, `acc` is the result so far and `current` the item; the expression's result becomes the new `acc`.",
    params: [
      param("list", "list", "The list to combine."),
      param("expression", "expression", "The next result, using `acc`, `current` and `index`."),
      opt("initial", "any", "The starting `acc` (default empty)."),
    ],
    returns: "same as expression",
    examples: [
      ex("reduce([1, 2, 3], acc + current, 0)", "6"),
      ex("reduce({Tags}, acc + length(current), 0)", "15", "Total characters across all tags."),
      ex("reduce([4, 9, 2], max(acc, current))", "9", "Without an initial value, acc starts empty."),
      ex("reduce([], acc + current, 10)", "10", "An empty list returns the initial value."),
    ],
    related: ["map", "sum", "filter"],
  },
  current: {
    summary: "Inside map(), filter(), find(), findIndex(), some(), every(), sort(), count() and reduce(), `current` is the item being looked at.",
    params: [],
    returns: "same as the item",
    examples: [
      ex("map([1, 2], current + 1)", "[2, 3]"),
      ex('filter({Tags}, current != "Web")', '["Design", "Urgent"]'),
      ex("current + 1", '"current" only works inside map(), filter(), find(), findIndex(), some(), every(), sort(), count() or reduce()', "Shows an error: current has no meaning outside a list function."),
    ],
    notes: ["In nested list functions, `current` is the item of the innermost one; save the outer item with let() first."],
    related: ["index", "map", "filter", "reduce"],
  },
  index: {
    summary: "The 0-based position of `current` inside map(), filter(), find(), findIndex(), some(), every(), sort(), count() and reduce().",
    params: [],
    returns: "number",
    examples: [
      ex("map([5, 5], index)", "[0, 1]"),
      ex("filter([10, 20, 30, 40], mod(index, 2) == 0)", "[10, 30]", "Every other item."),
      ex('map({Tags}, (index + 1) + ") " + current)', '["1) Design", "2) Web", "3) Urgent"]'),
    ],
    notes: ["Starts at 0; add 1 for human numbering."],
    related: ["current", "map", "at"],
  },
};

// ───────────────────────────── Type ─────────────────────────────

const TYPE: Record<string, FormulaFunctionDetails> = {
  typeOf: {
    params: [param("value", "any", "The value to inspect.")],
    returns: "text",
    examples: [
      ex('typeOf("hi")', '"text"'),
      ex("typeOf({Due date})", '"date"'),
      ex("typeOf({Tags})", '"list"'),
      ex("typeOf({Notes})", '"empty"'),
    ],
    notes: ['One of "number", "text", "checkbox", "date", "list" or "empty". Styled text is "text"; a date range is "list".'],
    related: ["isEmpty", "toNumber", "toText"],
  },
  toNumber: {
    params: [param("value", "any", "The value to convert.")],
    returns: "number",
    examples: [
      ex('toNumber("1,234.5")', "1234.5"),
      ex('toNumber("$25") * {Quantity}', "100", "Currency signs and spaces are ignored."),
      ex('toNumber("50%")', "0.5"),
      ex('toNumber("12 apples")', "empty", "Text that isn't a number gives empty."),
      ex("toNumber({Done})", "0", "Checkboxes become 1 or 0."),
    ],
    notes: ["Dates become milliseconds since 1970 (like timestamp()).", "Lists give empty."],
    related: ["toText", "toBoolean", "timestamp"],
  },
  toText: {
    params: [param("value", "any", "The value to convert.")],
    returns: "text",
    examples: [ex("toText(3.5)", '"3.5"'), ex('toText({Price}) + " USD"', '"25 USD"'), ex("toText({Due date})", '"Mar 20, 2026"'), ex("toText({Notes})", '""')],
    notes: ["Same as format(). Lists are joined with \", \"; styling is dropped."],
    related: ["format", "toNumber", "formatDate", "formatNumber"],
  },
  toBoolean: {
    params: [param("value", "any", "The value to convert.")],
    returns: "checkbox",
    examples: [ex('toBoolean("yes")', "true"), ex('toBoolean("No")', "false", 'Text "false", "no", "off" and "0" are false, in any case.'), ex("toBoolean({Tags})", "true"), ex("toBoolean(0)", "false")],
    notes: ["Empty, 0, \"\" and [] are false; any date is true."],
    related: ["toNumber", "not", "if"],
  },
};

// ───────────────────────────── Properties & operators ─────────────────────────────

const LANGUAGE: Record<string, FormulaFunctionDetails> = {
  prop: {
    summary: "Reads a property of the same row by its exact name. The name must be written in quotes.",
    params: [param("name", "text", "The property name, in quotes.")],
    returns: "same as the property (number, text, checkbox, date or list)",
    examples: [
      ex('prop("Price") * 2', "50"),
      ex('prop("Due date")', "2026-03-20"),
      ex('prop("Tags")', '["Design", "Web", "Urgent"]', "Multi-select gives a list of option names."),
      ex('prop("Budgte")', 'No property named "Budgte"', "Shows an error: the name must match a property exactly."),
    ],
    notes: [
      "Select and status give the option name as text; multi-select gives a list of names; empty cells are empty.",
      "Renaming a property updates formulas that use it.",
    ],
    related: ["{Name}"],
  },
  "{Name}": {
    summary: "Shorthand for prop(\"Name\"): write the property name in curly braces. Spaces are fine, like {Due date}.",
    params: [],
    returns: "same as the property",
    examples: [
      ex("{Price} * {Quantity}", "100"),
      ex('{Name} + " · " + {Status}', '"Website refresh · In progress"'),
      ex("dateBetween({Due date}, {Start})", "18"),
      ex("{Tags}.length()", "3", "Any function can be called after a value with a dot: x.f(y) means f(x, y)."),
    ],
    notes: ["Names containing } need the prop(\"…\") form."],
    related: ["prop"],
  },
  "+ - * / % ^": {
    summary: "Arithmetic. + also joins text (when either side is text) and two lists. ^ is a power and groups right-to-left.",
    params: [param("a", "number, text or list", "Left side."), param("b", "number, text or list", "Right side.")],
    returns: "number (text or list for +)",
    examples: [
      ex('"Total: " + (2 + 3) * 4', '"Total: 20"'),
      ex("{Budget} - {Price} * {Quantity}", "1100"),
      ex("10 / 0", "empty", "Dividing by 0 (or % 0) gives empty."),
      ex("{Notes} + 5", "5", "Empty counts as 0 next to a number."),
      ex("{Due date} + 1", '"+" can\'t be used on a date — use dateAdd() or dateSubtract()', "Shows an error: use dateAdd() for date maths."),
    ],
    notes: [
      "* / % bind tighter than + -; ^ binds tightest, and -2 ^ 2 is -4.",
      "Results are rounded to 12 significant digits to hide floating-point noise: 0.1 + 0.2 is 0.3.",
      "% keeps the sign of the left side: -7 % 3 is -1.",
    ],
    related: ["mod", "pow", "concat", "dateAdd"],
  },
  "== != > < >= <=": {
    summary: "Comparisons give a checkbox. = and <> also work for == and !=.",
    params: [param("a", "any", "Left side."), param("b", "any", "Right side.")],
    returns: "checkbox",
    examples: [
      ex("{Price} >= 100", "false"),
      ex('{Status} == "In progress"', "true"),
      ex("{Due date} > today()", "true"),
      ex("{Notes} > 5", "false", "Ordering against empty is always false."),
      ex('{Price} > "10"', '">" can\'t compare number with text', "Shows an error: compare like with like (toNumber() can help)."),
    ],
    notes: [
      "Text comparison is case-sensitive for == and alphabetical for < and >.",
      "== never errors: values of different types are simply unequal, and empty equals \"\" and [].",
    ],
    related: ["equal", "unequal", "between"],
  },
  "and or not": {
    summary: "Combine conditions. && || ! also work. and binds tighter than or; and/or stop as soon as the answer is known.",
    params: [param("a", "any", "A condition."), param("b", "any", "Another condition (not takes only one).")],
    returns: "checkbox",
    examples: [
      ex('{Done} or {Status} == "In progress"', "true"),
      ex("not {Done} and {Price} > 10", "true"),
      ex("{Tags} && !{Notes}", "true", "Non-empty values are true; empty, 0, \"\" and [] are false."),
      ex("not {Price} > 10", '">" can\'t compare checkbox with number', "Shows an error: not applies to {Price} alone. Write not ({Price} > 10)."),
    ],
    related: ["and", "or", "not", "if"],
  },
  "? :": {
    summary: "An inline if: condition ? then : else. It has the lowest precedence, so the condition doesn't need parentheses.",
    params: [param("condition", "any", "Tested for truth."), param("then", "any", "Result when true."), param("else", "any", "Result when false.")],
    returns: "same as then / else",
    examples: [
      ex('{Price} > 20 ? "Premium" : "Standard"', '"Premium"'),
      ex('{Done} ? "✅" : daysUntil({Due date}) < 0 ? "⚠️ Late" : "🕒 Open"', '"🕒 Open"', "Chains read like else-if."),
      ex('{Notes} ? {Notes} : "—"', '"—"'),
    ],
    notes: ["The else part is required; use if() to leave it out."],
    related: ["if", "ifs", "switch"],
  },
};

/** Every entry of FORMULA_FUNCTIONS, by its exact name. */
export const FORMULA_DETAILS: Record<string, FormulaFunctionDetails> = {
  ...LANGUAGE,
  ...MATH,
  ...TEXT,
  ...LOGIC,
  ...DATE,
  ...LIST,
  ...TYPE,
};

const BY_LOWER = new Map(Object.entries(FORMULA_DETAILS).map(([k, v]) => [k.toLowerCase(), v]));

/** Details for a FORMULA_FUNCTIONS name, case-insensitively. */
export function detailsOf(name: string): FormulaFunctionDetails | undefined {
  return BY_LOWER.get(name.trim().toLowerCase());
}

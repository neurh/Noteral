import { describe, it, expect } from "vitest";
import {
  compileFormula,
  completionsAt,
  evaluateFormula,
  formatFormulaValue,
  FORMULA_FUNCTIONS,
  renameRefs,
  tokenize,
  typeOfValue,
  type FormulaValue,
} from "./formula";
import { formatNumber } from "./database";

const NOW = new Date(2024, 2, 15, 10, 30, 0); // Fri Mar 15 2024, 10:30 local

function ctx(props: Record<string, FormulaValue> = {}) {
  return {
    now: NOW,
    prop(name: string): FormulaValue {
      if (!(name in props)) throw new Error(`No property named "${name}"`);
      return props[name];
    },
  };
}

/** Evaluate and fail loudly on any error. */
function run(src: string, props?: Record<string, FormulaValue>): FormulaValue {
  const r = evaluateFormula(src, ctx(props));
  if (r.error) throw new Error(`${src}: ${r.error}`);
  return r.value;
}
const err = (src: string, props?: Record<string, FormulaValue>) => evaluateFormula(src, ctx(props)).error;
function compileErr(src: string) {
  const c = compileFormula(src);
  if (c.ok) throw new Error(`expected a compile error for ${src}`);
  return c.error;
}
const d = (y: number, m: number, day: number, h = 0, min = 0, s = 0) => new Date(y, m - 1, day, h, min, s);

describe("operators", () => {
  it("follows precedence and associativity", () => {
    expect(run("1 + 2 * 3")).toBe(7);
    expect(run("(1 + 2) * 3")).toBe(9);
    expect(run("10 - 4 - 3")).toBe(3);
    expect(run("2 ^ 3 ^ 2")).toBe(512);
    expect(run("-2 ^ 2")).toBe(-4);
    expect(run("2 * 3 % 4")).toBe(2);
    expect(run("1 < 2 == true")).toBe(true);
    expect(run("true or false and false")).toBe(true);
    expect(run("not true or true")).toBe(true);
    expect(run("!(1 > 2)")).toBe(true);
    expect(run('1 > 2 ? "a" : "b"')).toBe("b");
    expect(run("false ? 1 : true ? 2 : 3")).toBe(2);
    expect(run("1 + 1 == 2 and 3 > 2 ? 10 : 20")).toBe(10);
  });

  it("supports aliases and comments", () => {
    expect(run("1 = 1")).toBe(true);
    expect(run("1 <> 2")).toBe(true);
    expect(run("true && false || true")).toBe(true);
    expect(run("1 /* one */ + // plus\n 2")).toBe(3);
  });

  it("concatenates text and lists", () => {
    expect(run('"a" + 1')).toBe("a1");
    expect(run('1 + "a"')).toBe("1a");
    expect(run('"x" + true')).toBe("xtrue");
    expect(run("[1, 2] + [3]")).toEqual([1, 2, 3]);
    expect(run('"line\\n" + \'it\\\'s\'')).toBe("line\nit's");
  });

  it("does tidy arithmetic", () => {
    expect(run("0.1 + 0.2")).toBe(0.3);
    expect(run("1e3 + 2.5")).toBe(1002.5);
    expect(run("10 / 0")).toBe(null);
    expect(run("10 % 0")).toBe(null);
    expect(run("empty() + 2")).toBe(2);
    expect(run("0.1 * 3 == 0.3")).toBe(true);
  });

  it("explains type errors", () => {
    expect(err('"a" / 2')).toBe('"/" needs numbers, got text');
    expect(err('parseDate("2024-01-01") + 1')).toMatch(/dateAdd/);
    expect(err('1 < "a"')).toBe('"<" can\'t compare number with text');
  });

  it("compares deeply", () => {
    expect(run("[1, [2, 3]] == [1, [2, 3]]")).toBe(true);
    expect(run('parseDate("2024-01-01") == parseDate("2024-01-01")')).toBe(true);
    expect(run('parseDate("2024-01-02") > parseDate("2024-01-01")')).toBe(true);
    expect(run('"b" > "a"')).toBe(true);
    expect(run("1 == 1.0000000000001")).toBe(true);
  });
});

describe("properties", () => {
  it("reads prop() and {} refs and lists them", () => {
    const c = compileFormula('prop("Price") * {Qty} + {Price} + prop(\'Tax rate\')');
    expect(c.ok && c.refs).toEqual(["Price", "Qty", "Tax rate"]);
    expect(run('prop("Price") * {Qty}', { Price: 5, Qty: 3 })).toBe(15);
    expect(run("{ Big Number } + 1", { "Big Number": 9 })).toBe(10);
  });

  it("propagates errors from ctx.prop", () => {
    expect(err('prop("Statsu")', {})).toBe('No property named "Statsu"');
  });

  it("supports method chaining", () => {
    expect(run('prop("Tags").length()', { Tags: ["a", "b"] })).toBe(2);
    expect(run("{Title}.upper()", { Title: "hi" })).toBe("HI");
    expect(run('{Title}.trim().upper().slice(0, 2) + "!"', { Title: "  hello " })).toBe("HE!");
    expect(run("{Tags}.length", { Tags: [1, 2, 3] })).toBe(3);
    expect(run("[3, 1, 2].sort().map(current * 2)")).toEqual([2, 4, 6]);
    expect(run("(-3).abs()")).toBe(3);
    expect(run("2.5.round()")).toBe(3);
  });
});

describe("laziness and scope", () => {
  it("does not evaluate untaken branches", () => {
    expect(run('if(true, 1, "a" / 2)')).toBe(1);
    expect(run('if(false, "a" / 2)')).toBe(null);
    expect(run('true ? 1 : "a" / 2')).toBe(1);
    expect(run('false and ("a" / 2 > 1)')).toBe(false);
    expect(run('true or ("a" / 2 > 1)')).toBe(true);
    expect(run('and(false, "a" / 2)')).toBe(false);
    expect(run('or(true, "a" / 2)')).toBe(true);
    expect(run('ifs(false, "a" / 2, true, "ok", "a" / 2)')).toBe("ok");
    expect(run('ifs(false, 1, "else")')).toBe("else");
    expect(run('coalesce(empty(), "", "x", "a" / 2)')).toBe("x");
  });

  it("binds let and lets", () => {
    expect(run("let(x, 4, x * x)")).toBe(16);
    expect(run("lets(a, 2, b, a + 1, a * b)")).toBe(6);
    expect(run("let(x, 1, let(x, x + 1, x))")).toBe(2);
    expect(run("let(n, {N}, n * 2)", { N: 21 })).toBe(42);
  });

  it("provides current and index", () => {
    expect(run("map([1, 2, 3], current * 10)")).toEqual([10, 20, 30]);
    expect(run("map([5, 5], index)")).toEqual([0, 1]);
    expect(run("filter(prop(\"Scores\"), current > 50)", { Scores: [10, 60, 90] })).toEqual([60, 90]);
    expect(run("find([1, 5, 9], current > 2)")).toBe(5);
    expect(run("findIndex([1, 5, 9], current > 2)")).toBe(1);
    expect(run("findIndex([1], current > 2)")).toBe(-1);
    expect(run("some([1, 5], current > 4)")).toBe(true);
    expect(run("every([1, 5], current > 4)")).toBe(false);
    expect(run("count([1, 5, 9], current > 2)")).toBe(2);
    expect(run('count([1, "", empty(), 0])')).toBe(2);
    expect(run("map([1, 2], map([10, 20], current + index))")).toEqual([[10, 21], [10, 21]]);
    expect(run("let(k, 3, map([1, 2], current * k))")).toEqual([3, 6]);
  });

  it("sorts stably, optionally by key", () => {
    expect(run("sort([3, 1, 2])")).toEqual([1, 2, 3]);
    expect(run("sort([10, 9, 100])")).toEqual([9, 10, 100]);
    expect(run('sort(["b", "a", "C"])')).toEqual(["a", "b", "C"]);
    expect(run("sort([3, 1, 2], -current)")).toEqual([3, 2, 1]);
    expect(run('sort([[1, "a"], [0, "b"], [1, "c"]], at(current, 0))')).toEqual([[0, "b"], [1, "a"], [1, "c"]]);
    expect(run('sort([parseDate("2024-02-01"), parseDate("2024-01-01")])')).toEqual([d(2024, 1, 1), d(2024, 2, 1)]);
    expect(run("sort([2, empty(), 1])")).toEqual([1, 2, null]);
  });
});

describe("math functions", () => {
  it("computes", () => {
    expect(run("abs(-3)")).toBe(3);
    expect(run("round(2.5)")).toBe(3);
    expect(run("round(-2.5)")).toBe(-3);
    expect(run("round(1.005, 2)")).toBe(1.01);
    expect(run("round(1234, -2)")).toBe(1200);
    expect([run("floor(2.7)"), run("ceil(2.1)"), run("trunc(-2.7)")]).toEqual([2, 3, -2]);
    expect(run("min(4, 2, 8)")).toBe(2);
    expect(run("max([4, 2], 8)")).toBe(8);
    expect(run("sum([1, 2], 3)")).toBe(6);
    expect(run("sum([])")).toBe(0);
    expect(run("mean(1, 2, 6)")).toBe(3);
    expect(run("average([2, 4])")).toBe(3);
    expect(run("median([3, 1, 4, 2])")).toBe(2.5);
    expect(run("median(5, 1, 3)")).toBe(3);
    expect([run("mod(7, 3)"), run("mod(-7, 3)"), run("pow(2, 10)")]).toEqual([1, -1, 1024]);
    expect([run("sqrt(16)"), run("cbrt(27)"), run("ln(e())"), run("log10(1000)"), run("log2(8)")]).toEqual([4, 3, 1, 3, 3]);
    expect([run("sign(-5)"), run("exp(0)")]).toEqual([-1, 1]);
    expect(run("pi()")).toBe(3.14159265359);
    expect(run("sqrt(-1)")).toBe(null);
    expect(run('max(parseDate("2024-01-01"), parseDate("2024-05-01"))')).toEqual(d(2024, 5, 1));
  });
});

describe("text functions", () => {
  it("transforms text", () => {
    expect(run('concat("a", "b", 1)')).toBe("ab1");
    expect(run("concat([1], [2, 3])")).toEqual([1, 2, 3]);
    expect(run('join(["a", "b"], "-")')).toBe("a-b");
    expect(run("join([1, 2])")).toBe("1, 2");
    expect([run('length("hello")'), run("length([1, 2])"), run("length(empty())")]).toEqual([5, 2, 0]);
    expect([run('lower("ABC")'), run('upper("abc")'), run('trim("  hi ")')]).toEqual(["abc", "ABC", "hi"]);
    expect(run('capitalize("hello world")')).toBe("Hello world");
    expect(run('replace("a-b-c", "-", "+")')).toBe("a+b-c");
    expect(run('replaceAll("a-b-c", "-", "+")')).toBe("a+b+c");
    expect(run('replace("a1b22", "/\\\\d+/", "#")')).toBe("a#b22");
    expect(run('replaceAll("a1b22", "/\\\\d+/", "#")')).toBe("a#b#");
    expect(run('replaceAll("Cat cat", "/cat/i", "dog")')).toBe("dog dog");
    expect(run('replace("a.b", ".", "$&$&")')).toBe("a$&$&b");
    expect(run('contains("Hello", "ell")')).toBe(true);
    expect(run('contains(["a", "b"], "c")')).toBe(false);
    expect(run('test("ID-42", "\\\\d+")')).toBe(true);
    expect(run('test("abc", "/^ABC$/i")')).toBe(true);
    expect(run('match("a1b22", "\\\\d+")')).toEqual(["1", "22"]);
    expect(run('match("abc", "\\\\d")')).toEqual([]);
    expect(run('slice("Hello", 1, 3)')).toBe("el");
    expect(run("slice([1, 2, 3], -2)")).toEqual([2, 3]);
    expect(run('substring("Hello", 3)')).toBe("lo");
    expect(run('split("a,b,c", ",")')).toEqual(["a", "b", "c"]);
    expect(run('split("a, b;c", "/[,;]\\\\s*/")')).toEqual(["a", "b", "c"]);
    expect([run('startsWith("Noteral", "Note")'), run('endsWith("x.pdf", ".pdf")')]).toEqual([true, true]);
    expect(run('padStart("7", 3, "0")')).toBe("007");
    expect(run('padEnd("ab", 4, ".")')).toBe("ab..");
    expect(run('repeat("ab", 3)')).toBe("ababab");
    expect([run("format(42)"), run("toText(true)"), run("toText([1, 2])")]).toEqual(["42", "true", "1, 2"]);
    expect([run('indexOf("hello", "l")'), run("indexOf([1, 2], 2)")]).toEqual([2, 1]);
  });

  it("reports bad regexes", () => {
    expect(err('test("a", "(")')).toMatch(/^test\(\): invalid pattern/);
  });
});

describe("logic & type functions", () => {
  it("evaluates", () => {
    expect(run("not(true)")).toBe(false);
    expect(run("empty()")).toBe(null);
    expect(run("empty")).toBe(null);
    expect(run("null")).toBe(null);
    expect([run('empty("")'), run("empty(0)"), run("isEmpty([])")]).toEqual([true, false, true]);
    expect(run("equal([1, 2], [1, 2])")).toBe(true);
    expect(run('unequal(1, "1")')).toBe(true);
    expect(run('typeOf("hi")')).toBe("text");
    expect(run("typeOf(today())")).toBe("date");
    expect(run("typeOf(empty())")).toBe("empty");
    expect(run('toNumber("1,234.5")')).toBe(1234.5);
    expect(run('toNumber("50%")')).toBe(0.5);
    expect(run('toNumber("$12")')).toBe(12);
    expect(run("toNumber(true)")).toBe(1);
    expect(run('toNumber("abc")')).toBe(null);
    expect(run("toNumber(fromTimestamp(1000))")).toBe(1000);
    expect([run('toBoolean("no")'), run('toBoolean("yes")'), run("toBoolean(0)")]).toEqual([false, true, false]);
  });

  it("maps JS values to types", () => {
    expect([null, 1, "a", true, new Date(), [1]].map((v) => typeOfValue(v as FormulaValue))).toEqual([
      "empty", "number", "text", "checkbox", "date", "list",
    ]);
  });
});

describe("list functions", () => {
  it("works with lists", () => {
    expect(run("at([10, 20, 30], -1)")).toBe(30);
    expect(run("at([10, 20, 30], 5)")).toBe(null);
    expect([run("first([3, 4])"), run("last([3, 4])"), run("first([])")]).toEqual([3, 4, null]);
    expect(run("reverse([1, 2, 3])")).toEqual([3, 2, 1]);
    expect(run('reverse("abc")')).toBe("cba");
    expect(run('unique([1, 2, 1, "1", [1], [1]])')).toEqual([1, 2, "1", [1]]);
    expect(run("flat([[1, 2], [3, [4]]])")).toEqual([1, 2, 3, [4]]);
    expect(run("flat([[1, [2, [3]]]], 5)")).toEqual([1, 2, 3]);
    expect(run('includes(["a", "b"], "b")')).toBe(true);
    expect(run("range(1, 4)")).toEqual([1, 2, 3]);
    expect(run("range(3)")).toEqual([0, 1, 2]);
    expect(run("range(10, 0, -5)")).toEqual([10, 5]);
    expect(run("sum(range(101))")).toBe(5050);
  });
});

describe("dates", () => {
  it("uses the injected clock", () => {
    expect(run("now()")).toEqual(NOW);
    expect(run("today()")).toEqual(d(2024, 3, 15));
    expect(run("today")).toEqual(d(2024, 3, 15));
    expect(run('daysUntil(parseDate("2024-03-20"))')).toBe(5);
    expect(run('daysUntil(parseDate("2024-03-14"))')).toBe(-1);
  });

  it("adds and subtracts with month-end clamping", () => {
    expect(run('dateAdd(parseDate("2024-01-31"), 1, "months")')).toEqual(d(2024, 2, 29));
    expect(run('dateAdd(parseDate("2023-01-31"), 1, "month")')).toEqual(d(2023, 2, 28));
    expect(run('dateAdd(parseDate("2024-02-29"), 1, "years")')).toEqual(d(2025, 2, 28));
    expect(run('dateAdd(parseDate("2024-01-15"), 1, "quarter")')).toEqual(d(2024, 4, 15));
    expect(run('dateSubtract(parseDate("2024-03-31"), 1, "months")')).toEqual(d(2024, 2, 29));
    expect(run('dateAdd(parseDate("2024-12-30"), 3, "days")')).toEqual(d(2025, 1, 2));
    expect(run('dateAdd(parseDate("2024-03-01"), 2, "weeks")')).toEqual(d(2024, 3, 15));
    expect(run('dateAdd(parseDate("2024-03-01T23:30"), 90, "minutes")')).toEqual(d(2024, 3, 2, 1, 0));
    expect(run('dateAdd({Due}, 1, "day")', { Due: null })).toBe(null);
    expect(err('dateAdd(today(), 1, "fortnights")')).toMatch(/unknown unit "fortnights"/);
  });

  it("measures between dates, truncated toward zero", () => {
    const db = (a: string, b: string, u: string) => run(`dateBetween(parseDate("${a}"), parseDate("${b}"), "${u}")`);
    expect(db("2024-03-10", "2024-03-01", "days")).toBe(9);
    expect(db("2024-03-01", "2024-03-10", "days")).toBe(-9);
    expect(db("2024-03-01", "2024-01-31", "months")).toBe(1);
    expect(db("2024-02-29", "2024-01-31", "months")).toBe(1);
    expect(db("2024-02-28", "2024-01-31", "months")).toBe(0);
    expect(db("2024-01-01", "2024-03-01", "months")).toBe(-2);
    expect(db("2025-01-15", "2024-01-16", "years")).toBe(0);
    expect(db("2025-01-16", "2024-01-16", "years")).toBe(1);
    expect(db("2024-01-15", "2024-01-01", "weeks")).toBe(2);
    expect(db("2024-01-01", "2024-01-14", "weeks")).toBe(-1);
    expect(db("2024-01-01T12:00", "2024-01-01", "hours")).toBe(12);
    expect(db("2024-07-01", "2024-01-01", "quarters")).toBe(2);
    expect(db("2024-11-10", "2024-10-20", "days")).toBe(21); // spans a DST change in many zones
  });

  it("reads date parts", () => {
    const at = '(parseDate("2024-03-05T14:07:09"))';
    expect(["year", "month", "day", "date", "weekday", "hour", "minute", "second"].map((f) => run(`${f}${at}`))).toEqual([
      2024, 3, 5, 5, 2, 14, 7, 9,
    ]);
    expect(run('weekday(parseDate("2024-03-10"))')).toBe(7);
    expect(run('week(parseDate("2024-01-01"))')).toBe(1);
    expect(run('week(parseDate("2023-01-01"))')).toBe(52);
    expect(run('week(parseDate("2020-12-31"))')).toBe(53);
    expect(run("timestamp(fromTimestamp(1000))")).toBe(1000);
    expect(run('start(parseDate("2024-01-01"))')).toEqual(d(2024, 1, 1));
    expect(run('end([parseDate("2024-01-01"), parseDate("2024-02-01")])')).toEqual(d(2024, 2, 1));
    expect(run('parseDate("nope")')).toBe(null);
    expect(run('parseDate("2024-02-30")')).toBe(null);
    expect(run('year("2024-06-01")')).toBe(2024);
  });

  it("formats with tokens", () => {
    const f = (p: string) => run(`formatDate(parseDate("2024-03-05T14:07:09"), "${p}")`);
    expect(f("YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a")).toBe(
      "2024 24 March Mar 03 3 05 5 Tuesday Tue 14 14 02 2 07 09 PM pm",
    );
    expect(f("[Week of] MMM D")).toBe("Week of Mar 5");
    expect(run('formatDate(parseDate("2024-01-09T00:05"), "h:mm a")')).toBe("12:05 am");
    expect(run('formatDate(parseDate("2024-03-05"))')).toBe("March 5, 2024");
  });
});

describe("formatFormulaValue", () => {
  it("formats every type", () => {
    expect(formatFormulaValue(null)).toBe("");
    expect(formatFormulaValue(true)).toBe("true");
    expect(formatFormulaValue(false)).toBe("false");
    expect(formatFormulaValue(0.1 + 0.2)).toBe("0.3");
    expect(formatFormulaValue([1, "a", true])).toBe("1, a, true");
    expect(formatFormulaValue(1234.5, { numberFormat: "commas" })).toBe(formatNumber(1234.5, "commas"));
    expect(formatFormulaValue(0.25, { numberFormat: "percent" })).toBe(formatNumber(0.25, "percent"));
    expect(formatFormulaValue(d(2024, 3, 5))).toBe("Mar 5, 2024");
    expect(formatFormulaValue(d(2024, 3, 5, 14, 30))).toBe("Mar 5, 2024 2:30 PM");
    expect(formatFormulaValue(d(2024, 3, 5), { dateFormat: "long" })).toBe("March 5, 2024");
    expect(formatFormulaValue(d(2024, 3, 5, 9, 5), { dateFormat: "iso" })).toBe("2024-03-05T09:05");
    const today = new Date();
    expect(formatFormulaValue(new Date(today.getFullYear(), today.getMonth(), today.getDate()), { dateFormat: "relative" })).toBe("Today");
  });
});

describe("errors", () => {
  it("reports syntax errors with offsets", () => {
    expect(compileErr("1 +")).toEqual({ message: 'Missing a value after "+"', start: 2, end: 3 });
    expect(compileErr("round(1, 2")).toEqual({ message: 'Missing ")"', start: 5, end: 6 });
    expect(compileErr("1 2")).toEqual({ message: 'Missing an operator or "," before "2"', start: 2, end: 3 });
    expect(compileErr('"abc')).toEqual({ message: "Missing closing quote", start: 0, end: 4 });
    expect(compileErr("{Name").message).toBe('Missing "}"');
    expect(compileErr("1 + /* x").message).toBe('Unclosed comment — add "*/"');
    expect(compileErr("1)").message).toBe('Unmatched ")"');
    expect(compileErr("1 # 2")).toEqual({ message: 'Unexpected character "#"', start: 2, end: 3 });
    expect(compileErr("true ? 1").message).toMatch(/Missing ":"/);
    expect(compileErr("prop(Name)").message).toBe('prop() needs a property name in quotes, like prop("Status")');
  });

  it("suggests function names and checks arity", () => {
    expect(compileErr('lenght("a")')).toEqual({ message: 'Unknown function "lenght". Did you mean "length"?', start: 0, end: 6 });
    expect(compileErr("{X}.uper()").message).toBe('Unknown function "uper". Did you mean "upper"?');
    expect(compileErr("random()").message).toBe('Unknown function "random".');
    expect(compileErr("round(1, 2, 3)").message).toBe("round() takes 1–2 arguments, got 3");
    expect(compileErr("abs()").message).toBe("abs() takes 1 argument, got 0");
    expect(compileErr("let(x, 1)").message).toMatch(/let\(\) takes 3 arguments/);
    expect(compileErr("let(1, 2, 3)").message).toMatch(/needs a variable name/);
  });

  it("rejects unknown names", () => {
    expect(compileErr("foo + 1").message).toBe('Unknown name "foo". To use a property, write prop("foo") or {foo}');
    expect(compileErr("ture").message).toBe('Unknown name "ture". Did you mean "true"?');
    expect(compileErr("current + 1").message).toMatch(/only works inside map/);
    expect(compileErr("let(x, 1, y)").message).toMatch(/Unknown name "y"/);
  });

  it("never throws from evaluateFormula", () => {
    expect(evaluateFormula("1 +", ctx())).toEqual({ value: null, error: 'Missing a value after "+"', span: { start: 2, end: 3 } });
    expect(evaluateFormula('"a" * 2', ctx())).toEqual({ value: null, error: '"*" needs numbers, got text', span: { start: 0, end: 7 } });
    expect(evaluateFormula("", ctx())).toEqual({ value: null });
    expect(evaluateFormula("  // nothing", ctx())).toEqual({ value: null });
  });
});

describe("limits & determinism", () => {
  it("caps list and text sizes", () => {
    expect(err("range(0, 20000)")).toBe("List is too long (over 10,000 items)");
    expect(err('repeat("a", 200000)')).toBe("Text is too long (over 100,000 characters)");
    expect(err("range(0, 10000) + range(0, 10)")).toBe("List is too long (over 10,000 items)");
    expect(err('padStart("", 200000)')).toBe("Text is too long (over 100,000 characters)");
  });

  it("caps nesting and work", () => {
    expect(compileErr("(".repeat(100) + "1" + ")".repeat(100)).message).toBe("Formula is nested too deeply");
    expect(compileErr("-".repeat(200) + "1").message).toBe("Formula is nested too deeply");
    expect(run(Array(300).fill("1").join(" + "))).toBe(300);
    expect(err("map(range(10000), map(range(10000), current))")).toBe("Formula does too much work — try simplifying it");
  });

  it("is deterministic and cached", () => {
    const src = 'map(range(5), current * 2).join("-") + " " + formatDate(now(), "YYYY-MM-DD HH:mm")';
    expect(run(src)).toBe("0-2-4-6-8 2024-03-15 10:30");
    expect(run(src)).toBe(run(src));
    expect(compileFormula(src)).toBe(compileFormula(src));
  });
});

describe("renameRefs", () => {
  it("rewrites prop() and {} references only", () => {
    const src = 'prop("Price") * {Price} + prop("Prices") + "Price" /* prop("Price") */ + { Price }';
    expect(renameRefs(src, "Price", "Cost")).toBe('prop("Cost") * {Cost} + prop("Prices") + "Price" /* prop("Price") */ + { Cost }');
    expect(renameRefs("prop('Price')", "Price", "Cost")).toBe("prop('Cost')");
    expect(renameRefs("{Price}", "Price", 'My "X"')).toBe('{My "X"}');
    expect(renameRefs('prop("Price")', "Price", 'My "X"')).toBe('prop("My \\"X\\"")');
    expect(renameRefs("{Price} + 1", "Price", "a}b")).toBe('prop("a}b") + 1');
    expect(renameRefs("1 +  2", "Price", "Cost")).toBe("1 +  2");
    const renamed = renameRefs('prop("Price")', "Price", 'My "X"');
    expect(run(renamed, { 'My "X"': 7 })).toBe(7);
  });
});

describe("tokenize", () => {
  it("covers every character", () => {
    const src = 'if({Done}, "yes\\"", 3.5e2) // done\n/* c */ + prop("A") # @ "open';
    const toks = tokenize(src);
    expect(toks.map((t) => t.text).join("")).toBe(src);
    toks.forEach((t, i) => {
      expect(src.slice(t.start, t.end)).toBe(t.text);
      if (i) expect(t.start).toBe(toks[i - 1].end);
    });
    const types = toks.filter((t) => t.type !== "space").map((t) => t.type);
    expect(types.slice(0, 4)).toEqual(["ident", "punct", "prop", "punct"]);
    expect(types).toContain("comment");
    expect(types).toContain("number");
    expect(types.filter((t) => t === "error")).toHaveLength(3);
    expect(tokenize("a and b").map((t) => t.type)).toEqual(["ident", "space", "op", "space", "ident"]);
  });
});

describe("completionsAt", () => {
  const props = ["Status", "Stage", "Due date", 'Say "hi"'];
  it("completes property names inside prop() and {}", () => {
    let c = completionsAt('prop("St', 8, props);
    expect(c).toMatchObject({ from: 6, to: 8 });
    expect(c.items.map((i) => i.label)).toEqual(["Status", "Stage"]);
    expect(c.items[0]).toMatchObject({ insert: 'Status")', kind: "property" });

    c = completionsAt('prop("St") + 1', 8, props);
    expect(c).toMatchObject({ from: 6, to: 10 });

    c = completionsAt('prop("Sa', 8, props);
    expect(c.items[0].insert).toBe('Say \\"hi\\"")');

    c = completionsAt("{Sta", 4, props);
    expect(c).toMatchObject({ from: 1, to: 4 });
    expect(c.items.map((i) => i.insert)).toEqual(["Status}", "Stage}"]);

    c = completionsAt("{Sta} + 1", 4, props);
    expect(c.to).toBe(5);
    expect(completionsAt("{", 1, props).items).toHaveLength(4);
  });

  it("completes functions and methods", () => {
    let c = completionsAt("1 + len", 7, props);
    expect(c).toMatchObject({ from: 4, to: 7 });
    expect(c.items[0]).toMatchObject({ label: "length", insert: "length(", kind: "function" });

    c = completionsAt("{Tags}.len", 10, props);
    expect(c.items[0]).toMatchObject({ label: "length", insert: "length()" });
    expect(c.items[0].detail).toBe(".length()");

    c = completionsAt("{Tags}.", 7, props);
    expect(c.items.length).toBeGreaterThan(20);
    expect(c.items.some((i) => i.label === "pi")).toBe(false);
    expect(c.items.find((i) => i.label === "join")?.detail).toBe(".join(separator?)");

    expect(completionsAt("p", 1, props).items[0]).toMatchObject({ label: "prop", insert: 'prop("' });
    expect(completionsAt("pi", 2, props).items[0]).toMatchObject({ label: "pi", insert: "pi()" });
    expect(completionsAt("ro(1)", 2, props).items[0]).toMatchObject({ label: "round", insert: "round" });
    expect(completionsAt("tr", 2, props).items.map((i) => i.label)).toEqual(expect.arrayContaining(["trim", "trunc", "true"]));
  });

  it("offers nothing for an empty prefix, strings or comments", () => {
    expect(completionsAt("1 + ", 4, props).items).toEqual([]);
    expect(completionsAt("", 0, props).items).toEqual([]);
    expect(completionsAt('"len', 4, props).items).toEqual([]);
    expect(completionsAt("1 // len", 8, props).items).toEqual([]);
    expect(completionsAt("3.", 2, props).items).toEqual([]);
  });
});

describe("FORMULA_FUNCTIONS", () => {
  it("documents every function", () => {
    const names = FORMULA_FUNCTIONS.map((f) => f.name);
    for (const n of ["prop", "{Name}", "let", "lets", "current", "index", "dateBetween", "formatDate", "average", "substring", "date", "sort"])
      expect(names).toContain(n);
    expect(new Set(names).size).toBe(names.length);
    for (const f of FORMULA_FUNCTIONS) {
      expect(f.description.length).toBeGreaterThan(5);
      expect(f.example.length).toBeGreaterThan(0);
    }
  });

  it("has examples that compile and match their documented results", () => {
    for (const f of FORMULA_FUNCTIONS) {
      if (f.category === "Properties" || /[{]/.test(f.example)) continue;
      const c = compileFormula(f.example);
      expect(c.ok, `${f.name}: ${f.example}`).toBe(true);
      if (f.result === undefined || f.category === "Date") continue;
      const v = run(f.example);
      const shown = typeof v === "string" ? JSON.stringify(v) : Array.isArray(v) ? JSON.stringify(v).replace(/,/g, ", ") : formatFormulaValue(v);
      expect(shown, `${f.name}: ${f.example}`).toBe(f.result);
    }
  });
});

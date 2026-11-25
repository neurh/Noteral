/**
 * Formula engine for the database "formula" property.
 *
 * A small, dependency-free, deterministic expression language modelled on
 * Notion formulas: lexer → Pratt parser → AST → static checks (functions,
 * arity, names in scope) → tree-walking evaluator. Also provides editor
 * support: syntax tokens, autocompletion, function docs and ref renaming.
 */
import { formatNumber } from "./database";
import type { NumberFormat } from "./database";

// ───────────────────────────── Public types ─────────────────────────────

export type FormulaValue = null | number | string | boolean | Date | FormulaValue[];
export type FormulaType = "number" | "text" | "checkbox" | "date" | "list" | "empty";
export interface FormulaContext {
  prop(name: string): FormulaValue;
  now?: Date;
}
/** A compile error; `start`/`end` are source offsets for underlining. */
export interface FormulaError {
  message: string;
  start: number;
  end: number;
}
export type Compiled =
  | { ok: true; run(ctx: FormulaContext): FormulaValue; refs: string[] }
  | { ok: false; error: FormulaError };
export interface FormulaFunctionDoc {
  name: string;
  category: "Math" | "Text" | "Logic" | "Date" | "List" | "Type" | "Properties";
  signature: string;
  description: string;
  example: string;
  result?: string;
}
export type FormulaTokenType = "number" | "string" | "ident" | "prop" | "op" | "punct" | "comment" | "space" | "error";
export interface FormulaToken {
  type: FormulaTokenType;
  text: string;
  start: number;
  end: number;
}
export interface FormulaCompletion {
  label: string;
  insert: string;
  kind: "function" | "property" | "keyword";
  detail?: string;
}

// ───────────────────────────── Limits ─────────────────────────────

const MAX_NESTING = 64; // parser recursion (parens, calls, unary chains)
const MAX_AST_DEPTH = 512; // e.g. a+b+c+… chains
const MAX_LIST = 10_000;
const MAX_TEXT = 100_000;
const MAX_STEPS = 1_000_000; // evaluation work units (nodes + list items)
const CACHE_CAP = 500;

/** Runtime failure with a human-readable message. */
class FormulaFail extends Error {}
/** Compile-time failure with source offsets. */
class SyntaxFail {
  constructor(
    public message: string,
    public start: number,
    public end: number,
  ) {}
}
const fail = (message: string): never => {
  throw new FormulaFail(message);
};

// ───────────────────────────── Lexer ─────────────────────────────

interface Tok {
  type: FormulaTokenType | "eof";
  text: string;
  start: number;
  end: number;
  /** Decoded string contents / property name. */
  value?: string;
  /** Set when the token is malformed (unterminated string, stray char…). */
  problem?: string;
}

const OPS2 = ["==", "!=", "<>", ">=", "<=", "&&", "||"];
const OPS1 = "^*/%+-=<>!?:";
const PUNCT = "()[],.";
const WORD_OPS = new Set(["and", "or", "not"]);
const NUMBER_RE = /\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/y;
const IDENT_RE = /[\p{L}_$][\p{L}\p{N}_$]*/uy;
const SPACE_RE = /\s+/y;

function lex(src: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  const push = (type: FormulaTokenType, start: number, extra?: Partial<Tok>) =>
    out.push({ type, text: src.slice(start, i), start, end: i, ...extra });
  const sticky = (re: RegExp): number => {
    re.lastIndex = i;
    return re.exec(src) ? re.lastIndex : -1;
  };
  while (i < src.length) {
    const s = i;
    const c = src[i];
    let to: number;
    if ((to = sticky(SPACE_RE)) > 0) {
      i = to;
      push("space", s);
    } else if (c === "/" && src[i + 1] === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      push("comment", s);
    } else if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      i = close < 0 ? src.length : close + 2;
      push("comment", s, close < 0 ? { problem: 'Unclosed comment — add "*/"' } : undefined);
    } else if ((to = sticky(NUMBER_RE)) > 0) {
      i = to;
      push("number", s);
    } else if (c === '"' || c === "'") {
      let value = "";
      let closed = false;
      i++;
      while (i < src.length) {
        const ch = src[i++];
        if (ch === c) {
          closed = true;
          break;
        }
        if (ch === "\\" && i < src.length) {
          const esc = src[i++];
          value += esc === "n" ? "\n" : esc === "t" ? "\t" : esc;
        } else value += ch;
      }
      push("string", s, { value, problem: closed ? undefined : "Missing closing quote" });
    } else if (c === "{") {
      const close = src.indexOf("}", i + 1);
      i = close < 0 ? src.length : close + 1;
      const name = src.slice(s + 1, close < 0 ? i : close).trim();
      push("prop", s, { value: name, problem: close < 0 ? 'Missing "}"' : name ? undefined : "Empty property name in {}" });
    } else if ((to = sticky(IDENT_RE)) > 0) {
      i = to;
      push(WORD_OPS.has(src.slice(s, i).toLowerCase()) ? "op" : "ident", s);
    } else if (OPS2.includes(src.slice(i, i + 2))) {
      i += 2;
      push("op", s);
    } else if (OPS1.includes(c)) {
      i++;
      push("op", s);
    } else if (PUNCT.includes(c)) {
      i++;
      push("punct", s);
    } else {
      i += String.fromCodePoint(src.codePointAt(i)!).length;
      push("error", s, { problem: `Unexpected character "${src.slice(s, i)}"` });
    }
  }
  return out;
}

const significant = (toks: Tok[]) => toks.filter((t) => t.type !== "space" && t.type !== "comment");
const isPunct = (t: Tok | undefined, text: string) => !!t && t.type === "punct" && t.text === text;

// ───────────────────────────── AST & parser ─────────────────────────────

type Node =
  | { k: "lit"; v: FormulaValue; s: number; e: number }
  | { k: "list"; items: Node[]; s: number; e: number }
  | { k: "prop"; name: string; s: number; e: number }
  | { k: "var"; name: string; s: number; e: number }
  | { k: "call"; fn: FnDef; args: Node[]; s: number; e: number }
  | { k: "un"; op: string; x: Node; s: number; e: number }
  | { k: "bin"; op: string; a: Node; b: Node; s: number; e: number }
  | { k: "if"; c: Node; a: Node; b: Node; s: number; e: number };

/** Left binding powers; higher binds tighter. Unary prefix is 7. */
const BP: Record<string, number> = {
  "?": 1,
  or: 2, "||": 2,
  and: 3, "&&": 3,
  "==": 4, "=": 4, "!=": 4, "<>": 4, ">": 4, "<": 4, ">=": 4, "<=": 4,
  "+": 5, "-": 5,
  "*": 6, "/": 6, "%": 6,
  "^": 8,
};
const PREFIX_BP = 7;
const METHOD_BP = 10;
const OP_ALIAS: Record<string, string> = { "=": "==", "<>": "!=", "&&": "and", "||": "or" };

class Parser {
  private toks: Tok[];
  private i = 0;
  private nesting = 0;
  readonly refs: string[] = [];

  constructor(private src: string) {
    const all = lex(src);
    const bad = all.find((t) => t.problem);
    if (bad) throw new SyntaxFail(bad.problem!, bad.start, bad.end);
    this.toks = significant(all);
    this.toks.push({ type: "eof", text: "", start: src.length, end: src.length });
  }

  parseAll(): Node | null {
    if (this.peek().type === "eof") return null;
    const node = this.expr(0);
    const t = this.peek();
    if (t.type !== "eof") this.unexpected(t);
    return node;
  }

  private peek = () => this.toks[this.i];
  private next = () => this.toks[this.i++];
  private prev = () => this.toks[this.i - 2];

  private expr(rbp: number): Node {
    const t = this.next();
    if (++this.nesting > MAX_NESTING) throw new SyntaxFail("Formula is nested too deeply", t.start, t.end);
    let left = this.nud(t);
    for (;;) {
      const op = this.peek();
      const lbp = op.type === "op" ? (BP[op.text.toLowerCase()] ?? 0) : isPunct(op, ".") ? METHOD_BP : 0;
      if (lbp <= rbp) break;
      this.next();
      left = this.led(op, left, lbp);
    }
    this.nesting--;
    return left;
  }

  /** Prefix position: literals, names, calls, groups, unary operators. */
  private nud(t: Tok): Node {
    const span = { s: t.start, e: t.end };
    switch (t.type) {
      case "number":
        return { k: "lit", v: Number(t.text), ...span };
      case "string":
        return { k: "lit", v: t.value!, ...span };
      case "prop":
        return this.ref(t.value!, span);
      case "ident": {
        if (isPunct(this.peek(), "(")) return this.call(t);
        const low = t.text.toLowerCase();
        if (low === "true" || low === "false") return { k: "lit", v: low === "true", ...span };
        if (low === "null") return { k: "lit", v: null, ...span };
        return { k: "var", name: t.text, ...span };
      }
      case "op": {
        const low = t.text.toLowerCase();
        if ((low === "and" || low === "or") && isPunct(this.peek(), "(")) return this.call(t);
        if (low === "-" || low === "+" || low === "!" || low === "not") {
          const x = this.expr(PREFIX_BP);
          return { k: "un", op: low === "not" ? "!" : low, x, s: t.start, e: x.e };
        }
        break;
      }
      case "punct":
        if (t.text === "(") {
          const x = this.expr(0);
          this.close(")", t);
          return x;
        }
        if (t.text === "[") {
          const items = this.args("]", t);
          return { k: "list", items, s: t.start, e: this.prev()!.end };
        }
        break;
    }
    return this.unexpected(t);
  }

  /** Infix / postfix position. */
  private led(op: Tok, left: Node, lbp: number): Node {
    if (op.type === "punct") {
      // Method sugar: x.name(args) == name(x, args); x.name == name(x)
      const name = this.next();
      if (name.type !== "ident" && !(name.type === "op" && WORD_OPS.has(name.text.toLowerCase())))
        throw new SyntaxFail('Expected a function name after "."', name.start, Math.max(name.end, op.end));
      if (name.text.toLowerCase() === "prop") throw new SyntaxFail('prop() can\'t be used after "."', name.start, name.end);
      if (isPunct(this.peek(), "(")) return this.call(name, left);
      return this.mkCall(name, [left], left.s, name.end, true);
    }
    const sym = op.text.toLowerCase();
    if (sym === "?") {
      const a = this.expr(0);
      const colon = this.peek();
      if (colon.type !== "op" || colon.text !== ":")
        throw new SyntaxFail('Missing ":" — write condition ? then : else', op.start, op.end);
      this.next();
      const b = this.expr(0);
      return { k: "if", c: left, a, b, s: left.s, e: b.e };
    }
    const b = this.expr(sym === "^" ? lbp - 1 : lbp);
    return { k: "bin", op: OP_ALIAS[sym] ?? sym, a: left, b, s: left.s, e: b.e };
  }

  private ref(name: string, span: { s: number; e: number }): Node {
    if (!this.refs.includes(name)) this.refs.push(name);
    return { k: "prop", name, ...span };
  }

  /** Comma-separated arguments up to `closer`; trailing comma allowed. */
  private args(closer: string, open: Tok): Node[] {
    const out: Node[] = [];
    while (!isPunct(this.peek(), closer)) {
      out.push(this.expr(0));
      if (isPunct(this.peek(), ",")) this.next();
      else break;
    }
    this.close(closer, open, true);
    return out;
  }

  private call(nameTok: Tok, receiver?: Node): Node {
    const open = this.next();
    if (nameTok.text.toLowerCase() === "prop") {
      const arg = this.next();
      if (arg.type !== "string" || !isPunct(this.peek(), ")"))
        throw new SyntaxFail('prop() needs a property name in quotes, like prop("Status")', arg.start, arg.end || open.end);
      const close = this.next();
      return this.ref(arg.value!, { s: nameTok.start, e: close.end });
    }
    const args = this.args(")", open);
    if (receiver) args.unshift(receiver);
    return this.mkCall(nameTok, args, receiver ? receiver.s : nameTok.start, this.prev()!.end, !!receiver);
  }

  private mkCall(nameTok: Tok, args: Node[], s: number, e: number, method = false): Node {
    const fn = FUNCS.get(nameTok.text.toLowerCase());
    if (!fn) {
      const hint = suggest(nameTok.text, [...FUNCS.values()].map((f) => f.name));
      throw new SyntaxFail(`Unknown function "${nameTok.text}".${hint ? ` Did you mean "${hint}"?` : ""}`, nameTok.start, nameTok.end);
    }
    if (args.length < fn.min || args.length > fn.max) {
      const off = method ? 1 : 0;
      const [min, max, got] = [fn.min - off, fn.max - off, args.length - off];
      const want =
        max === Infinity ? `at least ${min}` : min === max ? `${min}` : `${Math.max(min, 0)}–${max}`;
      const noun = min === 1 && max === 1 ? "argument" : "arguments";
      throw new SyntaxFail(`${method ? "." : ""}${fn.name}() takes ${want} ${noun}, got ${got}`, s, e);
    }
    return { k: "call", fn, args, s, e };
  }

  private close(text: string, open: Tok, inList = false): Tok {
    const t = this.peek();
    if (isPunct(t, text)) return this.next();
    if (t.type === "eof") throw new SyntaxFail(`Missing "${text}"`, open.start, open.end);
    throw new SyntaxFail(
      inList ? `Expected "," or "${text}" before "${t.text}"` : `Expected "${text}" before "${t.text}"`,
      t.start,
      t.end,
    );
  }

  private unexpected(t: Tok): never {
    if (t.type === "eof") {
      const p = this.toks[this.toks.length - 2];
      if (p && p.type === "op") throw new SyntaxFail(`Missing a value after "${p.text}"`, p.start, p.end);
      throw new SyntaxFail("Formula is incomplete", Math.max(0, this.src.length - 1), this.src.length);
    }
    const p = this.toks[this.toks.indexOf(t) - 1];
    const startsValue = ["number", "string", "prop", "ident"].includes(t.type) || isPunct(t, "(") || isPunct(t, "[");
    if (p && startsValue && (p.type !== "op" && p.type !== "punct" || isPunct(p, ")") || isPunct(p, "]")))
      throw new SyntaxFail(`Missing an operator or "," before "${t.text}"`, t.start, t.end);
    if (isPunct(t, ")") || isPunct(t, "]")) throw new SyntaxFail(`Unmatched "${t.text}"`, t.start, t.end);
    throw new SyntaxFail(`Unexpected "${t.text}"`, t.start, t.end);
  }
}

/** Static pass: names in scope, let/lets shapes, depth. */
function resolve(n: Node, scope: ReadonlySet<string>, depth = 0): void {
  if (depth > MAX_AST_DEPTH) throw new SyntaxFail("Formula is nested too deeply", n.s, n.e);
  const r = (x: Node, s: ReadonlySet<string> = scope) => resolve(x, s, depth + 1);
  switch (n.k) {
    case "lit":
    case "prop":
      return;
    case "var":
      if (!scope.has(n.name) && !isBareCallable(n.name)) throw new SyntaxFail(unknownName(n.name, scope), n.s, n.e);
      return;
    case "list":
      return n.items.forEach((x) => r(x));
    case "un":
      return r(n.x);
    case "bin":
      r(n.a);
      return r(n.b);
    case "if":
      r(n.c);
      r(n.a);
      return r(n.b);
    case "call": {
      const { fn, args } = n;
      if (fn.scope === "iter") {
        r(args[0]);
        const inner = new Set(scope).add("current").add("index");
        return args.slice(1).forEach((x) => r(x, inner));
      }
      if (fn.scope === "let") {
        if (args.length % 2 === 0)
          throw new SyntaxFail(`${fn.name}() needs name, value pairs followed by an expression`, n.s, n.e);
        let s = new Set(scope);
        for (let i = 0; i < args.length - 1; i += 2) {
          const name = args[i];
          if (name.k !== "var")
            throw new SyntaxFail(`${fn.name}() needs a variable name here, like let(x, 1, x * 2)`, name.s, name.e);
          r(args[i + 1], s);
          s = new Set(s).add(name.name);
        }
        return r(args[args.length - 1], s);
      }
      return args.forEach((x) => r(x));
    }
  }
}

const isBareCallable = (name: string) => FUNCS.get(name.toLowerCase())?.min === 0;

function unknownName(name: string, scope: ReadonlySet<string>): string {
  if (name === "current" || name === "index")
    return `"${name}" only works inside map(), filter(), find(), findIndex(), some(), every(), sort() or count()`;
  const bare = [...FUNCS.values()].filter((f) => f.min === 0).map((f) => f.name);
  const hint = suggest(name, [...scope, ...bare, "true", "false", "current", "index"]);
  if (hint) return `Unknown name "${name}". Did you mean "${hint}"?`;
  return `Unknown name "${name}". To use a property, write prop("${name}") or {${name}}`;
}

// ───────────────────────────── Values ─────────────────────────────

export function typeOfValue(v: FormulaValue): FormulaType {
  if (v === null || v === undefined) return "empty";
  if (typeof v === "number") return "number";
  if (typeof v === "string") return "text";
  if (typeof v === "boolean") return "checkbox";
  if (v instanceof Date) return "date";
  return Array.isArray(v) ? "list" : "empty";
}

function truthy(v: FormulaValue): boolean {
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (v instanceof Date) return true;
  return !!v;
}

/** null, "" and [] are empty (0 and false are real values). */
const isEmpty = (v: FormulaValue) => v === null || v === undefined || v === "" || (Array.isArray(v) && v.length === 0);

function same(a: FormulaValue, b: FormulaValue): boolean {
  if (a === null || b === null) return isEmpty(a) && isEmpty(b);
  if (typeof a === "number" && typeof b === "number") return cmpNum(a, b) === 0;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, i) => same(x, b[i]));
  return a === b;
}

function cmpNum(a: number, b: number): number {
  if (Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b))) return 0;
  return a < b ? -1 : 1;
}

const TYPE_RANK: Record<FormulaType, number> = { number: 0, text: 1, date: 2, checkbox: 3, list: 4, empty: 5 };
/** Total order used by sort(): by type, then naturally; empties last. */
function order(a: FormulaValue, b: FormulaValue): number {
  const ta = typeOfValue(a);
  const tb = typeOfValue(b);
  if (ta !== tb) return TYPE_RANK[ta] - TYPE_RANK[tb];
  if (typeof a === "number") return cmpNum(a, b as number);
  if (typeof a === "string") return a.localeCompare(b as string);
  if (a instanceof Date) return a.getTime() - (b as Date).getTime();
  if (typeof a === "boolean") return Number(a) - Number(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const c = order(a[i], b[i]);
      if (c) return c;
    }
    return a.length - b.length;
  }
  return 0;
}

/** Stable identity key for unique(). */
function keyOf(v: FormulaValue): string {
  if (Array.isArray(v)) return `l[${v.map(keyOf).join(",")}]`;
  if (v instanceof Date) return `d${v.getTime()}`;
  return `${typeOfValue(v)[0]}${JSON.stringify(v)}`;
}

/** Strip float noise: non-integers are rounded to 12 significant digits. */
function tidy(n: number): number {
  if (Number.isInteger(n) || Math.abs(n) >= 1e11) return n || 0;
  return Number(n.toPrecision(12));
}

// ───────────────────────────── Evaluator ─────────────────────────────

type Env = { [name: string]: FormulaValue };
interface Rt {
  ctx: FormulaContext;
  now: Date;
  steps: number;
}

function work(rt: Rt, units: number) {
  if ((rt.steps += units) > MAX_STEPS) fail("Formula does too much work — try simplifying it");
}

/** Normalise and bound every produced value. */
function clean(v: FormulaValue | undefined, rt: Rt): FormulaValue {
  if (v === undefined || v === null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? tidy(v) : null;
  if (typeof v === "string") {
    if (v.length > MAX_TEXT) fail("Text is too long (over 100,000 characters)");
    work(rt, v.length >> 8);
  } else if (Array.isArray(v)) {
    if (v.length > MAX_LIST) fail("List is too long (over 10,000 items)");
    work(rt, v.length);
  } else if (v instanceof Date && Number.isNaN(v.getTime())) return null;
  return v;
}

function ev(n: Node, env: Env, rt: Rt): FormulaValue {
  work(rt, 1);
  switch (n.k) {
    case "lit":
      return n.v;
    case "list":
      return clean(
        n.items.map((x) => ev(x, env, rt)),
        rt,
      );
    case "prop":
      return clean(rt.ctx.prop(n.name), rt);
    case "var":
      return n.name in env ? env[n.name] : invoke(FUNCS.get(n.name.toLowerCase())!, [], env, rt);
    case "call":
      return invoke(n.fn, n.args, env, rt);
    case "if":
      return truthy(ev(n.c, env, rt)) ? ev(n.a, env, rt) : ev(n.b, env, rt);
    case "un": {
      const x = ev(n.x, env, rt);
      if (n.op === "!") return !truthy(x);
      if (x === null) return null;
      if (typeof x !== "number") return fail(`"${n.op}" needs a number, got ${typeOfValue(x)}`);
      return n.op === "-" ? -x || 0 : x;
    }
    case "bin": {
      if (n.op === "and") return truthy(ev(n.a, env, rt)) && truthy(ev(n.b, env, rt));
      if (n.op === "or") return truthy(ev(n.a, env, rt)) || truthy(ev(n.b, env, rt));
      return clean(binary(n.op, ev(n.a, env, rt), ev(n.b, env, rt)), rt);
    }
  }
}

function invoke(fn: FnDef, args: Node[], env: Env, rt: Rt): FormulaValue {
  const out = fn.lazy
    ? fn.lazy(args, env, rt)
    : fn.eager!(
        args.map((a) => ev(a, env, rt)),
        rt,
      );
  return clean(out, rt);
}

function binary(op: string, a: FormulaValue, b: FormulaValue): FormulaValue {
  switch (op) {
    case "==":
      return same(a, b);
    case "!=":
      return !same(a, b);
    case ">":
    case "<":
    case ">=":
    case "<=": {
      if (a === null || b === null) return false;
      const c = compare(op, a, b);
      return op === ">" ? c > 0 : op === "<" ? c < 0 : op === ">=" ? c >= 0 : c <= 0;
    }
    case "+":
      if (typeof a === "string" || typeof b === "string") return toText(a) + toText(b);
      if (Array.isArray(a) && Array.isArray(b)) return [...a, ...b];
      if (Array.isArray(a) || Array.isArray(b))
        return fail(`"+" can't combine ${typeOfValue(a)} with ${typeOfValue(b)} — use concat() for lists`);
  }
  return arith(op, a, b);
}

function compare(op: string, a: FormulaValue, b: FormulaValue): number {
  if (typeof a === "number" && typeof b === "number") return cmpNum(a, b);
  if (typeof a === "string" && typeof b === "string") return a.localeCompare(b);
  if (a instanceof Date && b instanceof Date) return a.getTime() - b.getTime();
  if (typeof a === "boolean" && typeof b === "boolean") return Number(a) - Number(b);
  return fail(`"${op}" can't compare ${typeOfValue(a)} with ${typeOfValue(b)}`);
}

/** Arithmetic; empty counts as 0 when the other side has a value. */
function arith(op: string, a: FormulaValue, b: FormulaValue): FormulaValue {
  if (a === null && b === null) return null;
  for (const x of [a, b]) {
    if (x instanceof Date)
      return fail(
        a instanceof Date && b instanceof Date
          ? `"${op}" can't be used on two dates — use dateBetween()`
          : `"${op}" can't be used on a date — use dateAdd() or dateSubtract()`,
      );
    if (x !== null && typeof x !== "number") return fail(`"${op}" needs numbers, got ${typeOfValue(x)}`);
  }
  const x = (a ?? 0) as number;
  const y = (b ?? 0) as number;
  switch (op) {
    case "+":
      return x + y;
    case "-":
      return x - y;
    case "*":
      return x * y;
    case "/":
      return y === 0 ? null : x / y;
    case "%":
      return y === 0 ? null : x % y;
    default:
      return Math.pow(x, y);
  }
}

// ───────────────────────────── Coercion helpers ─────────────────────────────

const toText = (v: FormulaValue): string => formatFormulaValue(v);

function asNum(v: FormulaValue, fn: string): number {
  return typeof v === "number" ? v : fail(`${fn}() needs a number, got ${typeOfValue(v)}`);
}
function asInt(v: FormulaValue | undefined, fn: string, fallback: number): number {
  return v === undefined || v === null ? fallback : Math.trunc(asNum(v, fn));
}
function asList(v: FormulaValue, fn: string): FormulaValue[] {
  if (v === null) return [];
  return Array.isArray(v) ? v : fail(`${fn}() needs a list, got ${typeOfValue(v)}`);
}
function asDate(v: FormulaValue, fn: string): Date | null {
  if (v === null || v instanceof Date) return v;
  if (typeof v === "string") return parseDateText(v) ?? fail(`${fn}() needs a date, got text "${v.slice(0, 40)}"`);
  return fail(`${fn}() needs a date, got ${typeOfValue(v)}`);
}

/** All numbers in args (lists flattened, empties skipped). */
function numbers(args: FormulaValue[], fn: string): number[] {
  const out: number[] = [];
  const walk = (v: FormulaValue) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v !== null) out.push(asNum(v, fn));
  };
  args.forEach(walk);
  return out;
}

function parseNumber(s: string): number | null {
  let t = s.trim().replace(/[,\s_]/g, "").replace(/^([+-]?)[$€£¥]/, "$1");
  let scale = 1;
  if (t.endsWith("%")) {
    t = t.slice(0, -1);
    scale = 0.01;
  }
  return /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t) ? Number(t) * scale : null;
}

function regex(pattern: string, fn: string, literal: boolean, global: boolean): RegExp | string {
  const m = /^\/([\s\S]*)\/([a-z]*)$/.exec(pattern);
  if (literal && !m) return pattern;
  let flags = m ? m[2].replace("g", "") : "";
  if (global) flags += "g";
  try {
    return new RegExp(m ? m[1] : pattern, flags);
  } catch (e) {
    return fail(`${fn}(): invalid pattern — ${(e as Error).message}`);
  }
}

// ───────────────────────────── Dates ─────────────────────────────

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const UNITS = ["year", "quarter", "month", "week", "day", "hour", "minute", "second", "millisecond"] as const;
type Unit = (typeof UNITS)[number];

function unitOf(v: FormulaValue | undefined, fn: string): Unit {
  if (v === undefined || v === null) return "day";
  const u = String(v).trim().toLowerCase().replace(/s$/, "");
  if ((UNITS as readonly string[]).includes(u)) return u as Unit;
  return fail(`${fn}(): unknown unit "${String(v)}" — use years, quarters, months, weeks, days, hours, minutes or seconds`);
}

/** "YYYY-MM-DD" → local midnight; ISO with time (zone optional); else Date.parse. */
function parseDateText(text: string): Date | null {
  const s = text.trim();
  const m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?)?$/.exec(s);
  if (m) {
    const [, y, mo, d, h = "0", mi = "0", sec = "0", ms = "0"] = m;
    const date = new Date(+y, +mo - 1, +d, +h, +mi, +sec, +ms.padEnd(3, "0"));
    return date.getMonth() === +mo - 1 ? date : null;
  }
  if (!s || !/\d/.test(s)) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

const daysInMonth = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
/** Wall-clock time as if UTC — makes day maths immune to DST shifts. */
const wall = (d: Date) =>
  Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds());

/** Add months, clamping to the end of shorter months (Jan 31 + 1 → Feb 28). */
function addMonths(d: Date, n: number): Date {
  const r = new Date(d.getTime());
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  r.setDate(Math.min(day, daysInMonth(r.getFullYear(), r.getMonth())));
  return r;
}

function dateAdd(d: Date, amount: number, unit: Unit): Date {
  const n = Math.trunc(amount);
  const r = new Date(d.getTime());
  switch (unit) {
    case "year":
      return addMonths(d, n * 12);
    case "quarter":
      return addMonths(d, n * 3);
    case "month":
      return addMonths(d, n);
    case "week":
      r.setDate(r.getDate() + n * 7);
      return r;
    case "day":
      r.setDate(r.getDate() + n);
      return r;
    default:
      return new Date(d.getTime() + amount * { hour: 36e5, minute: 6e4, second: 1e3, millisecond: 1 }[unit]);
  }
}

function monthsBetween(a: Date, b: Date): number {
  if (a.getTime() < b.getTime()) return -monthsBetween(b, a);
  let m = (a.getFullYear() - b.getFullYear()) * 12 + a.getMonth() - b.getMonth();
  if (m > 0 && addMonths(b, m).getTime() > a.getTime()) m--;
  return m;
}

/** a − b in whole units, truncated toward zero. */
function dateBetween(a: Date, b: Date, unit: Unit): number {
  const t = Math.trunc;
  switch (unit) {
    case "year":
      return t(monthsBetween(a, b) / 12) || 0;
    case "quarter":
      return t(monthsBetween(a, b) / 3) || 0;
    case "month":
      return monthsBetween(a, b) || 0;
    case "week":
      return t((wall(a) - wall(b)) / (7 * 864e5)) || 0;
    case "day":
      return t((wall(a) - wall(b)) / 864e5) || 0;
    default:
      return t((a.getTime() - b.getTime()) / { hour: 36e5, minute: 6e4, second: 1e3, millisecond: 1 }[unit]) || 0;
  }
}

function isoWeek(d: Date): number {
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  t.setUTCDate(t.getUTCDate() + 4 - (t.getUTCDay() || 7));
  const jan1 = Date.UTC(t.getUTCFullYear(), 0, 1);
  return Math.ceil(((t.getTime() - jan1) / 864e5 + 1) / 7);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");
const DATE_TOKENS = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|hh|h|mm|ss|A|a/g;

/** Format with tokens YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a and [literal]. */
function formatDatePattern(d: Date, pattern: string): string {
  const h12 = d.getHours() % 12 || 12;
  return pattern.replace(DATE_TOKENS, (tok: string, literal?: string) => {
    if (literal !== undefined) return literal;
    switch (tok) {
      case "YYYY": return String(d.getFullYear());
      case "YY": return pad(d.getFullYear() % 100);
      case "MMMM": return MONTHS[d.getMonth()];
      case "MMM": return MONTHS[d.getMonth()].slice(0, 3);
      case "MM": return pad(d.getMonth() + 1);
      case "M": return String(d.getMonth() + 1);
      case "DD": return pad(d.getDate());
      case "D": return String(d.getDate());
      case "dddd": return DAYS[d.getDay()];
      case "ddd": return DAYS[d.getDay()].slice(0, 3);
      case "HH": return pad(d.getHours());
      case "H": return String(d.getHours());
      case "hh": return pad(h12);
      case "h": return String(h12);
      case "mm": return pad(d.getMinutes());
      case "ss": return pad(d.getSeconds());
      case "A": return d.getHours() < 12 ? "AM" : "PM";
      default: return d.getHours() < 12 ? "am" : "pm";
    }
  });
}

function formatDateValue(d: Date, style: "relative" | "short" | "long" | "iso", now: Date): string {
  const timed = d.getHours() || d.getMinutes() || d.getSeconds();
  if (style === "iso") return formatDatePattern(d, timed ? (d.getSeconds() ? "YYYY-MM-DD[T]HH:mm:ss" : "YYYY-MM-DD[T]HH:mm") : "YYYY-MM-DD");
  const time = timed ? formatDatePattern(d, " h:mm A") : "";
  if (style === "relative") {
    const days = dateBetween(startOfDay(d), startOfDay(now), "day");
    const word =
      days === 0 ? "Today" : days === 1 ? "Tomorrow" : days === -1 ? "Yesterday" :
      Math.abs(days) < 7 ? (days > 0 ? `In ${days} days` : `${-days} days ago`) : "";
    if (word) return word + time;
  }
  return formatDatePattern(d, style === "long" ? "MMMM D, YYYY" : "MMM D, YYYY") + time;
}

// ───────────────────────────── Function table ─────────────────────────────

type Eager = (args: FormulaValue[], rt: Rt) => FormulaValue;
type Lazy = (args: Node[], env: Env, rt: Rt) => FormulaValue;
interface FnDef {
  name: string;
  min: number;
  max: number;
  eager?: Eager;
  lazy?: Lazy;
  /** "iter": args after the first see `current`/`index`; "let": name/value pairs. */
  scope?: "iter" | "let";
}
type Category = FormulaFunctionDoc["category"];

const FUNCS = new Map<string, FnDef>();
const DOCS: FormulaFunctionDoc[] = [];

/** Register a function. `example` may contain " → result". */
function def(
  category: Category,
  signature: string,
  description: string,
  example: string,
  [min, max]: [number, number],
  impl: Eager | { lazy: Lazy; scope?: FnDef["scope"] },
) {
  const name = signature.slice(0, signature.indexOf("("));
  const [ex, result] = example.split(" → ");
  DOCS.push({ name, category, signature, description, example: ex, ...(result !== undefined ? { result } : {}) });
  FUNCS.set(name.toLowerCase(), typeof impl === "function" ? { name, min, max, eager: impl } : { name, min, max, ...impl });
}
function alias(name: string, of: string) {
  const target = FUNCS.get(of.toLowerCase())!;
  const doc = DOCS.find((d) => d.name === of)!;
  FUNCS.set(name.toLowerCase(), { ...target, name });
  DOCS.push({ ...doc, name, signature: doc.signature.replace(of, name), description: `Same as ${of}(). ${doc.description}`, example: doc.example.replace(of, name) });
}

const ANY: [number, number] = [0, Infinity];
const ONE: [number, number] = [1, 1];
const TWO: [number, number] = [2, 2];
/** Unary math with empty passthrough. */
const m1 = (fn: string, f: (x: number) => number): Eager => ([x]) => (x === null ? null : f(asNum(x, fn)));
const textOf = (v: FormulaValue | undefined) => (v === undefined ? "" : toText(v));

// Math
def("Math", "abs(number)", "Absolute value.", "abs(-3) → 3", ONE, m1("abs", Math.abs));
def("Math", "round(number, digits?)", "Rounds to the nearest integer, or to `digits` decimal places (half away from zero).", "round(3.14159, 2) → 3.14", [1, 2], ([x, d]) => {
  if (x === null) return null;
  const n = asNum(x, "round");
  const p = asInt(d, "round", 0);
  const shifted = Math.round(Number(`${Math.abs(n)}e${p}`));
  const r = Math.sign(n) * Number(`${shifted}e${-p}`);
  return Number.isFinite(r) ? r : Math.sign(n) * (Math.round(Math.abs(n) * 10 ** p) / 10 ** p);
});
def("Math", "floor(number)", "Largest integer ≤ the number.", "floor(2.7) → 2", ONE, m1("floor", Math.floor));
def("Math", "ceil(number)", "Smallest integer ≥ the number.", "ceil(2.1) → 3", ONE, m1("ceil", Math.ceil));
def("Math", "trunc(number)", "Drops the fractional part.", "trunc(-2.7) → -2", ONE, m1("trunc", Math.trunc));
def("Math", "min(values...)", "Smallest number (or earliest date). Accepts numbers or lists.", "min(4, 2, 8) → 2", [1, Infinity], (a) => extreme(a, "min", -1));
def("Math", "max(values...)", "Largest number (or latest date). Accepts numbers or lists.", "max([4, 2, 8]) → 8", [1, Infinity], (a) => extreme(a, "max", 1));
def("Math", "sum(values...)", "Adds numbers. Accepts numbers or lists; empties are skipped.", "sum([1, 2, 3]) → 6", ANY, (a) => numbers(a, "sum").reduce((s, x) => s + x, 0));
def("Math", "mean(values...)", "Average of the numbers.", "mean(1, 2, 6) → 3", [1, Infinity], (a) => {
  const xs = numbers(a, "mean");
  return xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null;
});
alias("average", "mean");
def("Math", "median(values...)", "Middle value of the numbers.", "median([3, 1, 4, 2]) → 2.5", [1, Infinity], (a) => {
  const xs = numbers(a, "median").sort((x, y) => x - y);
  const mid = xs.length >> 1;
  return xs.length ? (xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2) : null;
});
def("Math", "mod(number, divisor)", "Remainder after division (sign follows the number).", "mod(7, 3) → 1", TWO, ([a, b]) => arith("%", asNum(a, "mod"), asNum(b, "mod")));
def("Math", "pow(base, exponent)", "Raises base to a power. Same as base ^ exponent.", "pow(2, 10) → 1024", TWO, ([a, b]) => Math.pow(asNum(a, "pow"), asNum(b, "pow")));
def("Math", "sqrt(number)", "Square root.", "sqrt(16) → 4", ONE, m1("sqrt", Math.sqrt));
def("Math", "cbrt(number)", "Cube root.", "cbrt(27) → 3", ONE, m1("cbrt", Math.cbrt));
def("Math", "exp(number)", "e raised to the number.", "exp(1) → 2.71828182846", ONE, m1("exp", Math.exp));
def("Math", "ln(number)", "Natural logarithm.", "ln(e()) → 1", ONE, m1("ln", Math.log));
def("Math", "log10(number)", "Base-10 logarithm.", "log10(1000) → 3", ONE, m1("log10", Math.log10));
def("Math", "log2(number)", "Base-2 logarithm.", "log2(8) → 3", ONE, m1("log2", Math.log2));
def("Math", "sign(number)", "-1, 0 or 1 depending on the sign.", "sign(-5) → -1", ONE, m1("sign", Math.sign));
def("Math", "pi()", "The number π.", "pi() → 3.14159265359", [0, 0], () => Math.PI);
def("Math", "e()", "Euler's number e.", "e() → 2.71828182846", [0, 0], () => Math.E);

function extreme(args: FormulaValue[], fn: string, dir: 1 | -1): FormulaValue {
  const items: FormulaValue[] = [];
  const walk = (v: FormulaValue) => (Array.isArray(v) ? v.forEach(walk) : v !== null && items.push(v));
  args.forEach(walk);
  if (!items.length) return null;
  const dates = items.every((v) => v instanceof Date);
  if (!dates) items.forEach((v) => asNum(v, fn));
  return items.reduce((best, v) => (order(v, best) * dir > 0 ? v : best));
}

// Text
def("Text", "concat(values...)", "Joins text together, or lists into one list when every value is a list.", 'concat("a", "b", 1) → "ab1"', [1, Infinity], (a) =>
  a.every(Array.isArray) ? flatten(a, 1) : a.map(toText).join(""),
);
def("Text", "join(list, separator?)", 'Joins list items into text with a separator (default ", ").', 'join(["a", "b"], "-") → "a-b"', [1, 2], ([l, sep]) =>
  asList(l, "join").map(toText).join(sep === undefined ? ", " : toText(sep)),
);
def("Text", "length(text or list)", "Number of characters in text, or items in a list.", 'length("hello") → 5', ONE, ([v]) =>
  Array.isArray(v) ? v.length : textOf(v).length,
);
def("Text", "lower(text)", "Lowercase text.", 'lower("ABC") → "abc"', ONE, ([v]) => textOf(v).toLowerCase());
def("Text", "upper(text)", "Uppercase text.", 'upper("abc") → "ABC"', ONE, ([v]) => textOf(v).toUpperCase());
def("Text", "trim(text)", "Removes spaces from both ends.", 'trim("  hi  ") → "hi"', ONE, ([v]) => textOf(v).trim());
def("Text", "capitalize(text)", "Uppercases the first letter.", 'capitalize("hello world") → "Hello world"', ONE, ([v]) => {
  const s = textOf(v);
  return s.charAt(0).toUpperCase() + s.slice(1);
});
def("Text", "replace(text, find, replacement)", "Replaces the first match. `find` is plain text, or a regex like \"/\\\\d+/i\".", 'replace("a-b-c", "-", "+") → "a+b-c"', [3, 3], ([t, f, r]) => {
  const re = regex(textOf(f), "replace", true, false);
  const rep = textOf(r);
  return typeof re === "string" ? textOf(t).replace(re, () => rep) : textOf(t).replace(re, rep);
});
def("Text", "replaceAll(text, find, replacement)", "Replaces every match. `find` is plain text, or a regex like \"/\\\\d+/\".", 'replaceAll("a-b-c", "-", "+") → "a+b+c"', [3, 3], ([t, f, r]) => {
  const re = regex(textOf(f), "replaceAll", true, true);
  return typeof re === "string" ? textOf(t).split(re).join(textOf(r)) : textOf(t).replace(re, textOf(r));
});
def("Text", "contains(text or list, value)", "True if text contains the value, or a list has an equal item.", 'contains("Hello", "ell") → true', TWO, ([h, n]) =>
  Array.isArray(h) ? h.some((x) => same(x, n)) : textOf(h).includes(textOf(n)),
);
def("Text", "test(text, pattern)", "True if the text matches a regular expression.", 'test("ID-42", "\\\\d+") → true', TWO, ([t, p]) =>
  (regex(textOf(p), "test", false, false) as RegExp).test(textOf(t)),
);
def("Text", "match(text, pattern)", "All matches of a regular expression, as a list.", 'match("a1b22", "\\\\d+") → ["1", "22"]', TWO, ([t, p]) =>
  textOf(t).match(regex(textOf(p), "match", false, true) as RegExp) ?? [],
);
def("Text", "slice(text or list, start, end?)", "Part of text or a list, from start up to (not including) end. Negative counts from the end.", 'slice("Hello", 1, 3) → "el"', [2, 3], ([v, s, e]) => {
  const a = asInt(s, "slice", 0);
  const b = e === undefined || e === null ? undefined : asInt(e, "slice", 0);
  return Array.isArray(v) ? v.slice(a, b) : textOf(v).slice(a, b);
});
alias("substring", "slice");
def("Text", "split(text, separator?)", 'Splits text into a list. Separator may be a regex like "/[,;]/". Default splits into characters.', 'split("a,b,c", ",") → ["a", "b", "c"]', [1, 2], ([t, sep]) => {
  const text = textOf(t);
  const re = regex(textOf(sep), "split", true, false);
  if (typeof re === "string" && text.length > MAX_LIST && re.length === 0) fail("List is too long (over 10,000 items)");
  return text.split(re);
});
def("Text", "startsWith(text, prefix)", "True if the text begins with the prefix.", 'startsWith("Noteral", "Note") → true', TWO, ([t, p]) => textOf(t).startsWith(textOf(p)));
def("Text", "endsWith(text, suffix)", "True if the text ends with the suffix.", 'endsWith("report.pdf", ".pdf") → true', TWO, ([t, p]) => textOf(t).endsWith(textOf(p)));
def("Text", "padStart(text, length, fill?)", 'Pads the start to a length (default fill " ").', 'padStart("7", 3, "0") → "007"', [2, 3], ([t, n, f]) => padText(t, n, f, "padStart"));
def("Text", "padEnd(text, length, fill?)", 'Pads the end to a length (default fill " ").', 'padEnd("ab", 4, ".") → "ab.."', [2, 3], ([t, n, f]) => padText(t, n, f, "padEnd"));
def("Text", "repeat(text, times)", "Repeats text a number of times.", 'repeat("ab", 3) → "ababab"', TWO, ([t, n]) => {
  const s = textOf(t);
  const k = Math.max(0, asInt(n, "repeat", 0));
  if (s.length * k > MAX_TEXT) fail("Text is too long (over 100,000 characters)");
  return s.repeat(k);
});
def("Text", "format(value)", "Converts any value to text.", 'format(42) → "42"', ONE, ([v]) => toText(v));
def("Text", "indexOf(text or list, value)", "Position of the first match (0-based), or -1.", 'indexOf("hello", "l") → 2', TWO, ([h, n]) =>
  Array.isArray(h) ? h.findIndex((x) => same(x, n)) : textOf(h).indexOf(textOf(n)),
);

function padText(t: FormulaValue, n: FormulaValue, f: FormulaValue | undefined, fn: "padStart" | "padEnd"): string {
  const len = asInt(n, fn, 0);
  if (len > MAX_TEXT) fail("Text is too long (over 100,000 characters)");
  const fill = f === undefined || f === null ? " " : toText(f);
  return textOf(t)[fn](len, fill);
}

// Logic
def("Logic", "if(condition, then, else?)", "Returns `then` when the condition is true, otherwise `else` (or empty).", 'if(5 > 3, "yes", "no") → "yes"', [2, 3], {
  lazy: ([c, a, b], env, rt) => (truthy(ev(c, env, rt)) ? ev(a, env, rt) : b ? ev(b, env, rt) : null),
});
def("Logic", "ifs(condition1, value1, condition2, value2, ..., else?)", "Returns the value of the first true condition, else the last argument (or empty).", 'ifs(1 > 2, "a", 2 > 1, "b", "c") → "b"', [2, Infinity], {
  lazy: (args, env, rt) => {
    for (let i = 0; i + 1 < args.length; i += 2) if (truthy(ev(args[i], env, rt))) return ev(args[i + 1], env, rt);
    return args.length % 2 ? ev(args[args.length - 1], env, rt) : null;
  },
});
def("Logic", "and(values...)", "True when every value is true. Stops at the first false one. Also: a and b, a && b.", "and(true, 1 > 0) → true", [1, Infinity], {
  lazy: (args, env, rt) => args.every((a) => truthy(ev(a, env, rt))),
});
def("Logic", "or(values...)", "True when any value is true. Stops at the first true one. Also: a or b, a || b.", "or(false, 1 > 0) → true", [1, Infinity], {
  lazy: (args, env, rt) => args.some((a) => truthy(ev(a, env, rt))),
});
def("Logic", "not(value)", "Flips true and false. Also: not x, !x.", "not(true) → false", ONE, ([v]) => !truthy(v));
def("Logic", "empty(value?)", "With no argument, the empty value. With one, true if the value is empty (empty, \"\" or []).", 'empty("") → true', [0, 1], (a) =>
  a.length ? isEmpty(a[0]) : null,
);
def("Logic", "isEmpty(value)", 'True if the value is empty (empty, "" or []).', "isEmpty([]) → true", ONE, ([v]) => isEmpty(v));
def("Logic", "coalesce(values...)", "The first value that isn't empty.", 'coalesce(empty(), "", "fallback") → "fallback"', [1, Infinity], {
  lazy: (args, env, rt) => {
    for (const a of args) {
      const v = ev(a, env, rt);
      if (!isEmpty(v)) return v;
    }
    return null;
  },
});
def("Logic", "equal(a, b)", "True if the values are equal. Same as a == b.", "equal([1, 2], [1, 2]) → true", TWO, ([a, b]) => same(a, b));
def("Logic", "unequal(a, b)", "True if the values differ. Same as a != b.", 'unequal(1, "1") → true', TWO, ([a, b]) => !same(a, b));
def("Logic", "let(name, value, expression)", "Names a value for use inside the expression.", "let(x, 4, x * x) → 16", [3, 3], { lazy: letImpl, scope: "let" });
def("Logic", "lets(name1, value1, name2, value2, ..., expression)", "Names several values; later ones can use earlier ones.", "lets(a, 2, b, a + 1, a * b) → 6", [3, Infinity], { lazy: letImpl, scope: "let" });

function letImpl(args: Node[], env: Env, rt: Rt): FormulaValue {
  let scope = env;
  for (let i = 0; i < args.length - 1; i += 2) {
    const value = ev(args[i + 1], scope, rt);
    scope = Object.create(scope) as Env;
    scope[(args[i] as { name: string }).name] = value;
  }
  return ev(args[args.length - 1], scope, rt);
}

// Dates
const d1 = (fn: string, f: (d: Date) => FormulaValue): Eager => ([v]) => {
  const d = asDate(v, fn);
  return d ? f(d) : null;
};
def("Date", "now()", "The current date and time.", "now()", [0, 0], (_, rt) => new Date(rt.now.getTime()));
def("Date", "today()", "Today's date at midnight.", "today()", [0, 0], (_, rt) => startOfDay(rt.now));
def("Date", "dateAdd(date, amount, unit?)", "Adds time. Units: years, quarters, months, weeks, days (default), hours, minutes, seconds. Month ends are clamped.", 'dateAdd(parseDate("2024-01-31"), 1, "months") → Feb 29, 2024', [2, 3], ([d, n, u]) => {
  const date = asDate(d, "dateAdd");
  return date && n !== null ? dateAdd(date, asNum(n, "dateAdd"), unitOf(u, "dateAdd")) : date;
});
def("Date", "dateSubtract(date, amount, unit?)", "Subtracts time. Same units as dateAdd().", 'dateSubtract(today(), 1, "weeks")', [2, 3], ([d, n, u]) => {
  const date = asDate(d, "dateSubtract");
  return date && n !== null ? dateAdd(date, -asNum(n, "dateSubtract"), unitOf(u, "dateSubtract")) : date;
});
def("Date", "dateBetween(date1, date2, unit?)", "date1 − date2 in whole units (truncated toward zero). Default unit: days.", 'dateBetween(parseDate("2024-03-01"), parseDate("2024-01-15"), "months") → 1', [2, 3], ([a, b, u]) => {
  const x = asDate(a, "dateBetween");
  const y = asDate(b, "dateBetween");
  return x && y ? dateBetween(x, y, unitOf(u, "dateBetween")) : null;
});
def("Date", "daysUntil(date)", "Whole days from today until the date (negative if past).", "daysUntil(dateAdd(today(), 3)) → 3", ONE, ([v], rt) => {
  const d = asDate(v, "daysUntil");
  return d ? dateBetween(startOfDay(d), startOfDay(rt.now), "day") : null;
});
def("Date", "formatDate(date, pattern?)", "Formats a date. Tokens: YYYY YY MMMM MMM MM M DD D dddd ddd HH H hh h mm ss A a; [text] is literal.", 'formatDate(parseDate("2024-03-05"), "ddd, MMM D") → "Tue, Mar 5"', [1, 2], ([v, p]) => {
  const d = asDate(v, "formatDate");
  return d ? formatDatePattern(d, p === undefined || p === null ? "MMMM D, YYYY" : toText(p)) : null;
});
def("Date", "parseDate(text)", 'Reads a date from text like "2024-03-05" or "2024-03-05T14:30". Returns empty if it can\'t.', 'parseDate("2024-03-05")', ONE, ([v]) =>
  v instanceof Date ? v : v === null ? null : parseDateText(toText(v)),
);
def("Date", "year(date)", "The year.", "year(today())", ONE, d1("year", (d) => d.getFullYear()));
def("Date", "month(date)", "The month, 1–12.", 'month(parseDate("2024-03-05")) → 3', ONE, d1("month", (d) => d.getMonth() + 1));
def("Date", "day(date)", "The day of the month, 1–31.", 'day(parseDate("2024-03-05")) → 5', ONE, d1("day", (d) => d.getDate()));
alias("date", "day");
def("Date", "weekday(date)", "Day of the week, 1 = Monday … 7 = Sunday.", 'weekday(parseDate("2024-03-05")) → 2', ONE, d1("weekday", (d) => d.getDay() || 7));
def("Date", "week(date)", "ISO week number, 1–53.", 'week(parseDate("2024-01-01")) → 1', ONE, d1("week", isoWeek));
def("Date", "hour(date)", "The hour, 0–23.", 'hour(parseDate("2024-03-05T14:30")) → 14', ONE, d1("hour", (d) => d.getHours()));
def("Date", "minute(date)", "The minute, 0–59.", 'minute(parseDate("2024-03-05T14:30")) → 30', ONE, d1("minute", (d) => d.getMinutes()));
def("Date", "second(date)", "The second, 0–59.", "second(now())", ONE, d1("second", (d) => d.getSeconds()));
def("Date", "timestamp(date)", "Milliseconds since 1970-01-01 UTC.", "timestamp(now())", ONE, d1("timestamp", (d) => d.getTime()));
def("Date", "fromTimestamp(milliseconds)", "The date for a timestamp in milliseconds.", "fromTimestamp(0)", ONE, ([v]) => (v === null ? null : new Date(asNum(v, "fromTimestamp"))));
def("Date", "start(date)", "Start of a date (or the first date of a list).", "start(now())", ONE, ([v]) => edge(v, "start", 0));
def("Date", "end(date)", "End of a date (or the last date of a list).", "end(now())", ONE, ([v]) => edge(v, "end", -1));

function edge(v: FormulaValue, fn: string, at: 0 | -1): Date | null {
  if (Array.isArray(v)) return v.length ? asDate(v[at === 0 ? 0 : v.length - 1], fn) : null;
  return asDate(v, fn);
}

// Lists
function each(args: Node[], env: Env, rt: Rt, fn: string) {
  const items = asList(ev(args[0], env, rt), fn);
  const body = args[1];
  const at = (i: number): FormulaValue => {
    const scope = Object.create(env) as Env;
    scope.current = items[i];
    scope.index = i;
    return ev(body, scope, rt);
  };
  return { items, at };
}
const iter = (fn: string, f: (it: ReturnType<typeof each>) => FormulaValue) => ({
  lazy: (args: Node[], env: Env, rt: Rt) => f(each(args, env, rt, fn)),
  scope: "iter" as const,
});

def("List", "at(list, index)", "Item at a 0-based position; negative counts from the end.", "at([10, 20, 30], -1) → 30", TWO, ([l, i]) => {
  const items = Array.isArray(l) ? l : l === null ? [] : [...textOf(l)];
  const k = asInt(i, "at", 0);
  return items[k < 0 ? items.length + k : k] ?? null;
});
def("List", "first(list)", "The first item.", "first([3, 4]) → 3", ONE, ([l]) => asList(l, "first")[0] ?? null);
def("List", "last(list)", "The last item.", "last([3, 4]) → 4", ONE, ([l]) => {
  const items = asList(l, "last");
  return items[items.length - 1] ?? null;
});
def("List", "sort(list, key?)", "Sorts ascending (numbers, text, dates; stable). With a key expression, sorts by it, e.g. sort(list, -current).", "sort([3, 1, 2]) → [1, 2, 3]", [1, 2], {
  lazy: (args, env, rt) => {
    const { items, at } = each(args, env, rt, "sort");
    const keys = args.length > 1 ? items.map((_, i) => at(i)) : items;
    return items.map((_, i) => i).sort((a, b) => order(keys[a], keys[b])).map((i) => items[i]);
  },
  scope: "iter",
});
def("List", "reverse(list or text)", "Reverses a list (or text).", "reverse([1, 2, 3]) → [3, 2, 1]", ONE, ([l]) =>
  Array.isArray(l) ? [...l].reverse() : l === null ? null : [...toText(l)].reverse().join(""),
);
def("List", "unique(list)", "Removes duplicate items, keeping the first.", "unique([1, 2, 1]) → [1, 2]", ONE, ([l]) => {
  const seen = new Set<string>();
  return asList(l, "unique").filter((x) => !seen.has(keyOf(x)) && !!seen.add(keyOf(x)));
});
def("List", "flat(list, depth?)", "Flattens nested lists (default one level).", "flat([[1, 2], [3]]) → [1, 2, 3]", [1, 2], ([l, d]) =>
  flatten(asList(l, "flat"), Math.max(0, asInt(d, "flat", 1))),
);

function flatten(items: FormulaValue[], depth: number): FormulaValue[] {
  const out: FormulaValue[] = [];
  for (const x of items) {
    if (Array.isArray(x) && depth > 0) out.push(...flatten(x, depth - 1));
    else out.push(x);
    if (out.length > MAX_LIST) fail("List is too long (over 10,000 items)");
  }
  return out;
}
def("List", "map(list, expression)", "Transforms each item; use `current` and `index`.", "map([1, 2, 3], current * 10) → [10, 20, 30]", TWO, iter("map", ({ items, at }) => items.map((_, i) => at(i))));
def("List", "filter(list, condition)", "Keeps items where the condition is true; use `current` and `index`.", "filter([1, 5, 9], current > 2) → [5, 9]", TWO, iter("filter", ({ items, at }) => items.filter((_, i) => truthy(at(i)))));
def("List", "find(list, condition)", "The first item where the condition is true, or empty.", "find([1, 5, 9], current > 2) → 5", TWO, iter("find", ({ items, at }) => {
  const i = items.findIndex((_, k) => truthy(at(k)));
  return i < 0 ? null : items[i];
}));
def("List", "findIndex(list, condition)", "Position of the first item where the condition is true, or -1.", "findIndex([1, 5, 9], current > 2) → 1", TWO, iter("findIndex", ({ items, at }) => items.findIndex((_, k) => truthy(at(k)))));
def("List", "some(list, condition)", "True if the condition holds for any item.", "some([1, 5], current > 4) → true", TWO, iter("some", ({ items, at }) => items.some((_, k) => truthy(at(k)))));
def("List", "every(list, condition)", "True if the condition holds for every item.", "every([1, 5], current > 4) → false", TWO, iter("every", ({ items, at }) => items.every((_, k) => truthy(at(k)))));
def("List", "includes(list or text, value)", "True if the list has an equal item (or the text contains the value).", 'includes(["a", "b"], "b") → true', TWO, ([h, n]) =>
  Array.isArray(h) ? h.some((x) => same(x, n)) : textOf(h).includes(textOf(n)),
);
def("List", "count(list, condition?)", "Number of non-empty items, or of items matching the condition.", "count([1, 5, 9], current > 2) → 2", [1, 2], {
  lazy: (args, env, rt) => {
    const { items, at } = each(args, env, rt, "count");
    return args.length > 1 ? items.filter((_, i) => truthy(at(i))).length : items.filter((x) => !isEmpty(x)).length;
  },
  scope: "iter",
});
def("List", "range(start, end?, step?)", "Numbers from start up to (not including) end. range(n) counts 0…n−1.", "range(1, 4) → [1, 2, 3]", [1, 3], ([a, b, s]) => {
  const [from, to] = b === undefined || b === null ? [0, asNum(a, "range")] : [asNum(a, "range"), asNum(b, "range")];
  const step = s === undefined || s === null ? 1 : asNum(s, "range");
  if (step === 0) return fail("range() step can't be 0");
  const n = Math.max(0, Math.ceil((to - from) / step));
  if (n > MAX_LIST) return fail("List is too long (over 10,000 items)");
  return Array.from({ length: n }, (_, i) => from + i * step);
});

// Type
def("Type", "typeOf(value)", 'The type name: "number", "text", "checkbox", "date", "list" or "empty".', 'typeOf("hi") → "text"', ONE, ([v]) => typeOfValue(v));
def("Type", "toNumber(value)", 'Converts to a number: text like "1,234.5" or "50%", dates (milliseconds), checkboxes (1/0). Empty if it can\'t.', 'toNumber("1,234.5") → 1234.5', ONE, ([v]) => {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v instanceof Date) return v.getTime();
  return typeof v === "string" ? parseNumber(v) : null;
});
def("Type", "toText(value)", "Converts any value to text.", 'toText(3.5) → "3.5"', ONE, ([v]) => toText(v));
def("Type", "toBoolean(value)", 'Converts to a checkbox: empty, 0, "", [] and text "false"/"no"/"0" are false.', 'toBoolean("yes") → true', ONE, ([v]) =>
  typeof v === "string" && ["false", "no", "0", "off"].includes(v.trim().toLowerCase()) ? false : truthy(v),
);

/** Docs for every function plus the language's non-function constructs. */
export const FORMULA_FUNCTIONS: FormulaFunctionDoc[] = [
  { name: "prop", category: "Properties", signature: 'prop("Name")', description: "The value of a property of this row.", example: 'prop("Price") * 2' },
  { name: "{Name}", category: "Properties", signature: "{Name}", description: 'Shorthand for prop("Name").', example: "{Price} * {Quantity}" },
  ...DOCS,
  { name: "current", category: "List", signature: "current", description: "The item being looked at inside map(), filter(), find(), findIndex(), some(), every(), sort() and count().", example: "map([1, 2], current + 1)", result: "[2, 3]" },
  { name: "index", category: "List", signature: "index", description: "The 0-based position of `current`.", example: "map([5, 5], index)", result: "[0, 1]" },
  { name: "+ - * / % ^", category: "Math", signature: "a + b", description: "Arithmetic. + also joins text and lists. Dividing by 0 gives empty. ^ is power.", example: '"Total: " + (2 + 3) * 4', result: '"Total: 20"' },
  { name: "== != > < >= <=", category: "Logic", signature: "a == b", description: "Comparisons. = and <> also work for == and !=.", example: "{Price} >= 100" },
  { name: "and or not", category: "Logic", signature: "a and b", description: "Logical operators. && || ! also work. and/or stop early.", example: "{Done} and not {Archived}" },
  { name: "? :", category: "Logic", signature: "condition ? then : else", description: "Inline if.", example: '{Score} > 50 ? "pass" : "fail"' },
];

// ───────────────────────────── Suggestions ─────────────────────────────

/** Edit distance counting an adjacent swap as one edit ("ture" → "true"). */
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dp[i][j] = Math.min(dp[i][j], dp[i - 2][j - 2] + 1);
    }
  return dp[a.length][b.length];
}

/** Closest candidate within a typo-sized distance, case-insensitively. */
function suggest(name: string, candidates: string[]): string | undefined {
  const low = name.toLowerCase();
  let best: string | undefined;
  let bestD = Math.max(1, Math.min(3, Math.floor(name.length / 3)));
  for (const c of candidates) {
    const d = editDistance(low, c.toLowerCase());
    if (d <= bestD && (best === undefined || d < bestD)) {
      best = c;
      bestD = d;
    }
  }
  return best;
}

// ───────────────────────────── Formatting ─────────────────────────────

/**
 * Display text for a value: null → "", booleans "true"/"false", lists joined
 * with ", ", dates in a readable local format (time only when not midnight).
 */
export function formatFormulaValue(
  v: FormulaValue,
  opts?: { numberFormat?: NumberFormat; dateFormat?: "relative" | "short" | "long" | "iso" },
): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "number") {
    const n = tidy(v);
    return opts?.numberFormat && opts.numberFormat !== "number" ? formatNumber(n, opts.numberFormat) : String(n);
  }
  if (typeof v === "string") return v;
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? "" : formatDateValue(v, opts?.dateFormat ?? "short", new Date());
  return v.map((x) => formatFormulaValue(x, opts)).join(", ");
}

// ───────────────────────────── Compile & evaluate ─────────────────────────────

const cache = new Map<string, Compiled>();

/** Parse + check a formula. Results are cached by source (LRU, ~500 entries). */
export function compileFormula(source: string): Compiled {
  const hit = cache.get(source);
  if (hit) {
    cache.delete(source);
    cache.set(source, hit);
    return hit;
  }
  const compiled = compileUncached(source);
  cache.set(source, compiled);
  if (cache.size > CACHE_CAP) cache.delete(cache.keys().next().value as string);
  return compiled;
}

function compileUncached(source: string): Compiled {
  try {
    const parser = new Parser(source);
    const ast = parser.parseAll();
    if (ast) resolve(ast, new Set());
    const refs = [...parser.refs];
    return {
      ok: true,
      refs,
      run(ctx: FormulaContext): FormulaValue {
        if (!ast) return null;
        const rt: Rt = { ctx, now: ctx.now ?? new Date(), steps: 0 };
        return ev(ast, Object.create(null) as Env, rt);
      },
    };
  } catch (e) {
    if (e instanceof SyntaxFail) return { ok: false, error: { message: e.message, start: e.start, end: e.end } };
    if (e instanceof RangeError) return { ok: false, error: { message: "Formula is nested too deeply", start: 0, end: source.length } };
    throw e;
  }
}

/** Compile and run; never throws. Errors come back as `{ value: null, error }`. */
export function evaluateFormula(source: string, ctx: FormulaContext): { value: FormulaValue; error?: string } {
  const c = compileFormula(source);
  if (!c.ok) return { value: null, error: c.error.message };
  try {
    return { value: c.run(ctx) };
  } catch (e) {
    if (e instanceof RangeError && /call stack/i.test(e.message)) return { value: null, error: "Formula is nested too deeply" };
    return { value: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ───────────────────────────── Editor support ─────────────────────────────

/** Rewrite prop("from") and {from} to the new name; everything else is untouched. */
export function renameRefs(source: string, from: string, to: string): string {
  const toks = lex(source);
  const sig = toks.map((t, i) => ({ t, i })).filter(({ t }) => t.type !== "space" && t.type !== "comment");
  const edits: { start: number; end: number; text: string }[] = [];
  const quoted = (q: string) => q + to.replace(/\\/g, "\\\\").split(q).join("\\" + q) + q;
  sig.forEach(({ t }, k) => {
    if (t.type === "prop" && !t.problem && t.value === from) {
      if (to.includes("}")) edits.push({ start: t.start, end: t.end, text: `prop(${quoted('"')})` });
      else edits.push({ start: t.start + 1, end: t.end - 1, text: t.text.slice(1, -1).replace(from, to) });
    }
    if (t.type === "ident" && t.text.toLowerCase() === "prop" && isPunct(sig[k + 1]?.t, "(")) {
      const arg = sig[k + 2]?.t;
      if (arg && arg.type === "string" && !arg.problem && arg.value === from && isPunct(sig[k + 3]?.t, ")"))
        edits.push({ start: arg.start, end: arg.end, text: quoted(arg.text[0]) });
    }
  });
  let out = source;
  for (const e of edits.reverse()) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

/** Tokens for syntax highlighting; together they cover every character of the input. */
export function tokenize(source: string): FormulaToken[] {
  return lex(source).map(({ type, text, start, end, problem }) => ({
    type: problem && type !== "comment" ? "error" : (type as FormulaTokenType),
    text,
    start,
    end,
  }));
}

const KEYWORDS: { label: string; detail: string }[] = [
  { label: "true", detail: "checkbox" },
  { label: "false", detail: "checkbox" },
  { label: "and", detail: "operator" },
  { label: "or", detail: "operator" },
  { label: "not", detail: "operator" },
  { label: "current", detail: "item in map/filter/…" },
  { label: "index", detail: "position in map/filter/…" },
];

/**
 * Autocomplete at `cursor`: property names inside prop("…") or {…}; functions
 * after an identifier prefix (method style after "."). Empty prefix → nothing.
 */
export function completionsAt(
  source: string,
  cursor: number,
  propertyNames: string[],
): { from: number; to: number; items: FormulaCompletion[] } {
  const none = { from: cursor, to: cursor, items: [] as FormulaCompletion[] };
  const before = source.slice(0, cursor);
  const match = (prefix: string, label: string) => label.toLowerCase().startsWith(prefix.toLowerCase());

  const toks = lex(before);
  const last = toks[toks.length - 1];

  // Inside {… (the lexer sees an unclosed brace)
  if (last?.type === "prop" && last.problem === 'Missing "}"') {
    const typed = before.slice(last.start + 1);
    const from = last.start + 1;
    const rest = source.slice(cursor);
    const close = /^[^{}\n]*\}/.exec(rest);
    const to = close ? cursor + close[0].length : cursor;
    const items = propertyNames
      .filter((p) => match(typed.trim(), p) && !p.includes("}"))
      .map((p): FormulaCompletion => ({ label: p, insert: `${p}}`, kind: "property" }));
    return { from, to, items };
  }
  // Inside prop("… (an unclosed string right after `prop(`)
  const sig = significant(toks);
  if (last?.type === "string" && last.problem) {
    const [fnTok, open] = [sig[sig.length - 3], sig[sig.length - 2]];
    if (fnTok?.type !== "ident" || fnTok.text.toLowerCase() !== "prop" || !isPunct(open, "(")) return none;
    const q = last.text[0];
    const from = last.start + 1;
    const typed = last.value ?? "";
    const tail = new RegExp(`^(?:[^${q}\\\\\\n]|\\\\.)*${q}\\s*\\)?`).exec(source.slice(cursor));
    const to = tail ? cursor + tail[0].length : cursor;
    const esc = (p: string) => p.replace(/\\/g, "\\\\").split(q).join("\\" + q);
    const items = propertyNames
      .filter((p) => match(typed, p))
      .map((p): FormulaCompletion => ({ label: p, insert: `${esc(p)}${q})`, kind: "property" }));
    return { from, to, items };
  }
  // Nothing inside comments.
  if (last?.type === "comment" && (last.problem || last.text.startsWith("//"))) return none;

  const word = /[\p{L}_$][\p{L}\p{N}_$]*$/u.exec(before);
  const prefix = word ? word[0] : "";
  const from = cursor - prefix.length;
  const head = significant(lex(before.slice(0, from)));
  const dot = head[head.length - 1];
  // "3." with nothing typed yet is probably a decimal, not a method call.
  const afterDot = isPunct(dot, ".") && !(prefix === "" && head[head.length - 2]?.type === "number");
  if (!prefix && !afterDot) return none;
  const restWord = /^[\p{L}\p{N}_$]*/u.exec(source.slice(cursor))![0];
  const to = cursor + restWord.length;
  const hasParen = source[to] === "(";

  const items: FormulaCompletion[] = [];
  for (const fn of new Map([...FUNCS.values()].map((f) => [f.name, f])).values()) {
    if (afterDot && fn.min < 1) continue;
    if (!match(prefix, fn.name)) continue;
    const doc = DOCS.find((d) => d.name === fn.name);
    const takesArgs = afterDot ? fn.max > 1 : fn.max > 0;
    const insert = hasParen ? fn.name : fn.name + (takesArgs ? "(" : "()");
    let detail = doc?.signature;
    if (afterDot && detail) detail = "." + detail.replace(/\(([^,)]*)(?:,\s*)?/, "(");
    items.push({ label: fn.name, insert, kind: "function", detail });
  }
  if (!afterDot) {
    for (const k of KEYWORDS) if (match(prefix, k.label)) items.push({ label: k.label, insert: k.label, kind: "keyword", detail: k.detail });
    if (match(prefix, "prop")) items.unshift({ label: "prop", insert: hasParen ? "prop" : 'prop("', kind: "function", detail: 'prop("Name")' });
  }
  // Exact match first, then prop(), then shorter names.
  const rank = (i: FormulaCompletion) => (i.label === prefix ? 0 : i.label === "prop" ? 1 : 2);
  items.sort((a, b) => rank(a) - rank(b) || a.label.length - b.label.length || a.label.localeCompare(b.label));
  return { from, to, items };
}

/**
 * The small template language custom database property types render cells with, and the
 * sanitizer their HTML goes through before it reaches a shadow root.
 *
 *   {{value}}  {{config.max}}  {{value | percent}}  {{text | upper}}  {{row.title}}
 *   {{#if value >= 3}}…{{else}}…{{/if}}   {{#unless empty}}…{{/unless}}
 *   {{#each value}}{{this}} {{@index}}{{/each}}   {{#repeat config.max}}{{@number}}{{/repeat}}
 *
 * Everything printed is HTML-escaped; there is no raw output. Values and attributes that
 * survive sanitizing can't run script or load remote content.
 */

type Node =
  | { kind: "text"; text: string }
  | { kind: "out"; expr: string }
  | { kind: "if"; test: string; negate: boolean; then: Node[]; else: Node[] }
  | { kind: "each"; path: string; body: Node[]; else: Node[] }
  | { kind: "repeat"; count: string; body: Node[] };

const TAG = /\{\{\s*([#/]?)\s*([^}]*?)\s*\}\}/g;
const cache = new Map<string, Node[]>();
const MAX_REPEAT = 200;
const MAX_OUTPUT = 200_000;

export class TemplateError extends Error {}

export function parseTemplate(source: string): Node[] {
  const hit = cache.get(source);
  if (hit) return hit;
  const root: Node[] = [];
  const stack: { node: Node | null; list: Node[]; inElse: boolean; block: string }[] = [{ node: null, list: root, inElse: false, block: "" }];
  let last = 0;
  const top = () => stack[stack.length - 1];
  for (const match of source.matchAll(TAG)) {
    if (match.index! > last) top().list.push({ kind: "text", text: source.slice(last, match.index) });
    last = match.index! + match[0].length;
    const [, sigil, body] = match;
    if (sigil === "#") {
      const space = body.search(/\s/);
      const block = (space < 0 ? body : body.slice(0, space)).toLowerCase();
      const arg = space < 0 ? "" : body.slice(space + 1).trim();
      let node: Node;
      if (block === "if" || block === "unless") node = { kind: "if", test: arg, negate: block === "unless", then: [], else: [] };
      else if (block === "each") node = { kind: "each", path: arg, body: [], else: [] };
      else if (block === "repeat") node = { kind: "repeat", count: arg, body: [] };
      else throw new TemplateError(`Unknown block {{#${block}}}.`);
      top().list.push(node);
      stack.push({ node, list: node.kind === "if" ? node.then : node.body, inElse: false, block });
    } else if (sigil === "/") {
      const frame = top();
      if (stack.length === 1 || frame.block !== body.toLowerCase()) throw new TemplateError(`Unexpected {{/${body}}}.`);
      stack.pop();
    } else if (body === "else") {
      const frame = top();
      const node = frame.node;
      if (!node || frame.inElse || (node.kind !== "if" && node.kind !== "each")) throw new TemplateError("{{else}} outside {{#if}} or {{#each}}.");
      frame.inElse = true;
      frame.list = node.else;
    } else if (body) {
      top().list.push({ kind: "out", expr: body });
    }
  }
  if (stack.length > 1) throw new TemplateError(`{{#${top().block}}} is never closed.`);
  if (last < source.length) root.push({ kind: "text", text: source.slice(last) });
  if (cache.size > 200) cache.clear();
  cache.set(source, root);
  return root;
}

type Scope = { data: Record<string, unknown>; locals: Record<string, unknown> }[];

function lookup(path: string, scope: Scope): unknown {
  if (path === "this" || path === ".") return scope[scope.length - 1].locals.this ?? scope[scope.length - 1].data;
  const parts = path.split(".");
  const head = parts[0];
  let value: unknown;
  for (let i = scope.length - 1; i >= 0; i--) {
    const frame = scope[i];
    if (head.startsWith("@") || head === "this") {
      if (head in frame.locals) { value = frame.locals[head]; break; }
      continue;
    }
    if (head in frame.locals) { value = frame.locals[head]; break; }
    if (frame.data && typeof frame.data === "object" && head in frame.data) { value = frame.data[head]; break; }
  }
  for (const part of parts.slice(1)) {
    if (value === null || value === undefined) return undefined;
    if (part === "length" && (Array.isArray(value) || typeof value === "string")) { value = value.length; continue; }
    value = typeof value === "object" ? (value as Record<string, unknown>)[part] : undefined;
  }
  return value;
}

function literal(token: string): { ok: boolean; value?: unknown } {
  if (/^-?\d+(\.\d+)?$/.test(token)) return { ok: true, value: Number(token) };
  if (/^(["']).*\1$/.test(token)) return { ok: true, value: token.slice(1, -1) };
  if (token === "true") return { ok: true, value: true };
  if (token === "false") return { ok: true, value: false };
  if (token === "null") return { ok: true, value: null };
  return { ok: false };
}

function operand(token: string, scope: Scope): unknown {
  const lit = literal(token);
  return lit.ok ? lit.value : lookup(token, scope);
}

function truthy(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return Boolean(value) && value !== "0";
}

const COMPARE = /^(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+)$/;

function test(expr: string, scope: Scope): boolean {
  if (expr.startsWith("!")) return !test(expr.slice(1).trim(), scope);
  const or = expr.split(/\s+or\s+|\s*\|\|\s*/);
  if (or.length > 1) return or.some((part) => test(part, scope));
  const and = expr.split(/\s+and\s+|\s*&&\s*/);
  if (and.length > 1) return and.every((part) => test(part, scope));
  const match = COMPARE.exec(expr);
  if (!match) return truthy(evaluate(expr, scope));
  const a = operand(match[1].trim(), scope);
  const b = operand(match[3].trim(), scope);
  const numeric = typeof a === "number" || typeof b === "number";
  const x = numeric ? Number(a ?? 0) : String(a ?? "");
  const y = numeric ? Number(b ?? 0) : String(b ?? "");
  switch (match[2]) {
    case "==": return x === y;
    case "!=": return x !== y;
    case "<": return x < y;
    case "<=": return x <= y;
    case ">": return x > y;
    default: return x >= y;
  }
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "string") return value;
  if (typeof value === "boolean") return value ? "true" : "false";
  if (Array.isArray(value)) return value.map(toText).join(", ");
  try { return JSON.stringify(value); } catch { return ""; }
}

/** Filters after `|`: `{{value | fixed:1 | default:"—"}}`. */
const FILTERS: Record<string, (value: unknown, arg: unknown) => unknown> = {
  upper: (v) => toText(v).toUpperCase(),
  lower: (v) => toText(v).toLowerCase(),
  trim: (v) => toText(v).trim(),
  json: (v) => { try { return JSON.stringify(v ?? null); } catch { return ""; } },
  length: (v) => (Array.isArray(v) || typeof v === "string" ? v.length : 0),
  round: (v, d) => { const n = Number(v); const f = 10 ** Math.max(0, Math.min(8, Number(d) || 0)); return Number.isFinite(n) ? Math.round(n * f) / f : ""; },
  fixed: (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? n.toFixed(Math.max(0, Math.min(8, Number(d) || 0))) : ""; },
  percent: (v, d) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? `${(n * 100).toFixed(Math.max(0, Math.min(4, Number(d) || 0)))}%` : ""; },
  number: (v) => { const n = Number(v); return Number.isFinite(n) && v !== "" && v !== null && v !== undefined ? n.toLocaleString() : ""; },
  date: (v) => { const t = Date.parse(toText(v)); return Number.isNaN(t) ? toText(v) : new Date(t).toLocaleDateString(); },
  default: (v, d) => (v === undefined || v === null || v === "" ? d : v),
  truncate: (v, n) => { const s = toText(v); const max = Math.max(1, Number(n) || 40); return s.length > max ? `${s.slice(0, max - 1)}…` : s; },
  clamp01: (v) => Math.max(0, Math.min(1, Number(v) || 0)),
  min: (v, n) => Math.min(Number(v) || 0, Number(n)),
  max: (v, n) => Math.max(Number(v) || 0, Number(n)),
  times: (v, n) => (Number(v) || 0) * Number(n),
  plus: (v, n) => (Number(v) || 0) + Number(n),
  minus: (v, n) => (Number(v) || 0) - Number(n),
  divide: (v, n) => (Number(n) ? (Number(v) || 0) / Number(n) : 0),
  first: (v) => (Array.isArray(v) ? v[0] : v),
  join: (v, sep) => (Array.isArray(v) ? v.map(toText).join(typeof sep === "string" ? sep : ", ") : toText(v)),
};

function evaluate(expr: string, scope: Scope): unknown {
  const [head, ...pipes] = expr.split(/\s*\|\s*(?=[a-z])/i);
  let value = operand(head.trim(), scope);
  for (const pipe of pipes) {
    const colon = pipe.indexOf(":");
    const name = (colon < 0 ? pipe : pipe.slice(0, colon)).trim();
    const filter = FILTERS[name];
    if (!filter) throw new TemplateError(`Unknown filter "${name}".`);
    value = filter(value, colon < 0 ? undefined : operand(pipe.slice(colon + 1).trim(), scope));
  }
  return value;
}

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function run(nodes: Node[], scope: Scope, out: string[], budget: { left: number }) {
  for (const node of nodes) {
    if (budget.left <= 0) return;
    switch (node.kind) {
      case "text":
        out.push(node.text);
        budget.left -= node.text.length;
        break;
      case "out": {
        const text = escapeHtml(toText(evaluate(node.expr, scope)));
        out.push(text);
        budget.left -= text.length;
        break;
      }
      case "if":
        run(test(node.test, scope) !== node.negate ? node.then : node.else, scope, out, budget);
        break;
      case "each": {
        const value = evaluate(node.path, scope);
        const items = Array.isArray(value) ? value : value && typeof value === "object" ? Object.values(value) : [];
        const keys = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value) : null;
        if (!items.length) { run(node.else, scope, out, budget); break; }
        items.slice(0, MAX_REPEAT).forEach((item, index) => {
          const data = item && typeof item === "object" && !Array.isArray(item) ? (item as Record<string, unknown>) : {};
          run(node.body, [...scope, { data, locals: { this: item, "@index": index, "@number": index + 1, "@key": keys ? keys[index] : index, "@first": index === 0, "@last": index === items.length - 1 } }], out, budget);
        });
        break;
      }
      case "repeat": {
        const count = Math.max(0, Math.min(MAX_REPEAT, Math.floor(Number(evaluate(node.count, scope)) || 0)));
        for (let index = 0; index < count; index++) {
          run(node.body, [...scope, { data: {}, locals: { "@index": index, "@number": index + 1, "@first": index === 0, "@last": index === count - 1 } }], out, budget);
        }
        break;
      }
    }
  }
}

/** Renders a template to (unsanitized) HTML. Throws TemplateError on bad syntax. */
export function renderTemplate(source: string, data: Record<string, unknown>): string {
  const out: string[] = [];
  run(parseTemplate(source), [{ data, locals: {} }], out, { left: MAX_OUTPUT });
  return out.join("");
}

// ---- Sanitizer -------------------------------------------------------------

const ALLOWED_TAGS = new Set([
  "a", "abbr", "b", "bdi", "bdo", "blockquote", "br", "button", "caption", "code", "col", "colgroup", "dd", "del", "details", "div", "dl", "dt", "em",
  "figcaption", "figure", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins", "kbd", "label", "li", "mark", "meter", "ol", "p", "pre", "progress",
  "q", "s", "samp", "small", "span", "strong", "sub", "summary", "sup", "table", "tbody", "td", "tfoot", "th", "thead", "time", "tr", "u", "ul", "var", "wbr",
  // SVG for rings, sparklines, icons.
  "svg", "g", "path", "circle", "ellipse", "line", "polyline", "polygon", "rect", "text", "tspan", "defs", "lineargradient", "radialgradient", "stop", "title", "clippath", "mask", "use", "symbol",
]);
const DROP_WITH_CONTENT = new Set(["script", "style", "iframe", "object", "embed", "template", "noscript", "link", "meta", "base", "form", "input", "textarea", "select", "frame", "frameset", "foreignobject", "animate", "set", "animatemotion", "animatetransform"]);
const URL_ATTRS = new Set(["href", "src", "xlink:href", "action", "formaction", "poster", "background"]);

function safeUrl(value: string, attr: string): boolean {
  const url = value.trim().replace(/[\u0000-\u001f\s]+/g, "").toLowerCase();
  if (url.startsWith("#")) return true;
  if (attr === "src") return url.startsWith("data:image/") && !url.startsWith("data:image/svg");
  return /^(https?:|mailto:|tel:|noteral:)/.test(url) && attr === "href";
}

function cleanStyle(style: string): string {
  // No external fetches or legacy script hooks from inline styles.
  return /url\s*\(|expression\s*\(|@import|javascript:|behavior\s*:|-moz-binding/i.test(style) ? "" : style;
}

function cleanNode(node: Element) {
  for (const child of Array.from(node.children)) {
    const tag = child.tagName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) { child.remove(); continue; }
    if (!ALLOWED_TAGS.has(tag)) {
      cleanNode(child);
      child.replaceWith(...Array.from(child.childNodes));
      continue;
    }
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (name.startsWith("on") || name === "srcset" || name === "formaction" || name === "is") child.removeAttribute(attr.name);
      else if (URL_ATTRS.has(name)) { if (!safeUrl(attr.value, name)) child.removeAttribute(attr.name); }
      else if (name === "style") { const clean = cleanStyle(attr.value); if (clean) child.setAttribute("style", clean); else child.removeAttribute(attr.name); }
    }
    if (tag === "a") { child.setAttribute("target", "_blank"); child.setAttribute("rel", "noreferrer"); }
    if (tag === "button" && !child.getAttribute("type")) child.setAttribute("type", "button");
    cleanNode(child);
  }
}

/** Strips script, event handlers, remote loads and form controls; returns a fragment. */
export function sanitizeFragment(html: string): DocumentFragment {
  const template = document.createElement("template");
  template.innerHTML = html;
  const holder = document.createElement("div");
  holder.append(template.content);
  cleanNode(holder);
  const fragment = document.createDocumentFragment();
  fragment.append(...Array.from(holder.childNodes));
  return fragment;
}

export function sanitizeHtml(html: string): string {
  const holder = document.createElement("div");
  holder.append(sanitizeFragment(html));
  return holder.innerHTML;
}

/** CSS for a cell's shadow root: no imports or remote urls (data: urls are fine). */
export function sanitizeCss(css: string): string {
  return css
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, "none")
    .replace(/expression\s*\(|behavior\s*:|-moz-binding/gi, "");
}

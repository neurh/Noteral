import { AlertCircle, ArrowUp, BookOpen, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CornerDownLeft, Loader2, Redo2, Search, Sparkles, Square, Undo2, X } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useAppStore } from "../../store";
import { askOnce, type OneShot } from "../../assistant/oneshot";
import { toggleAssistant } from "../../assistant/open";
import { useAssistant } from "../../assistant/store";
import { NUMBER_FORMATS, TITLE_ID, propertyById, type DatabaseRow, type NumberFormat, type Property } from "../../lib/database";
import { previewFormula } from "../../lib/databaseFormulas";
import { canRedo, canUndo, createHistory, record, redo as redoEdit, undo as undoEdit, type EditHistory, type EditKind } from "../../lib/editHistory";
import { FORMULA_EXAMPLE_PROPS, detailsOf } from "../../lib/formulaDocs";
import {
  FORMULA_FUNCTIONS,
  compileFormula,
  completionsAt,
  formatFormulaValue,
  formulaPosition,
  formulaSpans,
  matchingBracket,
  signatureAt,
  tokenize,
  typeOfValue,
  type FormulaCompletion,
  type FormulaFunctionDoc,
  type FormulaType,
} from "../../lib/formula";
import {
  FORMULA_ASK_SYSTEM,
  checkProposal,
  formulaAskPrompt,
  formulaRepairPrompt,
  parseFormulaReply,
  type FormulaAskInput,
  type FormulaAskMode,
} from "../../lib/formulaAssist";
import { Modal } from "../Modal";
import { FormulaRichText } from "./FormulaRichText";
import { PropertyIcon } from "./parts";
import { Popover } from "./Popover";
import type { DatabaseApi } from "./useDatabase";

const DATE_FORMATS = [
  { id: "relative", name: "Relative" },
  { id: "short", name: "Short" },
  { id: "long", name: "Long" },
  { id: "iso", name: "ISO" },
] as const;
type DateFormat = (typeof DATE_FORMATS)[number]["id"];

const CATEGORIES: FormulaFunctionDoc["category"][] = ["Properties", "Logic", "Math", "Text", "Date", "List", "Type"];
const TYPE_NAMES: Record<FormulaType, string> = { number: "Number", text: "Text", checkbox: "Checkbox", date: "Date", list: "List", empty: "Empty" };
/** Rows evaluated for the result type, the error count and the row switcher. */
const SUMMARY_ROWS = 200;
const TYPE_LABELS: Record<Property["type"], string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  multiSelect: "Multi-select",
  status: "Status",
  date: "Date",
  checkbox: "Checkbox",
  url: "URL",
  email: "Email",
  phone: "Phone",
  createdTime: "Created",
  lastEdited: "Edited",
  formula: "Formula",
};

/** Wraps a name as a property reference ({Name} unless the name has a brace). */
const propRef = (name: string) => (name.includes("}") ? `prop("${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")` : `{${name}}`);

interface HighlightProps {
  source: string;
  error?: { start: number; end: number };
  brackets?: [number, number] | null;
  /** 1-based line with the caret (gets a lit line number). */
  currentLine?: number;
  errorLine?: number;
}

/**
 * Syntax-highlighted source, one block per line so wrapped lines keep their
 * line number (drawn by CSS in the left padding) aligned with the textarea.
 */
function Highlight({ source, error, brackets, currentLine, errorLine }: HighlightProps) {
  const tokens = useMemo(() => tokenize(source), [source]);
  const lines: ReactNode[][] = [[]];
  for (const token of tokens) {
    const bad = error && token.start < Math.max(error.end, error.start + 1) && token.end > error.start;
    const match = brackets && (token.start === brackets[0] || token.start === brackets[1]);
    const className = `fx-t-${token.type}${bad ? " is-error" : ""}${match ? " is-match" : ""}`;
    token.text.split("\n").forEach((part, index) => {
      if (index) lines.push([]);
      if (part)
        lines[lines.length - 1].push(
          <span key={`${token.start}:${index}`} className={className}>
            {part}
          </span>,
        );
    });
  }
  // A caret-only error past the end (e.g. a missing ")") still needs a mark.
  if (error && error.start >= source.length && source.length) {
    lines[lines.length - 1].push(<span key="eof" className="fx-t-eof is-error">{" "}</span>);
  }
  return (
    <>
      {lines.map((line, index) => (
        <span
          key={index}
          className={`fx-line${index + 1 === currentLine ? " is-current" : ""}${index + 1 === errorLine ? " is-error-line" : ""}`}
          data-line={index + 1}
        >
          {line}
        </span>
      ))}
    </>
  );
}

/** Splits "fn(a, b, c?)" into its parameter names (top-level commas only). */
function signatureParams(signature: string): { head: string; params: string[]; tail: string } {
  const open = signature.indexOf("(");
  const close = signature.lastIndexOf(")");
  if (open < 0 || close < open) return { head: signature, params: [], tail: "" };
  const inner = signature.slice(open + 1, close);
  const params: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < inner.length; i++) {
    const c = inner[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      params.push(inner.slice(start, i).trim());
      start = i + 1;
    }
  }
  if (inner.trim()) params.push(inner.slice(start).trim());
  return { head: signature.slice(0, open + 1), params, tail: signature.slice(close) };
}

function SignatureHelp({ doc, arg }: { doc: FormulaFunctionDoc; arg: number }) {
  const { head, params, tail } = signatureParams(doc.signature);
  // Variadic signatures ("a, b, …") keep the last real parameter lit past the end.
  const lastReal = params.length - (params[params.length - 1]?.includes("…") ? 2 : 1);
  const lit = arg < params.length ? (params[arg]?.includes("…") ? Math.max(0, lastReal) : arg) : Math.max(0, lastReal);
  return (
    <div className="fx-signature" aria-live="polite">
      <code>
        {head}
        {params.map((param, index) => (
          <Fragment key={index}>
            {index ? ", " : ""}
            <span className={index === lit ? "is-current" : ""}>{param}</span>
          </Fragment>
        ))}
        {tail}
      </code>
      <span className="fx-signature-desc">{doc.description}</span>
    </div>
  );
}

/** A formula value for the preview: formatted text, styled spans, or "empty". */
function PreviewValue({ value, numberFormat, dateFormat }: { value: unknown; numberFormat: NumberFormat; dateFormat: DateFormat }): ReactNode {
  const v = value as Parameters<typeof formatFormulaValue>[0];
  const kind = typeOfValue(v);
  if (kind === "empty") return <span className="fx-faint">empty</span>;
  const spans = formulaSpans(v);
  if (spans) return <FormulaRichText spans={spans} />;
  if (kind === "checkbox") return <span className={`fx-check ${v ? "is-on" : ""}`}>{v ? "✓ Checked" : "Unchecked"}</span>;
  return <>{formatFormulaValue(v, { numberFormat, dateFormat })}</>;
}

/** Prev / next and a searchable list of rows, each with its result, to pick the previewed row. */
function RowSwitcher({
  rows,
  index,
  results,
  numberFormat,
  dateFormat,
  onPick,
}: {
  rows: DatabaseRow[];
  index: number;
  results: Map<string, { value: unknown; error?: string }>;
  numberFormat: NumberFormat;
  dateFormat: DateFormat;
  onPick: (rowId: string) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [query, setQuery] = useState("");
  const row = rows[index];
  const needle = query.trim().toLowerCase();
  const shown = (needle ? rows.filter((item) => (item.meta.title || "Untitled").toLowerCase().includes(needle)) : rows).slice(0, 100);
  const step = (by: number) => {
    const next = rows[(index + by + rows.length) % rows.length];
    if (next) onPick(next.id);
  };
  return (
    <div className="fx-rows">
      <button type="button" className="icon-button tiny" aria-label="Previous row" title="Previous row" onClick={() => step(-1)} disabled={rows.length < 2}>
        <ChevronLeft size={14} />
      </button>
      <button
        type="button"
        className="fx-rows-trigger"
        aria-haspopup="listbox"
        aria-expanded={!!anchor}
        title="Choose the row to preview"
        onClick={(event) => {
          setQuery("");
          setAnchor(anchor ? null : event.currentTarget);
        }}
      >
        <span className="fx-rows-title">{row?.meta.title || "Untitled"}</span>
        <span className="fx-rows-count">
          {index + 1} / {rows.length}
        </span>
        <ChevronDown size={13} aria-hidden />
      </button>
      <button type="button" className="icon-button tiny" aria-label="Next row" title="Next row" onClick={() => step(1)} disabled={rows.length < 2}>
        <ChevronRight size={14} />
      </button>
      {anchor ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-end" width={300} label="Preview row" className="fx-rows-popover">
          <div className="db-menu">
            <div className="db-menu-pad">
              <input
                className="db-input"
                autoFocus
                placeholder="Find a row…"
                aria-label="Find a row"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && shown[0]) {
                    onPick(shown[0].id);
                    setAnchor(null);
                  }
                }}
              />
            </div>
            <div className="db-menu-scroll fx-rows-list" role="listbox" aria-label="Rows">
              {shown.map((item) => {
                const result = results.get(item.id);
                return (
                  <button
                    key={item.id}
                    type="button"
                    role="option"
                    aria-selected={item.id === row?.id}
                    className={`db-menu-item fx-rows-item ${item.id === row?.id ? "is-current" : ""}`}
                    onClick={() => {
                      onPick(item.id);
                      setAnchor(null);
                    }}
                  >
                    <span className="fx-rows-item-title">{item.meta.title || "Untitled"}</span>
                    <span className={`fx-rows-item-value ${result?.error ? "is-error" : ""}`}>
                      {result ? (
                        result.error ? (
                          <>
                            <AlertCircle size={11} aria-hidden /> Error
                          </>
                        ) : (
                          <PreviewValue value={result.value} numberFormat={numberFormat} dateFormat={dateFormat} />
                        )
                      ) : null}
                    </span>
                  </button>
                );
              })}
              {!shown.length ? <div className="fx-empty">No row matches “{query}”.</div> : null}
            </div>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/** Text with `code` spans. */
function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`)/g);
  return (
    <>
      {parts.map((part, index) => (part.startsWith("`") && part.endsWith("`") && part.length > 2 ? <code key={index}>{part.slice(1, -1)}</code> : <Fragment key={index}>{part}</Fragment>))}
    </>
  );
}

const SAMPLE_ROW = FORMULA_EXAMPLE_PROPS.map((item) => `${item.name} = ${item.display}`).join(" · ");

/**
 * Reference for one function, under the code: signature, what it does, its
 * parameters, verified examples (click one to insert it), notes and related
 * functions.
 */
function FunctionDoc({ doc, onInsert, onShow }: { doc: FormulaFunctionDoc | null; onInsert: (text: string) => void; onShow: (name: string) => void }) {
  if (!doc) {
    return (
      <section className="fx-doc is-empty" aria-label="Function reference">
        <BookOpen size={15} aria-hidden />
        <p>Put the caret inside a function, or hover one in the Functions list, to see what it does, its parameters and examples.</p>
      </section>
    );
  }
  const details = detailsOf(doc.name);
  const examples = details?.examples.length ? details.examples : doc.example ? [{ code: doc.example, result: doc.result ?? "" }] : [];
  return (
    <section className="fx-doc" aria-label={`${doc.name} reference`}>
      <div className="fx-doc-head">
        <code className="fx-doc-sig">{doc.signature}</code>
        <span className="fx-doc-cat">{doc.category}</span>
        {details?.returns ? <span className="fx-doc-returns">Returns {details.returns}</span> : null}
      </div>
      <p className="fx-doc-desc">
        <InlineCode text={doc.description} />
        {details?.summary ? (
          <>
            {" "}
            <InlineCode text={details.summary} />
          </>
        ) : null}
      </p>
      {details?.params.length ? (
        <dl className="fx-doc-params">
          {details.params.map((param) => (
            <div key={param.name} className="fx-doc-param">
              <dt>
                <code>
                  {param.name}
                  {param.repeat ? "…" : ""}
                </code>
                {param.optional ? <span className="fx-doc-optional">optional</span> : null}
              </dt>
              <dd>
                <span className="fx-doc-type">{param.type}</span> <InlineCode text={param.description} />
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      {examples.length ? (
        <div className="fx-doc-examples">
          <div className="fx-doc-label">
            Examples <span className="fx-faint" title={SAMPLE_ROW}>· on a sample row</span>
          </div>
          {examples.map((example) => (
            <button
              key={example.code}
              type="button"
              className="fx-doc-example"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => onInsert(example.code)}
              title="Insert this example"
            >
              <code className="fx-doc-code">{example.code}</code>
              {example.result ? <span className="fx-doc-result">{example.result}</span> : null}
              {"note" in example && example.note ? <span className="fx-doc-note">{example.note}</span> : null}
            </button>
          ))}
        </div>
      ) : null}
      {details?.notes?.length ? (
        <ul className="fx-doc-notes">
          {details.notes.map((note) => (
            <li key={note}>
              <InlineCode text={note} />
            </li>
          ))}
        </ul>
      ) : null}
      {details?.related?.length ? (
        <div className="fx-doc-related">
          <span>See also</span>
          {details.related.map((name) => (
            <button key={name} type="button" className="fx-doc-link" onClick={() => onShow(name)}>
              {name}
            </button>
          ))}
        </div>
      ) : null}
    </section>
  );
}

/** Ready-made requests for an empty AI tab. */
const AI_STARTERS = ["Days left until a date property", "Show a red “Overdue” label when a date has passed", "Combine two properties into one label", "Percent of a goal, rounded"];

type SaveState = "saved" | "pending" | "invalid";

type AskState =
  | { phase: "idle" }
  | { phase: "running"; mode: FormulaAskMode; text: string; retrying?: boolean }
  | { phase: "proposal"; mode: FormulaAskMode; formula?: string; note: string; error?: string }
  | { phase: "failed"; message: string; setup?: boolean };

interface FormulaEditorProps {
  db: DatabaseApi;
  property: Property;
  /** Row the preview starts on (the clicked cell's row); defaults to the first row. */
  previewRowId?: string;
  onClose: () => void;
}

/**
 * Formula editor: highlighted multi-line source with line numbers,
 * completions, signature help and bracket matching; a live preview for the
 * first rows; a searchable function reference; and "Ask AI" to write, fix or
 * explain the formula with the user's AI provider.
 */
export function FormulaEditor({ db, property, previewRowId, onClose }: FormulaEditorProps) {
  const [previewId, setPreviewId] = useState<string | undefined>(previewRowId);
  const [history, setHistory] = useState<EditHistory>(() => createHistory(property.formula ?? ""));
  const source = history.present.text;
  const [cursor, setCursor] = useState(source.length);
  const [sideTab, setSideTab] = useState<"functions" | "ai">("functions");
  const [focused, setFocused] = useState(true);
  const [active, setActive] = useState(0);
  // Completions open while typing (or on Ctrl+Space), not when the caret is
  // merely placed in a name: then the function's docs show instead.
  const [dismissed, setDismissed] = useState(true);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<FormulaFunctionDoc["category"] | "All">("All");
  const [focusDoc, setFocusDoc] = useState<FormulaFunctionDoc | null>(null);
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(property.format ?? "number");
  const [dateFormat, setDateFormat] = useState<DateFormat>(property.dateFormat ?? "relative");
  const [askText, setAskText] = useState("");
  const [ask, setAsk] = useState<AskState>({ phase: "idle" });
  const input = useRef<HTMLTextAreaElement>(null);
  // A hovered function's docs give way to the caret's function once you type.
  useEffect(() => setFocusDoc(null), [history.present.text]);
  const overlay = useRef<HTMLPreElement>(null);
  const call = useRef<OneShot | null>(null);

  // Cancel any running request when the editor closes.
  useEffect(() => () => call.current?.cancel(), []);

  // Other properties, by name; the formula itself is excluded (it can't refer to itself).
  const referable = useMemo(
    () => [propertyById(db.schema, TITLE_ID)!, ...db.schema.properties].filter((item) => item && item.id !== property.id),
    [db.schema, property.id],
  );
  const names = useMemo(() => referable.map((item) => item.name), [referable]);

  const compiled = useMemo(() => (source.trim() ? compileFormula(source) : null), [source]);
  const error = useMemo(() => {
    if (!compiled) return undefined;
    if (!compiled.ok) return compiled.error;
    return checkProposal(source, db.schema, property.id) ?? undefined;
  }, [compiled, source, db.schema, property.id]);
  // Schema with this draft in place, so previews see the edit and not the saved formula.
  const draftSchema = useMemo(
    () => ({ ...db.schema, properties: db.schema.properties.map((item) => (item.id === property.id ? { ...item, formula: source } : item)) }),
    [db.schema, property.id, source],
  );
  const previews = useMemo(() => {
    if (!compiled?.ok || error) return [];
    return db.rows.slice(0, SUMMARY_ROWS).map((row) => ({ row, ...previewFormula(source, row, draftSchema) }));
  }, [compiled, error, db.rows, source, draftSchema]);
  const resultById = useMemo(() => new Map(previews.map((item) => [item.row.id, item])), [previews]);
  const previewIndex = Math.max(0, db.rows.findIndex((row) => row.id === previewId));
  const previewRow = db.rows[previewIndex];
  const preview = useMemo(() => {
    if (!previewRow || !compiled?.ok || error) return null;
    return resultById.get(previewRow.id) ?? { row: previewRow, ...previewFormula(source, previewRow, draftSchema) };
  }, [previewRow, compiled, error, resultById, source, draftSchema]);
  const firstErrorRow = previews.find((item) => item.error)?.row;
  const resultType: FormulaType | null = useMemo(() => {
    const kinds = previews.filter((item) => !item.error).map((item) => typeOfValue(item.value)).filter((kind) => kind !== "empty");
    if (!kinds.length) return previews.length ? "empty" : null;
    const counts = new Map<FormulaType, number>();
    for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [previews]);
  const rowErrors = previews.filter((item) => item.error).length;

  const suggest = useMemo(() => (dismissed || !focused ? null : completionsAt(source, cursor, names)), [source, cursor, names, dismissed, focused]);
  const suggestions = suggest?.items.slice(0, 8) ?? [];
  useEffect(() => setActive(0), [suggest?.from, suggestions.length]);
  const signature = useMemo(() => (focused ? signatureAt(source, cursor) : null), [source, cursor, focused]);
  const brackets = useMemo(() => (focused ? matchingBracket(source, cursor) : null), [source, cursor, focused]);
  const lineCount = useMemo(() => source.split("\n").length, [source]);
  const caret = formulaPosition(source, cursor);

  // The caret to restore after the next render. Applied synchronously in a
  // layout effect: deferring it (rAF) lets fast typing land at the old caret.
  const pendingCaret = useRef<number | null>(null);
  useLayoutEffect(() => {
    const position = pendingCaret.current;
    const el = input.current;
    if (position === null || !el) return;
    pendingCaret.current = null;
    if (document.activeElement !== el) el.focus();
    el.setSelectionRange(position, position);
  });

  const focusAt = (position: number) => {
    pendingCaret.current = position;
    setCursor(position);
  };

  /** Records an edit in the undo history. */
  const commit = (text: string, caret: number, kind?: EditKind) => setHistory((current) => record(current, { text, caret }, kind));

  const step = (direction: "undo" | "redo") => {
    const next = direction === "undo" ? undoEdit(history) : redoEdit(history);
    if (next === history) return;
    setHistory(next);
    setDismissed(true);
    focusAt(next.present.caret);
  };

  const replaceRange = (from: number, to: number, text: string) => {
    const next = source.slice(0, from) + text + source.slice(to);
    commit(next, from + text.length, "replace");
    setDismissed(false);
    focusAt(from + text.length);
  };

  /** Inserts at the caret, replacing any selection. */
  const insert = (text: string) => {
    const el = input.current;
    const start = el?.selectionStart ?? source.length;
    const end = el?.selectionEnd ?? start;
    replaceRange(start, end, text);
  };

  const accept = (item: FormulaCompletion) => {
    if (!suggest) return;
    replaceRange(suggest.from, suggest.to, item.insert);
  };

  // ── Saving ─────────────────────────────────────────────────────────
  // Every valid edit saves itself shortly after typing stops; an edit with an
  // error keeps the last working formula until it's fixed.
  const wanted = useMemo(
    () => ({
      formula: source.trim(),
      format: resultType === "number" ? (numberFormat === "number" ? undefined : numberFormat) : property.format,
      dateFormat: resultType === "date" ? (dateFormat === "relative" ? undefined : dateFormat) : property.dateFormat,
    }),
    [source, resultType, numberFormat, dateFormat, property.format, property.dateFormat],
  );
  const saved = useRef({ formula: (property.formula ?? "").trim(), format: property.format, dateFormat: property.dateFormat });
  const pending = useRef<typeof wanted | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const write = (next: typeof wanted) => {
    pending.current = null;
    saved.current = next;
    db.updateSchema((target) => {
      const hit = target.properties.find((item) => item.id === property.id);
      if (!hit) return;
      hit.formula = next.formula;
      hit.format = next.format;
      hit.dateFormat = next.dateFormat;
    });
  };
  const same = (a: typeof wanted, b: typeof wanted) => a.formula === b.formula && a.format === b.format && a.dateFormat === b.dateFormat;
  useEffect(() => {
    if (error) {
      pending.current = null;
      setSaveState(wanted.formula === saved.current.formula ? "saved" : "invalid");
      return;
    }
    if (same(wanted, saved.current)) {
      pending.current = null;
      setSaveState("saved");
      return;
    }
    pending.current = wanted;
    setSaveState("pending");
    const timer = window.setTimeout(() => {
      write(wanted);
      setSaveState("saved");
    }, 450);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wanted, error]);
  // Closing saves what's waiting, and says when an unfinished edit was left out.
  const closing = useRef({ invalid: false });
  closing.current.invalid = saveState === "invalid";
  useEffect(
    () => () => {
      if (pending.current) write(pending.current);
      else if (closing.current.invalid) useAppStore.getState().notify("The formula had an error, so the last working version was kept.", "info");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // ── Ask AI ────────────────────────────────────────────────────────────
  const hasProvider = useAssistant((state) => !state.ready || state.providers.some((p) => p.enabled));

  const runAsk = async (mode: FormulaAskMode) => {
    if (ask.phase === "running") return;
    if (mode === "write" && !askText.trim()) return;
    const request: FormulaAskInput = {
      mode,
      request: askText,
      source,
      error: error ? error.message : undefined,
      schema: db.schema,
      rows: db.rows,
      propertyId: property.id,
    };
    setAsk({ phase: "running", mode, text: "" });
    const attempt = async (prompt: string, retrying: boolean) => {
      const shot = askOnce({
        system: FORMULA_ASK_SYSTEM,
        prompt,
        maxTokens: 1500,
        onText: (text) => setAsk((state) => (state.phase === "running" ? { ...state, text, retrying } : state)),
      });
      call.current = shot;
      const result = await shot.result;
      if (call.current === shot) call.current = null;
      return result;
    };
    let result = await attempt(formulaAskPrompt(request), false);
    if (result.cancelled) return setAsk({ phase: "idle" });
    if (result.error) {
      const setup = /provider|model/i.test(result.error) && /first/.test(result.error);
      return setAsk({ phase: "failed", message: result.error, setup });
    }
    let reply = parseFormulaReply(result.text);
    let problem = reply.formula ? checkProposal(reply.formula, db.schema, property.id) : null;
    if (reply.formula && problem) {
      // One retry, telling the model exactly what failed.
      setAsk({ phase: "running", mode, text: "", retrying: true });
      result = await attempt(formulaRepairPrompt(request, reply.formula, problem.message), true);
      if (result.cancelled) return setAsk({ phase: "idle" });
      if (!result.error) {
        const second = parseFormulaReply(result.text);
        if (second.formula) {
          reply = second;
          problem = checkProposal(second.formula, db.schema, property.id);
        }
      }
    }
    if (!reply.formula && mode !== "explain") {
      return setAsk({ phase: "failed", message: reply.note ? reply.note.slice(0, 400) : "The model didn't return a formula. Try describing it differently." });
    }
    // An explanation that only echoes the current formula has nothing to apply.
    const same = reply.formula !== undefined && reply.formula.trim() === source.trim();
    setAsk({ phase: "proposal", mode, formula: same ? undefined : reply.formula, note: reply.note, error: same ? undefined : problem?.message });
  };

  const stopAsk = () => {
    call.current?.cancel();
    call.current = null;
    setAsk({ phase: "idle" });
  };

  const applyProposal = () => {
    if (ask.phase !== "proposal" || !ask.formula) return;
    commit(ask.formula, ask.formula.length, "replace");
    setAsk({ phase: "idle" });
    setAskText("");
    setDismissed(true);
    focusAt(ask.formula.length);
  };

  const openAISettings = () => {
    useAssistant.getState().setView("providers");
    toggleAssistant(true);
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key === "Enter") {
      event.preventDefault();
      onClose();
      return;
    }
    if (mod && !event.altKey && (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y")) {
      event.preventDefault();
      step(event.key.toLowerCase() === "y" || event.shiftKey ? "redo" : "undo");
      return;
    }
    if (mod && event.key === " ") {
      event.preventDefault();
      setDismissed(false);
      return;
    }
    if (suggestions.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((index) => (index + 1) % suggestions.length);
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((index) => (index - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (event.key === "Tab" || event.key === "Enter") {
        event.preventDefault();
        accept(suggestions[active] ?? suggestions[0]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setDismissed(true);
        return;
      }
    }
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      insert("  ");
      return;
    }
    if (event.key === "Enter" && !event.shiftKey) {
      // Keep the indentation of the current line.
      const el = event.currentTarget;
      const start = el.selectionStart;
      const lineStart = source.lastIndexOf("\n", start - 1) + 1;
      const indent = /^[ \t]*/.exec(source.slice(lineStart, start))?.[0] ?? "";
      const opener = /[([]\s*$/.test(source.slice(lineStart, start));
      event.preventDefault();
      insert(`\n${indent}${opener ? "  " : ""}`);
    }
  };

  const onAskKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void runAsk("write");
    } else if (event.key === "Escape") {
      event.preventDefault();
      if (ask.phase === "running") stopAsk();
      else if (ask.phase !== "idle") setAsk({ phase: "idle" });
      else onClose();
    }
  };

  const filteredDocs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FORMULA_FUNCTIONS.filter(
      (fn) =>
        (category === "All" || fn.category === category) &&
        (!needle || fn.name.toLowerCase().includes(needle) || fn.description.toLowerCase().includes(needle)),
    );
  }, [query, category]);
  const filteredProps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (category !== "All" && category !== "Properties") return [];
    return referable.filter((item) => !needle || item.name.toLowerCase().includes(needle));
  }, [referable, query, category]);

  // The function whose name the caret is on, e.g. "dateB|etween(".
  const wordDoc = useMemo(() => {
    if (!focused) return null;
    let start = cursor;
    let end = cursor;
    while (start > 0 && /[A-Za-z0-9_]/.test(source[start - 1])) start--;
    while (end < source.length && /[A-Za-z0-9_]/.test(source[end])) end++;
    const word = source.slice(start, end).toLowerCase();
    return word ? FORMULA_FUNCTIONS.find((fn) => fn.name.toLowerCase() === word) ?? null : null;
  }, [focused, source, cursor]);
  const shownDoc =
    focusDoc ??
    wordDoc ??
    (suggestions[active]?.kind === "function" ? FORMULA_FUNCTIONS.find((fn) => fn.name === suggestions[active].label) ?? null : null) ??
    signature?.doc ??
    null;
  const showDoc = (name: string) => {
    const hit = FORMULA_FUNCTIONS.find((fn) => fn.name.toLowerCase() === name.toLowerCase());
    if (hit) setFocusDoc(hit);
  };
  const errorAt = error ? formulaPosition(source, error.start) : null;
  const errorText = error ? source.slice(error.start, Math.min(error.end, error.start + 24)).trim() : "";

  return (
    <Modal open title={property.name || "Formula"} subtitle="Formula" onClose={onClose} width="large" className="fx-modal" bodyClassName="fx-body">
      <div className="fx-main">
        <div className="fx-toolbar">
          <div className="fx-toolbar-group" role="group" aria-label="History">
            <button type="button" className="icon-button tiny" onClick={() => step("undo")} disabled={!canUndo(history)} aria-label="Undo" title="Undo (Ctrl+Z)">
              <Undo2 size={14} />
            </button>
            <button type="button" className="icon-button tiny" onClick={() => step("redo")} disabled={!canRedo(history)} aria-label="Redo" title="Redo (Ctrl+Shift+Z)">
              <Redo2 size={14} />
            </button>
          </div>
          {resultType === "number" ? (
            <label className="fx-toolbar-format">
              <span>Format</span>
              <select className="db-select" value={numberFormat} onChange={(event) => setNumberFormat(event.target.value as NumberFormat)}>
                {NUMBER_FORMATS.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          {resultType === "date" ? (
            <label className="fx-toolbar-format">
              <span>Format</span>
              <select className="db-select" value={dateFormat} onChange={(event) => setDateFormat(event.target.value as DateFormat)}>
                {DATE_FORMATS.map((format) => (
                  <option key={format.id} value={format.id}>
                    {format.name}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <span className={`fx-save is-${saveState}`} aria-live="polite">
            {saveState === "saved" ? (
              <>
                <Check size={13} aria-hidden /> Saved
              </>
            ) : saveState === "pending" ? (
              <>
                <Loader2 size={13} className="fx-spin" aria-hidden /> Saving…
              </>
            ) : (
              <>
                <AlertCircle size={13} aria-hidden /> Not saved: fix the error
              </>
            )}
          </span>
        </div>

        <div className={`fx-editor ${error ? "has-error" : ""} ${lineCount > 1 ? "is-multiline" : ""}`} style={{ ["--fx-gutter" as string]: `${String(lineCount).length + 2.4}ch` }}>
          <div className="fx-code">
            <pre ref={overlay} className="fx-highlight" aria-hidden>
              <Highlight source={source} error={error} brackets={brackets} currentLine={focused ? caret.line : undefined} errorLine={errorAt?.line} />
            </pre>
            <textarea
              ref={input}
              className="fx-input"
              value={source}
              autoFocus
              spellCheck={false}
              autoCapitalize="off"
              autoCorrect="off"
              aria-label="Formula"
              aria-autocomplete="list"
              aria-invalid={Boolean(error)}
              placeholder={'if({Status} == "Done", style("Done", "green"), fromNow({Due}))'}
              onChange={(event) => {
                commit(event.target.value, event.target.selectionStart);
                setCursor(event.target.selectionStart);
                setDismissed(false);
              }}
              onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
              onClick={() => setDismissed(true)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={onKeyDown}
              onScroll={(event) => {
                if (overlay.current) {
                  overlay.current.scrollTop = event.currentTarget.scrollTop;
                  overlay.current.scrollLeft = event.currentTarget.scrollLeft;
                }
              }}
            />
          </div>
        </div>

        {suggestions.length ? (
          <div className="fx-suggest" role="listbox" aria-label="Suggestions">
            {suggestions.map((item, index) => (
              <button
                key={`${item.kind}:${item.label}`}
                type="button"
                role="option"
                aria-selected={index === active}
                className={`fx-suggest-item ${index === active ? "is-active" : ""}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => accept(item)}
              >
                <span className={`fx-kind is-${item.kind}`}>{item.kind === "property" ? "P" : item.kind === "keyword" ? "K" : "ƒ"}</span>
                <span className="fx-suggest-label">{item.label}</span>
                {item.detail ? <span className="fx-suggest-detail">{item.detail}</span> : null}
              </button>
            ))}
            <span className="fx-suggest-hint">
              <CornerDownLeft size={11} aria-hidden /> Tab or Enter to insert · Esc to hide
            </span>
          </div>
        ) : signature ? (
          <SignatureHelp doc={signature.doc} arg={signature.arg} />
        ) : null}

        <div className={`fx-status ${error ? "is-error" : compiled ? "is-ok" : ""}`} aria-live="polite">
          {error ? (
            <>
              <AlertCircle size={14} aria-hidden />
              <span>
                {errorAt && lineCount > 1 ? <span className="fx-pos">Line {errorAt.line}, col {errorAt.column}</span> : null}
                {error.message}
                {errorText && !error.message.includes(errorText) ? (
                  <>
                    {" "}
                    at <code>{errorText}</code>
                  </>
                ) : null}
              </span>
              {source.trim() && hasProvider ? (
                <button
                  type="button"
                  className="fx-link-button fx-status-fix"
                  onClick={() => {
                    setSideTab("ai");
                    void runAsk("fix");
                  }}
                >
                  Fix with AI
                </button>
              ) : null}
            </>
          ) : compiled ? (
            <>
              <CheckCircle2 size={14} aria-hidden />
              <span>Looks good</span>
              {resultType ? <span className={`fx-type-badge is-${resultType}`}>{TYPE_NAMES[resultType]}</span> : null}
            </>
          ) : (
            <span>Write an expression. Refer to properties with {"{Name}"} or prop("Name"); use // for notes.</span>
          )}
        </div>

        <section className="fx-preview" aria-label="Preview">
          <div className="fx-preview-head">
            <span className="fx-section-label">Preview</span>
            {db.rows.length ? (
              <RowSwitcher
                rows={db.rows}
                index={previewIndex}
                results={resultById}
                numberFormat={numberFormat}
                dateFormat={dateFormat}
                onPick={(id) => setPreviewId(id)}
              />
            ) : null}
          </div>
          {!db.rows.length ? (
            <div className="fx-empty">Add a row to see results.</div>
          ) : !compiled?.ok || error ? (
            <div className="fx-empty">{error ? "Fix the error to see the result." : "The result shows here as you type."}</div>
          ) : preview && previewRow ? (
            <div className="fx-result">
              <div className={`fx-result-value ${preview.error ? "is-error" : ""} type-${typeOfValue(preview.value)}`} aria-live="polite">
                {preview.error ? (
                  <>
                    <AlertCircle size={14} aria-hidden /> <span>{preview.error}</span>
                  </>
                ) : (
                  <PreviewValue value={preview.value} numberFormat={numberFormat} dateFormat={dateFormat} />
                )}
              </div>
            </div>
          ) : null}
          {previews.length > 1 ? (
            <div className="fx-preview-foot">
              {rowErrors ? (
                <>
                  <AlertCircle size={12} aria-hidden />
                  <span>{rowErrors === 1 ? "1 row has an error" : `${rowErrors} rows have errors`}</span>
                  {firstErrorRow && firstErrorRow.id !== previewRow?.id ? (
                    <button type="button" className="fx-link-button" onClick={() => setPreviewId(firstErrorRow.id)}>
                      Show {rowErrors === 1 ? "it" : "the first"}
                    </button>
                  ) : null}
                </>
              ) : (
                <>
                  <CheckCircle2 size={12} aria-hidden />
                  <span>
                    Works for {previews.length === db.rows.length ? "all" : `the first ${previews.length} of`} {db.rows.length} rows
                  </span>
                </>
              )}
            </div>
          ) : null}
        </section>

        <FunctionDoc doc={shownDoc} onInsert={insert} onShow={showDoc} />
      </div>

      <aside className="fx-side" aria-label="Functions and AI">
        <div className="fx-side-tabs" role="tablist" aria-label="Side panel">
          <button type="button" role="tab" aria-selected={sideTab === "functions"} className={`fx-side-tab ${sideTab === "functions" ? "is-on" : ""}`} onClick={() => setSideTab("functions")}>
            <BookOpen size={13} aria-hidden /> Functions
          </button>
          <button type="button" role="tab" aria-selected={sideTab === "ai"} className={`fx-side-tab ${sideTab === "ai" ? "is-on" : ""}`} onClick={() => setSideTab("ai")}>
            <Sparkles size={13} aria-hidden /> Ask AI
            {ask.phase === "running" ? <span className="fx-side-dot" aria-label="working" /> : ask.phase === "proposal" && sideTab !== "ai" ? <span className="fx-side-dot is-ready" aria-label="answer ready" /> : null}
          </button>
        </div>
        {sideTab === "functions" ? (
          <div className="fx-ref" role="tabpanel" aria-label="Functions">
          <label className="fx-ref-search">
            <Search size={13} aria-hidden />
            <input
              value={query}
              placeholder="Search functions"
              aria-label="Search functions and properties"
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          </label>
          <div className="fx-ref-cats" role="tablist" aria-label="Categories">
            {(["All", ...CATEGORIES] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                aria-selected={category === item}
                className={`fx-cat ${category === item ? "is-on" : ""}`}
                onClick={() => setCategory(item)}
              >
                {item}
              </button>
            ))}
          </div>
          <div className="fx-ref-list">
            {filteredProps.length ? (
              <>
                <div className="fx-section-label">Properties</div>
                {filteredProps.map((item) => (
                  <button key={item.id} type="button" className="fx-ref-item" onClick={() => insert(propRef(item.name))} title={`Insert ${propRef(item.name)}`}>
                    <PropertyIcon property={item} size={13} />
                    <span className="fx-ref-name">{item.name}</span>
                    <span className="fx-ref-type">{item.id === TITLE_ID ? "Title" : TYPE_LABELS[item.type] ?? item.type}</span>
                  </button>
                ))}
              </>
            ) : null}
            {CATEGORIES.map((group) => {
              const items = filteredDocs.filter((fn) => fn.category === group);
              if (!items.length) return null;
              return (
                <Fragment key={group}>
                  <div className="fx-section-label">{group === "Properties" ? "Reference" : group}</div>
                  {items.map((fn) => (
                    <button
                      key={fn.name}
                      type="button"
                      className={`fx-ref-item ${shownDoc?.name === fn.name ? "is-active" : ""}`}
                      onMouseEnter={() => setFocusDoc(fn)}
                      onFocus={() => setFocusDoc(fn)}
                      onClick={() => insert(fn.signature.includes("(") ? `${fn.name}(` : fn.name)}
                      title={fn.signature}
                    >
                      <span className="fx-kind is-function">ƒ</span>
                      <span className="fx-ref-name">{fn.name}</span>
                    </button>
                  ))}
                </Fragment>
              );
            })}
            {!filteredDocs.length && !filteredProps.length ? <div className="fx-empty">Nothing matches “{query}”.</div> : null}
          </div>
          </div>
        ) : (
          <section className={`fx-ai is-${ask.phase}`} aria-label="Ask AI">
            <div className="fx-ai-feed">
              {ask.phase === "idle" ? (
                !hasProvider ? (
                  <div className="fx-ai-empty">
                    <Sparkles size={16} aria-hidden />
                    <p>Connect an AI provider to have formulas written, fixed and explained for you.</p>
                    <button type="button" className="secondary-button fx-ai-button" onClick={openAISettings}>
                      Set up a provider
                    </button>
                  </div>
                ) : (
                  <div className="fx-ai-empty">
                    <p>
                      Describe the result you want. AI writes the formula from this database's properties, then checks it before you apply it.
                    </p>
                    {source.trim() ? (
                      <div className="fx-ai-quick">
                        {error ? (
                          <button type="button" className="fx-ai-chip is-strong" onClick={() => void runAsk("fix")}>
                            <Sparkles size={12} aria-hidden /> Fix the error
                          </button>
                        ) : (
                          <button type="button" className="fx-ai-chip is-strong" onClick={() => void runAsk("explain")}>
                            <BookOpen size={12} aria-hidden /> Explain this formula
                          </button>
                        )}
                      </div>
                    ) : null}
                    <div className="fx-ai-label">Try</div>
                    <div className="fx-ai-quick">
                      {AI_STARTERS.map((text) => (
                        <button key={text} type="button" className="fx-ai-chip" onClick={() => setAskText(text)}>
                          {text}
                        </button>
                      ))}
                    </div>
                  </div>
                )
              ) : null}
              {ask.phase === "running" ? (
                <div className="fx-ai-status" aria-live="polite">
                  <Loader2 size={14} className="fx-spin" aria-hidden />
                  <span>{ask.retrying ? "Checking and correcting the formula…" : ask.mode === "explain" ? "Reading the formula…" : ask.mode === "fix" ? "Fixing the formula…" : "Writing the formula…"}</span>
                </div>
              ) : null}
              {ask.phase === "failed" ? (
                <div className="fx-ai-card is-error" role="alert">
                  <AlertCircle size={14} aria-hidden />
                  <p>{ask.message}</p>
                  {ask.setup ? (
                    <button type="button" className="secondary-button fx-ai-button" onClick={openAISettings}>
                      Open AI settings
                    </button>
                  ) : null}
                  <button type="button" className="icon-button tiny" onClick={() => setAsk({ phase: "idle" })} aria-label="Dismiss" title="Dismiss">
                    <X size={13} />
                  </button>
                </div>
              ) : null}
              {ask.phase === "proposal" ? (
                <div className="fx-ai-card">
                  {ask.formula ? (
                    <pre className="fx-ai-code">
                      <Highlight source={ask.formula} />
                    </pre>
                  ) : null}
                  {ask.note ? <p className="fx-ai-note">{ask.note}</p> : null}
                  {ask.error ? (
                    <p className="fx-ai-warning">
                      <AlertCircle size={13} aria-hidden /> Still has a problem: {ask.error}
                    </p>
                  ) : null}
                  <div className="fx-ai-actions">
                    {ask.formula ? (
                      <button type="button" className="primary-button fx-ai-button" onClick={applyProposal}>
                        {ask.error ? "Apply anyway" : "Apply"}
                      </button>
                    ) : null}
                    <button type="button" className="secondary-button fx-ai-button" onClick={() => setAsk({ phase: "idle" })}>
                      {ask.formula ? "Discard" : "Done"}
                    </button>
                  </div>
                  {ask.formula ? <p className="fx-ai-foot">Applying replaces the code. Ctrl+Z brings the old one back.</p> : null}
                </div>
              ) : null}
            </div>
            <div className={`fx-ai-composer ${hasProvider ? "" : "is-disabled"}`}>
              <textarea
                value={askText}
                className="fx-ai-input"
                rows={3}
                placeholder={source.trim() ? "Ask AI to change this formula…" : "Describe what this formula should do…"}
                aria-label="Describe the formula for AI"
                disabled={ask.phase === "running" || !hasProvider}
                onChange={(event) => setAskText(event.target.value)}
                onKeyDown={onAskKeyDown}
              />
              <div className="fx-ai-composer-row">
                <span className="fx-faint">Enter to send · Shift+Enter for a new line</span>
                {ask.phase === "running" ? (
                  <button type="button" className="secondary-button fx-ai-button" onClick={stopAsk}>
                    <Square size={11} aria-hidden /> Stop
                  </button>
                ) : (
                  <button type="button" className="primary-button fx-ai-send" onClick={() => void runAsk("write")} disabled={!askText.trim() || !hasProvider} aria-label="Ask AI" title="Ask AI (Enter)">
                    <ArrowUp size={15} />
                  </button>
                )}
              </div>
            </div>
          </section>
        )}
      </aside>
    </Modal>
  );
}

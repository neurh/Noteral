import { AlertCircle, CheckCircle2, Search } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { NUMBER_FORMATS, TITLE_ID, propertyById, type NumberFormat, type Property } from "../../lib/database";
import { previewFormula } from "../../lib/databaseFormulas";
import {
  FORMULA_FUNCTIONS,
  compileFormula,
  completionsAt,
  formatFormulaValue,
  tokenize,
  typeOfValue,
  type FormulaCompletion,
  type FormulaFunctionDoc,
  type FormulaType,
} from "../../lib/formula";
import { Modal } from "../Modal";
import { PropertyIcon } from "./parts";
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
const PREVIEW_ROWS = 5;

/** Wraps a name as a property reference. */
const propRef = (name: string) => `prop("${name.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;

function Highlight({ source, error }: { source: string; error?: { start: number; end: number } }) {
  const tokens = useMemo(() => tokenize(source), [source]);
  return (
    <>
      {tokens.map((token) => {
        const bad = error && token.start < Math.max(error.end, error.start + 1) && token.end > error.start;
        return (
          <span key={token.start} className={`fx-t-${token.type} ${bad ? "is-error" : ""}`}>
            {token.text}
          </span>
        );
      })}
      {/* Keeps a trailing newline visible so the overlay matches the textarea. */}
      {"\n"}
    </>
  );
}

interface FormulaEditorProps {
  db: DatabaseApi;
  property: Property;
  onClose: () => void;
}

/**
 * Formula editor: highlighted source with completions, a live result for the
 * first rows, and a searchable function reference.
 */
export function FormulaEditor({ db, property, onClose }: FormulaEditorProps) {
  const [source, setSource] = useState(property.formula ?? "");
  const [cursor, setCursor] = useState(source.length);
  const [active, setActive] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [query, setQuery] = useState("");
  const [focusDoc, setFocusDoc] = useState<FormulaFunctionDoc | null>(null);
  const [numberFormat, setNumberFormat] = useState<NumberFormat>(property.format ?? "number");
  const [dateFormat, setDateFormat] = useState<DateFormat>(property.dateFormat ?? "relative");
  const input = useRef<HTMLTextAreaElement>(null);
  const overlay = useRef<HTMLPreElement>(null);

  // Other properties, by name; the formula itself is excluded (it can't refer to itself).
  const names = useMemo(
    () => [propertyById(db.schema, TITLE_ID)!, ...db.schema.properties].filter((item) => item.id !== property.id).map((item) => item.name),
    [db.schema, property.id],
  );
  const others = useMemo(() => db.schema.properties.filter((item) => item.id !== property.id), [db.schema.properties, property.id]);

  const compiled = useMemo(() => (source.trim() ? compileFormula(source) : null), [source]);
  const error = compiled && !compiled.ok ? compiled.error : undefined;
  // Schema with this draft in place, so previews see the edit and not the saved formula.
  const draftSchema = useMemo(
    () => ({ ...db.schema, properties: db.schema.properties.map((item) => (item.id === property.id ? { ...item, formula: source } : item)) }),
    [db.schema, property.id, source],
  );
  const previews = useMemo(() => {
    if (!compiled?.ok) return [];
    return db.rows.slice(0, PREVIEW_ROWS).map((row) => ({ row, ...previewFormula(source, row, draftSchema) }));
  }, [compiled, db.rows, source, draftSchema]);
  const resultType: FormulaType | null = useMemo(() => {
    const kinds = previews.filter((item) => !item.error).map((item) => typeOfValue(item.value)).filter((kind) => kind !== "empty");
    if (!kinds.length) return previews.length ? "empty" : null;
    const counts = new Map<FormulaType, number>();
    for (const kind of kinds) counts.set(kind, (counts.get(kind) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0];
  }, [previews]);

  const suggest = useMemo(() => (dismissed ? null : completionsAt(source, cursor, names)), [source, cursor, names, dismissed]);
  const suggestions = suggest?.items.slice(0, 8) ?? [];
  useEffect(() => setActive(0), [suggest?.from, suggestions.length]);

  const focusAt = (position: number) => {
    requestAnimationFrame(() => {
      const el = input.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(position, position);
      setCursor(position);
    });
  };

  const replaceRange = (from: number, to: number, text: string) => {
    const next = source.slice(0, from) + text + source.slice(to);
    setSource(next);
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

  const save = () => {
    if (error) return;
    db.updateSchema((target) => {
      const hit = target.properties.find((item) => item.id === property.id);
      if (!hit) return;
      hit.formula = source.trim();
      if (resultType === "number") hit.format = numberFormat === "number" ? undefined : numberFormat;
      if (resultType === "date") hit.dateFormat = dateFormat === "relative" ? undefined : dateFormat;
    });
    onClose();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      save();
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
    }
  };

  const filteredDocs = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return FORMULA_FUNCTIONS.filter((fn) => !needle || fn.name.toLowerCase().includes(needle) || fn.description.toLowerCase().includes(needle));
  }, [query]);
  const filteredProps = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return [propertyById(db.schema, TITLE_ID)!, ...others].filter((item) => !needle || item.name.toLowerCase().includes(needle));
  }, [db.schema, others, query]);

  const shownDoc = focusDoc ?? (suggestions[active]?.kind === "function" ? FORMULA_FUNCTIONS.find((fn) => fn.name === suggestions[active].label) ?? null : null);
  const formatOpts = { numberFormat, dateFormat };

  return (
    <Modal
      open
      title={property.name || "Formula"}
      subtitle="Formula"
      onClose={onClose}
      width="large"
      className="fx-modal"
      bodyClassName="fx-body"
      footer={
        <>
          <div className="fx-footer-format">
            {resultType === "number" ? (
              <label>
                Number format
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
              <label>
                Date format
                <select className="db-select" value={dateFormat} onChange={(event) => setDateFormat(event.target.value as DateFormat)}>
                  {DATE_FORMATS.map((format) => (
                    <option key={format.id} value={format.id}>
                      {format.name}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
          </div>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={save} disabled={Boolean(error)} title="Save (Ctrl+Enter)">
            Save formula
          </button>
        </>
      }
    >
      <div className="fx-main">
        <div className={`fx-editor ${error ? "has-error" : ""}`}>
          <pre ref={overlay} className="fx-highlight" aria-hidden>
            <Highlight source={source} error={error} />
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
            placeholder={'if(prop("Status") == "Done", "✓", dateBetween(prop("Due"), now(), "days") + " days left")'}
            onChange={(event) => {
              setSource(event.target.value);
              setCursor(event.target.selectionStart);
              setDismissed(false);
            }}
            onSelect={(event) => setCursor(event.currentTarget.selectionStart)}
            onClick={() => setDismissed(false)}
            onKeyDown={onKeyDown}
            onScroll={(event) => {
              if (overlay.current) {
                overlay.current.scrollTop = event.currentTarget.scrollTop;
                overlay.current.scrollLeft = event.currentTarget.scrollLeft;
              }
            }}
          />
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
            <span className="fx-suggest-hint">Tab to insert · Esc to hide</span>
          </div>
        ) : null}

        <div className={`fx-status ${error ? "is-error" : compiled ? "is-ok" : ""}`} aria-live="polite">
          {error ? (
            <>
              <AlertCircle size={14} />
              <span>
                {error.message}
                {source.slice(error.start, error.end).trim() && !error.message.includes(source.slice(error.start, error.end).trim()) ? (
                  <>
                    {" "}
                    at <code>{source.slice(error.start, Math.min(error.end, error.start + 24))}</code>
                  </>
                ) : null}
              </span>
            </>
          ) : compiled ? (
            <>
              <CheckCircle2 size={14} />
              <span>{resultType ? `Returns ${TYPE_NAMES[resultType].toLowerCase()}` : "Looks good"}</span>
            </>
          ) : (
            <span>Write an expression. Refer to properties with prop("Name") or {"{Name}"}.</span>
          )}
        </div>

        <div className="fx-preview">
          <div className="fx-section-label">Preview</div>
          {!db.rows.length ? <div className="fx-empty">Add a row to see results.</div> : null}
          {previews.map(({ row, value, error: rowError }) => (
            <div key={row.id} className="fx-preview-row">
              <span className="fx-preview-title">{row.meta.title || "Untitled"}</span>
              <span className={`fx-preview-value ${rowError ? "is-error" : ""} type-${typeOfValue(value)}`}>
                {rowError ? rowError : typeOfValue(value) === "empty" ? <span className="fx-faint">empty</span> : formatFormulaValue(value, formatOpts)}
              </span>
            </div>
          ))}
          {!compiled?.ok && db.rows.length ? <div className="fx-empty">{error ? "Fix the error to see results." : "Results show here as you type."}</div> : null}
        </div>
      </div>

      <aside className="fx-ref" aria-label="Formula reference">
        <label className="fx-ref-search">
          <Search size={13} />
          <input
            value={query}
            placeholder="Search functions"
            aria-label="Search functions and properties"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => event.stopPropagation()}
          />
        </label>
        <div className="fx-ref-list">
          {filteredProps.length ? (
            <>
              <div className="fx-section-label">Properties</div>
              {filteredProps.map((item) => (
                <button key={item.id} type="button" className="fx-ref-item" onClick={() => insert(propRef(item.name))} title={`Insert ${propRef(item.name)}`}>
                  <PropertyIcon property={item} size={13} />
                  <span>{item.name}</span>
                </button>
              ))}
            </>
          ) : null}
          {CATEGORIES.map((category) => {
            const items = filteredDocs.filter((fn) => fn.category === category);
            if (!items.length) return null;
            return (
              <Fragment key={category}>
                <div className="fx-section-label">{category === "Properties" ? "Reference" : category}</div>
                {items.map((fn) => (
                  <button
                    key={fn.name}
                    type="button"
                    className={`fx-ref-item ${shownDoc?.name === fn.name ? "is-active" : ""}`}
                    onMouseEnter={() => setFocusDoc(fn)}
                    onFocus={() => setFocusDoc(fn)}
                    onClick={() => insert(fn.signature.includes("(") ? `${fn.name}(` : fn.name)}
                  >
                    <span className="fx-kind is-function">ƒ</span>
                    <span>{fn.name}</span>
                  </button>
                ))}
              </Fragment>
            );
          })}
          {!filteredDocs.length && !filteredProps.length ? <div className="fx-empty">Nothing matches “{query}”.</div> : null}
        </div>
        <div className="fx-doc">
          {shownDoc ? (
            <>
              <code className="fx-doc-sig">{shownDoc.signature}</code>
              <p>{shownDoc.description}</p>
              <code className="fx-doc-example">{shownDoc.example}</code>
              {shownDoc.result ? <span className="fx-doc-result">→ {shownDoc.result}</span> : null}
            </>
          ) : (
            <p className="fx-faint">Hover a function to see how it works. Click to insert it.</p>
          )}
        </div>
      </aside>
    </Modal>
  );
}

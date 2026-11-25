import { ArrowUpRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  TITLE_ID,
  cellValue,
  dateEnd,
  dateStart,
  formatDate,
  formatDateTime,
  formatNumber,
  normalizeUrl,
  optionById,
  type DatabaseRow,
  type DateValue,
  type Property,
} from "../../lib/database";
import type { DatabaseApi } from "./useDatabase";
import { DatePicker } from "./DatePicker";
import { OptionPicker } from "./OptionPicker";
import { OptionChip } from "./parts";
import { Popover } from "./Popover";

export function isInlineEditable(property: Property): boolean {
  return ["text", "number", "url", "email", "phone"].includes(property.type) || property.id === TITLE_ID;
}

export function isEditable(property: Property): boolean {
  return property.type !== "createdTime" && property.type !== "lastEdited" && property.type !== "formula";
}

function relativeDay(start: string): string {
  const date = new Date(start.length <= 10 ? `${start}T00:00:00` : start);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  const diff = Math.round((day.getTime() - today.getTime()) / 86_400_000);
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff === -1) return "Yesterday";
  if (Math.abs(diff) < 14) return diff > 0 ? `In ${diff} days` : `${-diff} days ago`;
  return formatDate(start.slice(0, 10));
}

/** Display text of a formula's date result in its chosen format. */
export function formulaDateText(property: Property, start: string): string {
  if (!start) return "";
  const hasTime = start.length > 10;
  switch (property.dateFormat) {
    case "relative":
      return relativeDay(start);
    case "iso":
      return start.slice(0, hasTime ? 16 : 10).replace("T", " ");
    case "long": {
      const date = new Date(hasTime ? start : `${start}T00:00:00`);
      return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString(undefined, { weekday: "short", year: "numeric", month: "long", day: "numeric", ...(hasTime ? { hour: "numeric", minute: "2-digit" } : {}) });
    }
    default:
      return hasTime ? formatDateTime(start) : formatDate(start);
  }
}

function linkHref(property: Property, text: string): string {
  if (property.type === "email") return `mailto:${text}`;
  if (property.type === "phone") return `tel:${text.replace(/[^0-9+]/g, "")}`;
  return normalizeUrl(text);
}

/** Read-only rendering of a property value. */
export function CellDisplay({ property, row, compact }: { property: Property; row: DatabaseRow; compact?: boolean }) {
  const value = cellValue(row, property);
  switch (property.type) {
    case "select":
    case "status": {
      const option = optionById(property, value);
      return option ? <OptionChip option={option} status={property.type === "status"} /> : null;
    }
    case "multiSelect": {
      const ids = Array.isArray(value) ? value : [];
      const options = ids.map((id) => optionById(property, id)).filter((o) => !!o);
      if (!options.length) return null;
      return (
        <span className={`db-chips ${compact ? "is-compact" : ""}`}>
          {options.map((option) => <OptionChip key={option!.id} option={option} />)}
        </span>
      );
    }
    case "checkbox":
      return <span className={`db-checkbox ${value ? "is-checked" : ""}`} aria-hidden />;
    case "number": {
      const text = formatNumber(value, property.format);
      return text ? <span className="db-number">{text}</span> : null;
    }
    case "date": {
      const start = dateStart(value);
      if (!start) return null;
      const end = dateEnd(value);
      return <span className="db-text">{end ? `${formatDate(start)} → ${formatDate(end)}` : formatDate(start)}</span>;
    }
    case "createdTime":
    case "lastEdited":
      return typeof value === "string" ? <span className="db-text is-muted">{formatDateTime(value)}</span> : null;
    case "formula": {
      if (value === undefined || value === null || value === "") return null;
      switch (property.resultType) {
        case "number": {
          const text = formatNumber(value, property.format);
          return text ? <span className="db-number is-formula">{text}</span> : null;
        }
        case "checkbox":
          return <span className={`db-checkbox is-readonly ${value ? "is-checked" : ""}`} aria-label={value ? "true" : "false"} />;
        case "date": {
          const start = typeof value === "object" ? String((value as DateValue).start ?? "") : String(value);
          return <span className="db-text is-formula">{formulaDateText(property, start)}</span>;
        }
        default:
          return <span className="db-text is-formula">{String(value)}</span>;
      }
    }
    case "url":
    case "email":
    case "phone": {
      const text = typeof value === "string" ? value : "";
      if (!text) return null;
      return (
        <a
          className="db-link"
          href={linkHref(property, text)}
          target="_blank"
          rel="noreferrer"
          onClick={(event) => event.stopPropagation()}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {property.type === "url" ? text.replace(/^https?:\/\//, "") : text}
        </a>
      );
    }
    default: {
      const text = typeof value === "string" ? value : "";
      return text ? <span className="db-text">{text}</span> : null;
    }
  }
}

interface CellEditorProps {
  property: Property;
  row: DatabaseRow;
  db: DatabaseApi;
  anchor: HTMLElement;
  onClose: () => void;
  /** Tab / Shift+Tab / Enter navigation out of a text editor. */
  onNavigate?: (direction: "next" | "prev" | "down") => void;
}

/** Text-like inline editor laid over the cell. */
function TextEditor({ property, row, db, anchor, onClose, onNavigate }: CellEditorProps) {
  const isTitle = property.id === TITLE_ID;
  const initial = (() => {
    const value = cellValue(row, property);
    if (property.type === "number") return typeof value === "number" ? String(value) : "";
    return typeof value === "string" ? value : "";
  })();
  const [text, setText] = useState(isTitle && initial === "Untitled" ? "" : initial);
  const committed = useRef(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const multiline = property.type === "text";

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.focus({ preventScroll: true });
    node.setSelectionRange(node.value.length, node.value.length);
  }, []);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.style.height = "0px";
    node.style.height = `${node.scrollHeight}px`;
  }, [text]);

  function commit() {
    if (committed.current) return;
    committed.current = true;
    if (isTitle) {
      const clean = text.trim() || "Untitled";
      if (clean !== row.meta.title) db.renameRow(row.id, clean);
      return;
    }
    if (property.type === "number") {
      const trimmed = text.trim().replace(/[,\s$€£¥]/g, "");
      const previous = cellValue(row, property);
      let next: number | undefined;
      if (trimmed === "") next = undefined;
      else {
        const parsed = trimmed.endsWith("%") ? Number(trimmed.slice(0, -1)) / 100 : Number(trimmed);
        if (!Number.isFinite(parsed)) return; // Not a number: keep what was there.
        next = parsed;
      }
      if (next !== previous) db.setValue(row.id, property.id, next);
      return;
    }
    const clean = property.type === "text" ? text : text.trim();
    if (clean !== initial) db.setValue(row.id, property.id, clean);
  }

  return (
    <Popover anchor={anchor} onClose={() => { commit(); onClose(); }} placement="cover" matchWidth className="db-cell-popover" label={`Edit ${property.name}`}>
      <textarea
        ref={ref}
        className={`db-cell-input ${property.type === "number" ? "is-number" : ""}`}
        value={text}
        rows={1}
        inputMode={property.type === "number" ? "decimal" : property.type === "email" ? "email" : property.type === "phone" ? "tel" : property.type === "url" ? "url" : "text"}
        placeholder={isTitle ? "Untitled" : property.type === "url" ? "Paste a link" : ""}
        aria-label={property.name}
        spellCheck={multiline}
        onChange={(event) => setText(multiline ? event.target.value : event.target.value.replace(/\n/g, ""))}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            committed.current = true;
            onClose();
          } else if (event.key === "Enter" && !(multiline && event.shiftKey)) {
            event.preventDefault();
            commit();
            onClose();
            onNavigate?.("down");
          } else if (event.key === "Tab") {
            event.preventDefault();
            commit();
            onClose();
            onNavigate?.(event.shiftKey ? "prev" : "next");
          }
        }}
      />
      {(property.type === "url" || property.type === "email" || property.type === "phone") && text.trim() ? (
        <a className="db-cell-open-link" href={linkHref(property, text.trim())} target="_blank" rel="noreferrer">
          <ArrowUpRight size={13} /> Open
        </a>
      ) : null}
    </Popover>
  );
}

/** The editor for a single cell, chosen by property type. */
export function CellEditor(props: CellEditorProps) {
  const { property, row, db, anchor, onClose } = props;
  if (isInlineEditable(property)) return <TextEditor {...props} />;
  if (property.type === "select" || property.type === "status" || property.type === "multiSelect") {
    const value = cellValue(row, property);
    const selected = property.type === "multiSelect" ? (Array.isArray(value) ? (value as string[]) : []) : typeof value === "string" ? [value] : [];
    return (
      <Popover anchor={anchor} onClose={onClose} placement="cover" width={290} matchWidth className="db-cell-popover is-panel" label={`Edit ${property.name}`}>
        <OptionPicker
          property={property}
          selected={selected}
          multi={property.type === "multiSelect"}
          updateSchema={db.updateSchema}
          onChange={(ids) => db.setValue(row.id, property.id, property.type === "multiSelect" ? ids : ids[0])}
          onDone={onClose}
        />
      </Popover>
    );
  }
  if (property.type === "date") {
    const value = cellValue(row, property);
    const start = dateStart(value);
    const current: DateValue | null = start ? { start, ...(dateEnd(value) ? { end: dateEnd(value) } : {}) } : null;
    return (
      <Popover anchor={anchor} onClose={onClose} placement="bottom-start" width={268} className="is-panel" label={`Edit ${property.name}`}>
        <DatePicker value={current} onChange={(next) => db.setValue(row.id, property.id, next ?? undefined)} />
      </Popover>
    );
  }
  return null;
}

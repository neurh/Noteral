import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import {
  dateEnd,
  dateStart,
  localDateOf,
  parseISODate,
  propertyById,
  toISODate,
  type DatabaseRow,
  type DatabaseView,
  type RowValues,
} from "../../lib/database";
import { PageIcon } from "../PageIcon";
import { monthGrid } from "./DatePicker";
import type { DatabaseApi } from "./useDatabase";

interface CalendarViewProps {
  db: DatabaseApi;
  view: DatabaseView;
  rows: DatabaseRow[];
  onAddRow: (values?: RowValues) => void;
  onOpenSettings: (anchor: HTMLElement) => void;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function dayKey(date: Date) {
  return toISODate(date);
}

function addDays(iso: string, days: number): string {
  const date = parseISODate(iso);
  if (!date) return iso;
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

function daysBetween(a: string, b: string): number {
  const da = parseISODate(a);
  const db = parseISODate(b);
  if (!da || !db) return 0;
  return Math.round((db.getTime() - da.getTime()) / 86400000);
}

export function CalendarView({ db, view, rows, onAddRow, onOpenSettings }: CalendarViewProps) {
  const property = view.dateProperty ? propertyById(db.schema, view.dateProperty) : undefined;
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [overDay, setOverDay] = useState<string | null>(null);
  const today = dayKey(new Date());
  const days = useMemo(() => monthGrid(month), [month]);

  const byDay = useMemo(() => {
    const map = new Map<string, DatabaseRow[]>();
    if (!property) return map;
    const first = dayKey(days[0]);
    const last = dayKey(days[days.length - 1]);
    for (const row of rows) {
      const raw = property.type === "createdTime" ? row.meta.createdAt : property.type === "lastEdited" ? row.meta.updatedAt : row.values[property.id];
      const start = property.type === "date" ? dateStart(raw) : typeof raw === "string" ? localDateOf(raw) : "";
      if (!start) continue;
      const end = property.type === "date" ? dateEnd(raw) || start : start;
      // Multi-day entries show on every day they cover, capped to the visible grid.
      let day = start < first ? first : start;
      const stop = end > last ? last : end;
      let guard = 0;
      while (day <= stop && guard < 42) {
        const list = map.get(day) ?? [];
        list.push(row);
        map.set(day, list);
        day = addDays(day, 1);
        guard += 1;
      }
    }
    return map;
  }, [rows, property, days]);

  if (!property) {
    return (
      <div className="db-empty-state">
        <p>Calendar views place pages on a Date property.</p>
        <button type="button" className="secondary-button" onClick={(event) => onOpenSettings(event.currentTarget)}>
          Choose a date property
        </button>
      </div>
    );
  }

  const editable = property.type === "date";
  const label = month.toLocaleDateString(undefined, { month: "long", year: "numeric" });

  function moveTo(rowId: string, day: string) {
    if (!property || !editable) return;
    const row = db.rows.find((r) => r.id === rowId);
    if (!row) return;
    const raw = row.values[property.id];
    const start = dateStart(raw);
    const end = dateEnd(raw);
    if (start === day) return;
    const value = end && start ? { start: day, end: addDays(day, daysBetween(start, end)) } : { start: day };
    db.setValue(rowId, property.id, value);
  }

  return (
    <div className="db-calendar">
      <div className="db-calendar-bar">
        <h3 className="db-calendar-title">{label}</h3>
        <div className="db-calendar-nav">
          <button type="button" className="icon-button tiny" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
            <ChevronLeft size={15} />
          </button>
          <button
            type="button"
            className="text-button db-calendar-today"
            onClick={() => {
              const now = new Date();
              setMonth(new Date(now.getFullYear(), now.getMonth(), 1));
            }}
          >
            Today
          </button>
          <button type="button" className="icon-button tiny" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
            <ChevronRight size={15} />
          </button>
        </div>
      </div>
      <div className="db-calendar-grid" role="grid" aria-label={label}>
        {WEEKDAYS.map((name) => (
          <div key={name} className="db-calendar-weekday" role="columnheader">
            {name}
          </div>
        ))}
        {days.map((date) => {
          const key = dayKey(date);
          const items = byDay.get(key) ?? [];
          const outside = date.getMonth() !== month.getMonth();
          return (
            <div
              key={key}
              role="gridcell"
              className={`db-calendar-day ${outside ? "is-outside" : ""} ${key === today ? "is-today" : ""} ${overDay === key ? "is-over" : ""}`}
              onDragOver={(event) => {
                if (!dragRow || !editable) return;
                event.preventDefault();
                if (overDay !== key) setOverDay(key);
              }}
              onDragLeave={(event) => {
                if (!event.currentTarget.contains(event.relatedTarget as Node)) setOverDay((current) => (current === key ? null : current));
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragRow) moveTo(dragRow, key);
                setDragRow(null);
                setOverDay(null);
              }}
            >
              <div className="db-calendar-day-head">
                {editable ? (
                  <button type="button" className="icon-button tiny db-calendar-add" aria-label={`New page on ${date.toLocaleDateString()}`} onClick={() => onAddRow({ [property.id]: { start: key } })}>
                    <Plus size={13} />
                  </button>
                ) : null}
                <span className="db-calendar-num">{date.getDate() === 1 ? date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : date.getDate()}</span>
              </div>
              <div className="db-calendar-items">
                {items.slice(0, 4).map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`db-calendar-item ${dragRow === row.id ? "is-dragging" : ""}`}
                    draggable={editable}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("application/x-noteral-row", row.id);
                      setDragRow(row.id);
                    }}
                    onDragEnd={() => {
                      setDragRow(null);
                      setOverDay(null);
                    }}
                    onClick={() => db.openRow(row.id)}
                    title={row.meta.title}
                  >
                    {row.meta.icon ? <PageIcon value={row.meta.icon} size={12} /> : null}
                    <span>{row.meta.title || "Untitled"}</span>
                  </button>
                ))}
                {items.length > 4 ? <span className="db-calendar-more">+{items.length - 4} more</span> : null}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { formatDate, parseISODate, toISODate, type DateValue } from "../../lib/database";

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/** Monday-first 6x7 grid of dates around `month`. */
export function monthGrid(month: Date): Date[] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i));
}

function parseTyped(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return parseISODate(trimmed) ? trimmed : null;
  const parsed = new Date(trimmed);
  return Number.isNaN(parsed.getTime()) ? null : toISODate(parsed);
}

interface DatePickerProps {
  value: DateValue | null;
  onChange: (value: DateValue | null) => void;
  /** Offer an end date (property values); filters pick a single day. */
  allowRange?: boolean;
}

export function DatePicker({ value, onChange, allowRange = true }: DatePickerProps) {
  const start = value?.start ?? "";
  const end = value?.end ?? "";
  const [rangeOn, setRangeOn] = useState(!!end);
  const [editingEnd, setEditingEnd] = useState(false);
  const [month, setMonth] = useState(() => parseISODate(start) ?? new Date());
  const [startText, setStartText] = useState(start ? formatDate(start) : "");
  const [endText, setEndText] = useState(end ? formatDate(end) : "");
  const days = useMemo(() => monthGrid(month), [month]);
  const today = toISODate(new Date());

  function commit(next: DateValue | null) {
    setStartText(next?.start ? formatDate(next.start) : "");
    setEndText(next?.end ? formatDate(next.end) : "");
    onChange(next);
  }

  function pick(day: string) {
    if (!rangeOn) {
      commit({ start: day });
      return;
    }
    if (editingEnd && start) {
      const [a, b] = day < start ? [day, start] : [start, day];
      commit({ start: a, end: b });
      setEditingEnd(false);
    } else {
      commit({ start: day, ...(end && end >= day ? { end } : {}) });
      setEditingEnd(true);
    }
  }

  return (
    <div className="db-datepicker">
      <div className={`db-date-inputs ${rangeOn ? "is-range" : ""}`}>
        <input
          className={`db-input ${!editingEnd ? "is-active" : ""}`}
          value={startText}
          placeholder="Start date"
          aria-label="Start date"
          onFocus={() => setEditingEnd(false)}
          onChange={(event) => setStartText(event.target.value)}
          onBlur={() => {
            const parsed = parseTyped(startText);
            if (parsed === null && startText.trim()) setStartText(start ? formatDate(start) : "");
            else if (parsed !== start) commit(parsed ? { start: parsed, ...(end && end >= parsed ? { end } : {}) } : null);
            if (parsed) setMonth(parseISODate(parsed) ?? month);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
          }}
        />
        {rangeOn ? (
          <input
            className={`db-input ${editingEnd ? "is-active" : ""}`}
            value={endText}
            placeholder="End date"
            aria-label="End date"
            onFocus={() => setEditingEnd(true)}
            onChange={(event) => setEndText(event.target.value)}
            onBlur={() => {
              const parsed = parseTyped(endText);
              if (!start) return;
              if (parsed === null && endText.trim()) setEndText(end ? formatDate(end) : "");
              else if (parsed !== end) commit({ start, ...(parsed && parsed >= start ? { end: parsed } : {}) });
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") (event.currentTarget as HTMLInputElement).blur();
            }}
          />
        ) : null}
      </div>
      <div className="db-cal-head">
        <span className="db-cal-month">{month.toLocaleDateString(undefined, { month: "long", year: "numeric" })}</span>
        <button type="button" className="db-ghost" onClick={() => setMonth(new Date())}>Today</button>
        <button type="button" className="icon-button tiny" aria-label="Previous month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>
          <ChevronLeft size={14} />
        </button>
        <button type="button" className="icon-button tiny" aria-label="Next month" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>
          <ChevronRight size={14} />
        </button>
      </div>
      <div className="db-cal-grid" role="grid">
        {WEEKDAYS.map((day) => (
          <span key={day} className="db-cal-weekday">{day}</span>
        ))}
        {days.map((date) => {
          const iso = toISODate(date);
          const selected = iso === start || iso === end;
          const inRange = !!(start && end && iso > start && iso < end);
          return (
            <button
              key={iso}
              type="button"
              className={`db-cal-day ${date.getMonth() !== month.getMonth() ? "is-outside" : ""} ${iso === today ? "is-today" : ""} ${selected ? "is-selected" : ""} ${inRange ? "is-in-range" : ""}`}
              onClick={() => pick(iso)}
              aria-label={date.toDateString()}
              aria-pressed={selected}
            >
              {date.getDate()}
            </button>
          );
        })}
      </div>
      <div className="db-menu-sep" />
      {allowRange ? (
      <label className="db-menu-item db-toggle-row">
        <span>End date</span>
        <input
          type="checkbox"
          className="db-switch"
          checked={rangeOn}
          onChange={(event) => {
            const on = event.target.checked;
            setRangeOn(on);
            setEditingEnd(on && !!start);
            if (!on && end) commit(start ? { start } : null);
          }}
        />
      </label>
      ) : null}
      <button type="button" className="db-menu-item" disabled={!start} onClick={() => commit(null)}>
        Clear
      </button>
    </div>
  );
}

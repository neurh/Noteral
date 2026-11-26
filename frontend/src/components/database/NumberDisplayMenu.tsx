import { Check } from "lucide-react";
import { useState } from "react";
import { OPTION_COLORS, type DatabaseSchema, type NumberDisplay, type NumberDisplayStyle, type OptionColor, type Property } from "../../lib/database";
import { MAX_RATING, NUMBER_DISPLAYS, displayMax, displayStyle, displayTone, showsNumber } from "../../lib/numberDisplay";
import { COLOR_NAMES } from "./OptionPicker";
import { Popover } from "./Popover";

/** A small drawing of each style for the menu. */
function StyleGlyph({ style }: { style: NumberDisplayStyle }) {
  switch (style) {
    case "bar":
      return <span className="db-viz-glyph is-bar" aria-hidden><span /></span>;
    case "ring":
      return (
        <svg className="db-viz-glyph is-ring" viewBox="0 0 16 16" aria-hidden>
          <circle cx="8" cy="8" r="5.5" className="track" />
          <circle cx="8" cy="8" r="5.5" className="fill" strokeDasharray="22 40" transform="rotate(-90 8 8)" />
        </svg>
      );
    case "rating":
      return (
        <svg className="db-viz-glyph is-star" viewBox="0 0 16 16" aria-hidden>
          <path d="M8 1.6l1.98 4.01 4.42.64-3.2 3.12.76 4.4L8 11.69l-3.96 2.08.76-4.4L1.6 6.25l4.42-.64L8 1.6z" />
        </svg>
      );
    case "heat":
      return <span className="db-viz-glyph is-heat" aria-hidden><span /><span /><span /></span>;
    default:
      return <span className="db-menu-glyph" aria-hidden>#</span>;
  }
}

export function displayName(property: Property): string {
  const style = displayStyle(property.display);
  return NUMBER_DISPLAYS.find((item) => item.id === style)?.name ?? "Number";
}

function MaxInput({ property, onCommit }: { property: Property; onCommit: (max: number | undefined) => void }) {
  const style = displayStyle(property.display);
  const rating = style === "rating";
  const saved = property.display?.max;
  const [draft, setDraft] = useState(saved === undefined ? "" : String(saved));
  const commit = () => {
    const text = draft.trim();
    if (!text) return onCommit(undefined);
    let number = Number(text.replace(/[,\s]/g, ""));
    if (!Number.isFinite(number) || number <= 0) {
      setDraft(saved === undefined ? "" : String(saved));
      return;
    }
    if (rating) number = Math.min(MAX_RATING, Math.max(1, Math.round(number)));
    setDraft(String(number));
    onCommit(number);
  };
  return (
    <label className="db-menu-item db-viz-field">
      <span>{rating ? "Stars" : "Divide by"}</span>
      <input
        className="db-input db-viz-max"
        inputMode="decimal"
        value={draft}
        placeholder={String(displayMax({ style }, property.format))}
        aria-label={rating ? "Number of stars" : "Value that fills the bar"}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          }
        }}
      />
    </label>
  );
}

/** The "Show as" submenu of a number property: style, colour, maximum and the number toggle. */
/** The column's largest value rounded up to a tidy number, or undefined when 100 already fits. */
export function suggestedMax(values: unknown[] | undefined): number | undefined {
  let largest = 0;
  for (const value of values ?? []) {
    const n = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
    if (Number.isFinite(n) && n > largest) largest = n;
  }
  if (largest <= 100) return undefined;
  const step = 10 ** Math.floor(Math.log10(largest));
  return Math.ceil(largest / step) * step;
}

export function NumberDisplayMenu({
  property,
  anchor,
  onClose,
  updateSchema,
  values,
}: {
  property: Property;
  anchor: HTMLElement;
  onClose: () => void;
  updateSchema: (update: (schema: DatabaseSchema) => void) => void;
  /** The column's current values, used to pick a sensible "fills at" default. */
  values?: unknown[];
}) {
  const style = displayStyle(property.display);
  const tone = displayTone(property.display);
  const change = (patch: Partial<NumberDisplay>) =>
    updateSchema((schema) => {
      const target = schema.properties.find((p) => p.id === property.id);
      if (!target) return;
      const current: NumberDisplay = target.display ?? { style: "number" };
      const next: NumberDisplay = { ...current, ...patch };
      // Stars and "divide by" mean different things; don't carry one into the other.
      if (patch.style && (patch.style === "rating") !== (current.style === "rating")) delete next.max;
      // Bars and rings on plain numbers (budgets, counts) would all read "full"
      // against the default 100, so start from the column's largest value.
      if (patch.style && patch.style !== "rating" && patch.style !== "number" && next.max === undefined && target.format !== "percent") {
        const largest = suggestedMax(values);
        if (largest !== undefined) next.max = largest;
      }
      if (next.color === "default") delete next.color;
      if (next.max === undefined) delete next.max;
      if (next.showNumber !== false) delete next.showNumber;
      if (next.style === "number" && !next.color && next.max === undefined && next.showNumber === undefined) delete target.display;
      else target.display = next;
    });
  return (
    <Popover anchor={anchor} onClose={onClose} placement="right-start" width={232} label="Show number as">
      <div className="db-menu">
        {NUMBER_DISPLAYS.map((item) => (
          <button
            key={item.id}
            type="button"
            className="db-menu-item"
            aria-pressed={style === item.id}
            title={item.hint}
            onClick={() => change({ style: item.id })}
          >
            <span className={`db-viz-glyph-box ${tone === "default" ? "" : `tone-${tone} has-tone`}`}>
              <StyleGlyph style={item.id} />
            </span>
            {item.name}
            {style === item.id ? <Check size={14} className="db-menu-check" /> : null}
          </button>
        ))}
        {style !== "number" ? (
          <>
            <div className="db-menu-sep" />
            <div className="db-menu-label">Color</div>
            <div className="db-viz-swatches" role="radiogroup" aria-label="Color">
              {OPTION_COLORS.map((color: OptionColor) => (
                <button
                  key={color}
                  type="button"
                  role="radio"
                  aria-checked={tone === color}
                  aria-label={color === "default" ? "Accent" : COLOR_NAMES[color]}
                  title={color === "default" ? "Accent" : COLOR_NAMES[color]}
                  className={`db-viz-swatch ${color === "default" ? "" : `tone-${color} has-tone`} ${tone === color ? "is-on" : ""}`}
                  onClick={() => change({ color })}
                />
              ))}
            </div>
            <div className="db-menu-sep" />
            <MaxInput key={`${style}:${property.display?.max ?? ""}`} property={property} onCommit={(max) => change({ max })} />
            {style === "bar" || style === "ring" ? (
              <label className="db-menu-item db-toggle-row">
                <span>Show number</span>
                <input
                  type="checkbox"
                  className="db-switch"
                  checked={showsNumber(property.display)}
                  onChange={(event) => change({ showNumber: event.target.checked })}
                />
              </label>
            ) : null}
          </>
        ) : null}
      </div>
    </Popover>
  );
}

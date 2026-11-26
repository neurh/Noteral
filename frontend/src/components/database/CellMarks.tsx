import { useEffect, useRef, useState, type CSSProperties } from "react";
import { formatNumber, type Property } from "../../lib/database";
import { displayMax, displayStyle, displayTone, progressRatio, ratingFill, showsNumber } from "../../lib/numberDisplay";

/**
 * The database checkbox: a rounded square that fills with the accent and draws
 * a white check. It pops only when the value changes while on screen.
 */
export function CheckboxMark({ checked, label, decorative }: { checked: boolean; label?: string; decorative?: boolean }) {
  const previous = useRef(checked);
  const [animating, setAnimating] = useState(false);
  useEffect(() => {
    if (previous.current === checked) return;
    previous.current = checked;
    setAnimating(true);
  }, [checked]);
  const a11y = decorative ? { "aria-hidden": true as const } : { role: "img", "aria-label": label ?? (checked ? "Checked" : "Not checked") };
  return (
    <span
      className={`db-checkbox${checked ? " is-checked" : ""}${animating ? " is-animating" : ""}`}
      data-checked={checked ? "true" : "false"}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget) setAnimating(false);
      }}
      {...a11y}
    />
  );
}

/** A checkbox that toggles in place (cards and list rows), without opening the row. */
export function CheckboxToggle({ checked, name, showName, onToggle }: { checked: boolean; name: string; showName?: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={name}
      title={name}
      className={`db-check-toggle ${checked ? "is-checked" : ""}`}
      draggable={false}
      onClick={(event) => {
        event.stopPropagation();
        onToggle();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <CheckboxMark checked={checked} decorative />
      {showName ? <span className="db-check-name">{name}</span> : null}
    </button>
  );
}

const STAR = "M8 1.6l1.98 4.01 4.42.64-3.2 3.12.76 4.4L8 11.69l-3.96 2.08.76-4.4L1.6 6.25l4.42-.64L8 1.6z";

function Star({ fill }: { fill: number }) {
  return (
    <span className="db-star" aria-hidden>
      <svg viewBox="0 0 16 16" className="db-star-base"><path d={STAR} /></svg>
      {fill > 0 ? (
        <span className="db-star-fill" style={{ width: `${fill * 100}%` }}>
          <svg viewBox="0 0 16 16"><path d={STAR} /></svg>
        </span>
      ) : null}
    </span>
  );
}

/** A number shown the way its property's "Show as" asks: text, bar, ring, rating or heat. */
export function NumberValue({ property, value, formula }: { property: Property; value: unknown; formula?: boolean }) {
  const text = formatNumber(value, property.format);
  if (!text) return null;
  const display = property.display;
  const style = displayStyle(display);
  const extra = formula ? " is-formula" : "";
  if (style === "number") return <span className={`db-number${extra}`}>{text}</span>;

  const max = displayMax(display, property.format);
  const ratio = progressRatio(value, max) ?? 0;
  const tone = displayTone(display);
  const toneClass = tone === "default" ? "" : ` tone-${tone} has-tone`;
  const maxText = formatNumber(max, property.format) || String(max);
  const meter = { role: "meter", "aria-valuemin": 0, "aria-valuemax": max, "aria-valuenow": Number(value), "aria-valuetext": `${text} of ${maxText}`, "aria-label": property.name };

  if (style === "rating") {
    const filled = ratingFill(value, max, property.format) ?? 0;
    return (
      <span className={`db-viz db-rating${toneClass}`} {...meter} title={`${text} / ${maxText}`}>
        {Array.from({ length: max }, (_, index) => (
          <Star key={index} fill={Math.min(1, Math.max(0, filled - index))} />
        ))}
      </span>
    );
  }
  if (style === "heat") {
    // 8% tint at zero up to 46% at full, so the number stays readable on top.
    const strength = Math.round(8 + ratio * 38);
    return (
      <span className={`db-viz db-heat${toneClass}${extra}`} style={{ "--heat": `${strength}%` } as CSSProperties} {...meter}>
        {text}
      </span>
    );
  }
  const number = showsNumber(display) ? <span className={`db-viz-number${extra}`}>{text}</span> : null;
  if (style === "ring") {
    const radius = 6.5;
    const length = 2 * Math.PI * radius;
    return (
      <span className={`db-viz db-ring${toneClass}`} {...meter} title={number ? undefined : text}>
        <svg viewBox="0 0 18 18" className="db-ring-svg" aria-hidden>
          <circle className="db-ring-track" cx="9" cy="9" r={radius} />
          {ratio > 0 ? (
            <circle
              className="db-ring-fill"
              cx="9"
              cy="9"
              r={radius}
              strokeDasharray={`${(ratio * length).toFixed(2)} ${length.toFixed(2)}`}
              transform="rotate(-90 9 9)"
            />
          ) : null}
        </svg>
        {number}
      </span>
    );
  }
  return (
    <span className={`db-viz db-bar${toneClass}`} {...meter} title={number ? undefined : text}>
      <span className="db-bar-track" aria-hidden>
        <span className="db-bar-fill" style={{ width: `${ratio * 100}%` }} />
      </span>
      {number}
    </span>
  );
}

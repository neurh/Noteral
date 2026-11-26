import type { CSSProperties, MouseEvent } from "react";
import type { RichSpan } from "../../lib/formula";

const stop = (event: MouseEvent) => event.stopPropagation();

/** Renders styled formula output (style(), link()) with the app's tone colors. */
export function FormulaRichText({ spans, className }: { spans: RichSpan[]; className?: string }) {
  return (
    <span className={`fx-rich ${className ?? ""}`}>
      {spans.map((span, i) => {
        const classes = [
          span.bold && "is-bold",
          span.italic && "is-italic",
          span.underline && "is-underline",
          span.strike && "is-strike",
          span.code && "is-code",
          span.background && "has-bg",
        ]
          .filter(Boolean)
          .join(" ");
        const style: CSSProperties = {};
        if (span.color) style.color = `var(--tone-${span.color}-fg)`;
        if (span.background) style.background = `var(--tone-${span.background}-bg)`;
        if (span.href)
          return (
            <a
              key={i}
              className={`fx-rich-span fx-rich-link ${classes}`}
              style={style}
              href={span.href}
              target="_blank"
              rel="noreferrer"
              onClick={stop}
              onMouseDown={stop}
            >
              {span.text}
            </a>
          );
        return (
          <span key={i} className={`fx-rich-span ${classes}`} style={style}>
            {span.text}
          </span>
        );
      })}
    </span>
  );
}

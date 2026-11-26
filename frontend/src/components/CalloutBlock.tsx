import { createReactBlockSpec } from "@blocknote/react";
import { useState } from "react";
import { Check } from "lucide-react";
import { Popover } from "./database/Popover";

/** Callout tones, reusing the warm option colours databases use (`.tone-*`). */
export const CALLOUT_TONES = ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] as const;
export type CalloutTone = (typeof CALLOUT_TONES)[number];

export const CALLOUT_ICONS = ["💡", "📌", "⚠️", "✅", "❗", "ℹ️", "🔥", "📝", "🎯", "❓", "⭐", "🚀", "🧠", "📣", "🔒", "🗓️"];

function toneName(tone: string) {
  return tone === "default" ? "Default" : tone[0].toUpperCase() + tone.slice(1);
}

function CalloutIcon({ icon, tone, onChange }: { icon: string; tone: string; onChange: (props: { icon?: string; tone?: string }) => void }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  return (
    <>
      <button
        type="button"
        className="callout-icon"
        contentEditable={false}
        aria-label="Callout icon and colour"
        title="Change icon and colour"
        // Keep the caret where it was; the editor must not take this press.
        onMouseDown={(event) => event.preventDefault()}
        onClick={(event) => setAnchor(anchor ? null : event.currentTarget)}
      >
        {icon || "💡"}
      </button>
      {anchor ? (
        <Popover anchor={anchor} onClose={() => setAnchor(null)} width={244} label="Callout style">
          <div className="db-menu callout-menu">
            <div className="db-menu-label">Icon</div>
            <div className="callout-icon-grid">
              {CALLOUT_ICONS.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`callout-icon-choice${value === icon ? " is-active" : ""}`}
                  aria-label={`Icon ${value}`}
                  aria-pressed={value === icon}
                  onClick={() => onChange({ icon: value })}
                >
                  {value}
                </button>
              ))}
            </div>
            <div className="db-menu-sep" />
            <div className="db-menu-label">Colour</div>
            {CALLOUT_TONES.map((value) => (
              <button
                key={value}
                type="button"
                className={`db-menu-item${value === tone ? " is-active" : ""}`}
                onClick={() => {
                  onChange({ tone: value });
                  setAnchor(null);
                }}
              >
                <span className={`callout-swatch tone-${value}`} aria-hidden="true" />
                <span className="callout-menu-text">{toneName(value)}</span>
                {value === tone ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </>
  );
}

/**
 * A callout: an icon and a tinted box around a line of rich text. The icon
 * opens a small menu for the icon and the tone.
 */
export const calloutBlockSpec = createReactBlockSpec(
  {
    type: "callout",
    propSchema: {
      icon: { default: "💡" },
      tone: { default: "default" },
    },
    content: "inline",
  },
  {
    render: ({ block, editor, contentRef }) => (
      <div className={`callout tone-${block.props.tone || "default"}`} data-tone={block.props.tone}>
        <CalloutIcon
          icon={block.props.icon}
          tone={block.props.tone}
          onChange={(props) => {
            const current = editor.getBlock(block.id);
            if (current) editor.updateBlock(current, { props } as never);
          }}
        />
        <div className="callout-text" ref={contentRef} />
      </div>
    ),
    toExternalHTML: ({ block, contentRef }) => (
      <blockquote data-callout={block.props.tone}>
        <span>{block.props.icon} </span>
        <span ref={contentRef} />
      </blockquote>
    ),
  },
);

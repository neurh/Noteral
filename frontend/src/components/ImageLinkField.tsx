import { useEffect, useRef, useState } from "react";
import { Check, Link2, LoaderCircle, X } from "lucide-react";
import { safeImageLink } from "../lib/covers";
import "../styles/page-background.css";

type LinkState = "idle" | "invalid" | "loading" | "ready" | "failed";

interface ImageLinkFieldProps {
  /** Called with the validated, normalized http(s) href once its preview has loaded. */
  onApply: (href: string) => void;
  /** Shape of the preview well. */
  preview?: "wide" | "square";
  title?: string;
  note?: string;
  applyLabel?: string;
  /** A link to start from, e.g. the current linked cover. */
  initial?: string;
  /** Extra class on the panel, e.g. to drop the outer margin inside another panel. */
  className?: string;
}

/**
 * "From link": paste an image URL, see it load, then apply it. Shared by the
 * cover, icon and page background pickers so they validate links the same way.
 */
export function ImageLinkField({
  onApply,
  preview = "wide",
  title = "Use an image from the web",
  note = "Paste an http:// or https:// link to a PNG, JPG, GIF, WebP, AVIF or SVG image. It loads from that site each time the page opens.",
  applyLabel = "Use image",
  initial = "",
  className = "",
}: ImageLinkFieldProps) {
  const [text, setText] = useState(initial);
  const [src, setSrc] = useState(() => safeImageLink(initial) ?? "");
  const [state, setState] = useState<LinkState>(() => (safeImageLink(initial) ? "loading" : "idle"));
  const input = useRef<HTMLInputElement>(null);

  // Validate as the user types, and only start loading once typing settles.
  useEffect(() => {
    const trimmed = text.trim();
    if (!trimmed) {
      setSrc("");
      setState("idle");
      return;
    }
    const href = safeImageLink(trimmed);
    if (!href) {
      setSrc("");
      setState("invalid");
      return;
    }
    if (href === src) return;
    const timer = window.setTimeout(() => {
      setSrc(href);
      setState("loading");
    }, 280);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text]);

  const apply = () => {
    if (state === "ready" && src) onApply(src);
  };

  const message =
    state === "invalid"
      ? "That isn’t a usable link. Use a full http:// or https:// address to an image."
      : state === "failed"
        ? "No image loaded from that link. Check the address, or the site may not allow embedding."
        : "";

  return (
    <div className={`appearance-link ${className}`}>
      <div className="appearance-link-head">
        <span className="upload-emblem small" aria-hidden="true"><Link2 size={18} /></span>
        <div>
          <h3>{title}</h3>
          <p>{note}</p>
        </div>
      </div>
      <form
        className="appearance-link-row"
        onSubmit={(event) => {
          event.preventDefault();
          const href = safeImageLink(text);
          if (href && href !== src) {
            setSrc(href);
            setState("loading");
          } else apply();
        }}
      >
        <label className="picker-search appearance-link-input">
          <Link2 size={14} aria-hidden="true" />
          <input
            ref={input}
            type="url"
            inputMode="url"
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="https://example.com/image.jpg"
            aria-label="Image link"
            aria-invalid={state === "invalid" || state === "failed"}
            spellCheck={false}
            autoComplete="off"
          />
          {text ? (
            <button type="button" className="search-clear" onClick={() => { setText(""); input.current?.focus(); }} aria-label="Clear link">
              <X size={13} />
            </button>
          ) : null}
        </label>
        <button type="submit" className="primary-button" disabled={state !== "ready"}>
          <Check size={14} /> {applyLabel}
        </button>
      </form>
      <div className={`appearance-link-preview ${preview} is-${state}`} aria-live="polite">
        {src ? (
          <img
            key={src}
            src={src}
            alt="Preview of the linked image"
            referrerPolicy="no-referrer"
            onLoad={() => setState("ready")}
            onError={() => setState("failed")}
          />
        ) : null}
        {state === "loading" ? (
          <span className="appearance-link-status"><LoaderCircle size={14} className="spin" /> Loading preview…</span>
        ) : state === "idle" || state === "invalid" ? (
          <span className="appearance-link-status">The preview appears here</span>
        ) : null}
      </div>
      {message ? <div className="appearance-error" role="alert">{message}</div> : null}
    </div>
  );
}

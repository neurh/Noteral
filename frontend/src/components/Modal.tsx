import { useEffect, useRef, type CSSProperties, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface ModalProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  width?: "small" | "medium" | "large";
  labelledBy?: string;
  className?: string;
  bodyClassName?: string;
  style?: CSSProperties;
  /** No header: the content draws its own (title stays for screen readers). */
  bare?: boolean;
}

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function Modal({ open, title, subtitle, onClose, children, footer, width = "medium", labelledBy, className, bodyClassName, style, bare }: ModalProps) {
  const panel = useRef<HTMLElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>(focusableSelector) ?? []).filter(
        (element) => element.getClientRects().length > 0,
      );
      if (focusable.length === 0) {
        event.preventDefault();
        panel.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (!panel.current?.contains(active)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || active === panel.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    const timer = setTimeout(() => {
      const input = panel.current?.querySelector<HTMLElement>(
        ".modal-body input:not([type='hidden']):not([type='checkbox']):not([type='radio']):not([type='range']), .modal-body textarea, .modal-body select",
      );
      const footerAction = panel.current?.querySelector<HTMLElement>(
        ".modal-footer .primary-button, .modal-footer .secondary-button",
      );
      const bodyAction = panel.current?.querySelector<HTMLElement>(
        ".modal-body button, .modal-body [tabindex]:not([tabindex='-1'])",
      );
      (input ?? footerAction ?? bodyAction ?? panel.current)?.focus();
    }, 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
      previous?.focus();
    };
  }, [open]);

  if (!open) return null;
  const headingId = labelledBy ?? `modal-${title.replace(/\W+/g, "-").toLowerCase()}`;
  const subtitleId = subtitle ? `${headingId}-description` : undefined;

  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && closeRef.current()}>
      <section
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={headingId}
        aria-describedby={subtitleId}
        tabIndex={-1}
        className={`modal modal-${width} ${className ?? ""}`}
        style={style}
      >
        {bare ? (
          <h2 id={headingId} className="sr-only">
            {title}
          </h2>
        ) : null}
        <header className="modal-header" hidden={bare}>
          <div className="modal-header-copy">
            <h2 id={headingId}>{title}</h2>
            {subtitle ? <p id={subtitleId}>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={() => closeRef.current()} aria-label="Close dialog" title="Close">
            <X size={17} />
          </button>
        </header>
        <div className={`modal-body ${bodyClassName ?? ""}`}>{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

import { useEffect, useRef, type ReactNode } from "react";
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
}

export function Modal({ open, title, subtitle, onClose, children, footer, width = "medium", labelledBy }: ModalProps) {
  const panel = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    const timer = setTimeout(() => {
      const input = panel.current?.querySelector<HTMLElement>("input:not([type='hidden']), textarea, select");
      const fallback = panel.current?.querySelector<HTMLElement>("[tabindex]:not([tabindex='-1']), button");
      (input ?? fallback)?.focus();
    }, 30);
    return () => {
      window.removeEventListener("keydown", onKey);
      clearTimeout(timer);
    };
  }, [open, onClose]);
  if (!open) return null;
  const headingId = labelledBy ?? `modal-${title.replace(/\W+/g, "-").toLowerCase()}`;
  return createPortal(
    <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={panel} role="dialog" aria-modal="true" aria-labelledby={headingId} className={`modal modal-${width}`}>
        <header className="modal-header">
          <div>
            <h2 id={headingId}>{title}</h2>
            {subtitle ? <p>{subtitle}</p> : null}
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="Close dialog" title="Close">
            <X size={17} />
          </button>
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-footer">{footer}</footer> : null}
      </section>
    </div>,
    document.body,
  );
}

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { CornerDownLeft, Plus, Search } from "lucide-react";
import { useAppStore } from "../store";
import type { PageMeta } from "../lib/api";
import { Modal } from "./Modal";
import { PageIcon } from "./PageIcon";
import { KindIcon } from "./KindIcon";

interface PagePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (pageId: string) => void;
  title?: string;
  /** Limits which items can be picked, e.g. only databases. */
  filter?: (page: PageMeta) => boolean;
  emptyText?: string;
  subtitle?: string;
  /** Adds a first row that creates something new instead of picking. */
  create?: { label: string; hint?: string; icon?: ReactNode; onCreate: () => void };
  placeholder?: string;
}

export function PagePickerDialog({
  open,
  onClose,
  onPick,
  title = "Link to a page",
  filter,
  emptyText,
  subtitle = "Insert a stable link that survives page renames.",
  create,
  placeholder = "Find a page…",
}: PagePickerProps) {
  const pages = useAppStore((state) => state.pages);
  const titleById = useMemo(() => new Map(pages.map((page) => [page.id, page.title])), [pages]);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...pages]
      .filter((page) => (!filter || filter(page)) && (!q || page.title.toLowerCase().includes(q)))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 80);
  }, [pages, query, filter]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  // With a create row, index 0 is "create" and pages start at 1.
  const offset = create ? 1 : 0;
  const total = filtered.length + offset;

  useEffect(() => {
    if (index >= total) setIndex(Math.max(0, total - 1));
  }, [total, index]);

  function pick(pageId: string) {
    onPick(pageId);
    onClose();
  }

  function choose(row: number) {
    if (create && row === 0) {
      create.onCreate();
      onClose();
      return;
    }
    const page = filtered[row - offset];
    if (page) pick(page.id);
  }

  return (
    <Modal open={open} title={title} subtitle={subtitle} onClose={onClose} width="small">
      <div className="picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          placeholder={placeholder}
          aria-label={placeholder.replace(/…$/, "")}
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(total - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && index < total) {
              event.preventDefault();
              choose(index);
            }
          }}
        />
      </div>
      <div className="picker-list" role="listbox" aria-label="Pages">
        {create ? (
          <button
            type="button"
            role="option"
            aria-selected={index === 0}
            className={`picker-item picker-create ${index === 0 ? "active" : ""}`}
            onMouseEnter={() => setIndex(0)}
            onClick={() => choose(0)}
          >
            <span className="tree-icon" aria-hidden="true">{create.icon ?? <Plus size={14} />}</span>
            <span className="picker-item-text">
              <span>{create.label}</span>
              {create.hint ? <span className="picker-item-hint">{create.hint}</span> : null}
            </span>
            {index === 0 ? <CornerDownLeft size={13} className="picker-enter" /> : null}
          </button>
        ) : null}
        {create && filtered.length ? <div className="picker-section">Existing</div> : null}
        {filtered.length === 0 && !(create && !query.trim()) ? <div className="empty-hint small"><p>{emptyText ?? "No pages match."}</p></div> : null}
        {filtered.map((page, pageIndex) => {
          const itemIndex = pageIndex + offset;
          return (
          <button
            key={page.id}
            type="button"
            role="option"
            aria-selected={itemIndex === index}
            className={`picker-item ${itemIndex === index ? "active" : ""}`}
            onMouseEnter={() => setIndex(itemIndex)}
            onClick={() => pick(page.id)}
          >
            <span className="tree-icon" aria-hidden="true"><PageIcon value={page.icon} size={14} fallback={<KindIcon page={page} size={14} />} /></span>
            {(() => {
              const parent = page.parentId ? titleById.get(page.parentId) : undefined;
              return parent !== undefined ? (
                <span className="picker-item-text">
                  <span>{page.title || "Untitled"}</span>
                  <span className="picker-item-hint">in {parent || "Untitled"}</span>
                </span>
              ) : (
                <span>{page.title}</span>
              );
            })()}
            {itemIndex === index ? <CornerDownLeft size={13} className="picker-enter" /> : null}
          </button>
          );
        })}
      </div>
    </Modal>
  );
}

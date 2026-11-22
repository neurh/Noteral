import { useEffect, useMemo, useState } from "react";
import { CornerDownLeft, FileText, Search } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";
import { PageIcon } from "./PageIcon";

interface PagePickerProps {
  open: boolean;
  onClose: () => void;
  onPick: (pageId: string) => void;
  title?: string;
}

export function PagePickerDialog({ open, onClose, onPick, title = "Link to a page" }: PagePickerProps) {
  const pages = useAppStore((state) => state.pages);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return [...pages]
      .filter((page) => !q || page.title.toLowerCase().includes(q))
      .sort((a, b) => a.title.localeCompare(b.title))
      .slice(0, 80);
  }, [pages, query]);

  useEffect(() => {
    if (open) {
      setQuery("");
      setIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (index >= filtered.length) setIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, index]);

  function pick(pageId: string) {
    onPick(pageId);
    onClose();
  }

  return (
    <Modal open={open} title={title} subtitle="Insert a stable link that survives page renames." onClose={onClose} width="small">
      <div className="picker-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setIndex(0);
          }}
          placeholder="Find a page…"
          aria-label="Find a page"
          autoFocus
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(filtered.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && filtered[index]) {
              event.preventDefault();
              pick(filtered[index].id);
            }
          }}
        />
      </div>
      <div className="picker-list" role="listbox" aria-label="Pages">
        {filtered.length === 0 ? <div className="empty-hint small"><p>No pages match.</p></div> : null}
        {filtered.map((page, itemIndex) => (
          <button
            key={page.id}
            type="button"
            role="option"
            aria-selected={itemIndex === index}
            className={`picker-item ${itemIndex === index ? "active" : ""}`}
            onMouseEnter={() => setIndex(itemIndex)}
            onClick={() => pick(page.id)}
          >
            <span className="tree-icon" aria-hidden="true"><PageIcon value={page.icon} size={14} fallback={<FileText size={14} />} /></span>
            <span>{page.title}</span>
            {itemIndex === index ? <CornerDownLeft size={13} className="picker-enter" /> : null}
          </button>
        ))}
      </div>
    </Modal>
  );
}

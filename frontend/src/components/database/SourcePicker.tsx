import { Check, Plus, Table2 } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { kindOf, useAppStore } from "../../store";
import { PageIcon } from "../PageIcon";

interface SourceItem {
  id: string;
  title: string;
  icon: string;
  parent: string;
}

/** Every database in the workspace, with the page it lives in. */
export function useDatabaseSources(): SourceItem[] {
  const pages = useAppStore(
    useShallow((state) =>
      state.pages
        .filter((page) => kindOf(page) === "database" && !page.deletedAt)
        .map((page) => `${page.id}\u0000${page.title}\u0000${page.icon}\u0000${page.parentId ?? ""}`),
    ),
  );
  const titles = useAppStore(useShallow((state) => Object.fromEntries(state.pages.map((page) => [page.id, page.title]))));
  return useMemo(
    () =>
      pages
        .map((row) => {
          const [id, title, icon, parentId] = row.split("\u0000");
          return { id, title: title || "Untitled", icon, parent: parentId ? titles[parentId] ?? "" : "" };
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
    [pages, titles],
  );
}

interface SourcePickerProps {
  /** Highlights the database the view uses now. */
  current?: string;
  onPick: (databaseId: string) => void;
  /** Adds a "New database" row on top. */
  onNew?: () => void;
  /** Text of the `onNew` row. */
  newLabel?: string;
  label?: string;
  footer?: ReactNode;
}

/** A searchable list of databases, used to pick a view's source. */
export function SourcePicker({ current, onPick, onNew, newLabel = "New database", label = "Select a source", footer }: SourcePickerProps) {
  const sources = useDatabaseSources();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const q = query.trim().toLowerCase();
  const items = q ? sources.filter((item) => item.title.toLowerCase().includes(q) || item.parent.toLowerCase().includes(q)) : sources;
  const rows = (onNew ? 1 : 0) + items.length;
  const pick = (index: number) => {
    if (onNew && index === 0) onNew();
    else {
      const item = items[index - (onNew ? 1 : 0)];
      if (item) onPick(item.id);
    }
  };
  return (
    <div className="db-menu db-source-picker">
      <div className="db-menu-label">{label}</div>
      <div className="db-menu-pad">
        <input
          className="db-input"
          autoFocus
          value={query}
          placeholder="Search databases…"
          aria-label="Search databases"
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(rows - 1, index + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(0, index - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              pick(active);
            }
          }}
        />
      </div>
      <div className="db-menu-scroll" role="listbox" aria-label="Databases">
        {onNew ? (
          <button type="button" role="option" aria-selected={active === 0} className={`db-menu-item ${active === 0 ? "is-active" : ""}`} onMouseEnter={() => setActive(0)} onClick={() => pick(0)}>
            <Plus size={14} />
            <span className="db-menu-item-text">{newLabel}</span>
          </button>
        ) : null}
        {items.map((item, index) => {
          const row = index + (onNew ? 1 : 0);
          return (
            <button
              key={item.id}
              type="button"
              role="option"
              aria-selected={active === row}
              className={`db-menu-item db-source-item ${active === row ? "is-active" : ""}`}
              onMouseEnter={() => setActive(row)}
              onClick={() => pick(row)}
            >
              <span className="db-source-icon" aria-hidden>
                <PageIcon value={item.icon} size={14} fallback={<Table2 size={14} />} />
              </span>
              <span className="db-source-text">
                <span className="db-source-title">{item.title}</span>
                {item.parent ? <span className="db-source-parent">in {item.parent}</span> : null}
              </span>
              {item.id === current ? <Check size={14} className="db-menu-check" /> : null}
            </button>
          );
        })}
        {!items.length ? <div className="db-menu-empty">{q ? "No databases match" : "No databases yet"}</div> : null}
      </div>
      {footer}
    </div>
  );
}

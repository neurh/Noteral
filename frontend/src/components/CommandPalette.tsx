import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { CornerDownLeft, FileText, Search, Terminal } from "lucide-react";
import { api } from "../lib/api";
import { useCommands } from "../lib/commands";
import { plainSnippet } from "../lib/format";
import { useAppStore } from "../store";

interface PaletteItem {
  key: string;
  title: string;
  subtitle: string;
  group: "Pages" | "Commands";
  shortcut?: string;
  icon: "page" | "command";
  run: () => void;
}

export function CommandPalette() {
  const open = useAppStore((state) => state.overlay === "palette");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const selectPage = useAppStore((state) => state.selectPage);
  const pages = useAppStore((state) => state.pages);
  const workspace = useAppStore((state) => state.workspace);
  const commands = useCommands();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [hits, setHits] = useState<Array<{ pageId: string; title: string; snippet: string }>>([]);
  const [searching, setSearching] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    const timer = setTimeout(() => input.current?.focus(), 20);
    return () => clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const text = query.trim();
    if (!text) {
      setHits([]);
      setSearching(false);
      return;
    }
    let cancelled = false;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const results = workspace ? (await api.search(workspace.id, text, 8)) ?? [] : [];
        if (!cancelled) setHits(results);
      } catch {
        if (!cancelled) setHits([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query, workspace?.id]);

  const items = useMemo(() => {
    const text = query.trim().toLowerCase();
    const pageMap = new Map(pages.map((page) => [page.id, page]));
    const seen = new Set<string>();
    const pageResults: PaletteItem[] = [];
    if (text) {
      for (const hit of hits) {
        const page = pageMap.get(hit.pageId);
        if (!page || seen.has(page.id)) continue;
        seen.add(page.id);
        pageResults.push({
          key: `page:${page.id}`,
          title: hit.title || page.title || "Untitled",
          subtitle: plainSnippet(hit.snippet) || "Open page",
          group: "Pages",
          icon: "page",
          run: () => void selectPage(page.id),
        });
      }
      for (const page of pages) {
        if (seen.has(page.id) || !page.title.toLowerCase().includes(text)) continue;
        seen.add(page.id);
        pageResults.push({
          key: `page:${page.id}`,
          title: page.title || "Untitled",
          subtitle: "Open page",
          group: "Pages",
          icon: "page",
          run: () => void selectPage(page.id),
        });
      }
    } else {
      for (const page of pages.slice(0, 4)) {
        pageResults.push({
          key: `page:${page.id}`,
          title: page.title || "Untitled",
          subtitle: "Open page",
          group: "Pages",
          icon: "page",
          run: () => void selectPage(page.id),
        });
      }
    }
    const commandResults: PaletteItem[] = commands
      .filter((command) => {
        if (!text) return true;
        const haystack = `${command.title} ${command.category} ${command.keywords ?? ""}`.toLowerCase();
        return haystack.includes(text);
      })
      .slice(0, 40)
      .map((command) => ({
        key: `cmd:${command.id}`,
        title: command.title,
        subtitle: command.category,
        group: "Commands",
        shortcut: command.shortcut,
        icon: "command",
        run: () => void command.run(),
      }));
    return [...pageResults.slice(0, 6), ...commandResults];
  }, [commands, hits, pages, query, selectPage]);

  useEffect(() => {
    if (selected >= items.length) setSelected(Math.max(0, items.length - 1));
  }, [items.length, selected]);

  if (!open) return null;

  function run(item: PaletteItem | undefined) {
    if (!item) return;
    setOverlay(null);
    window.setTimeout(() => item.run(), 10);
  }

  return createPortal(
    <div className="palette-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOverlay(null); }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <div className="palette-input-row">
          <Search size={18} aria-hidden="true" />
          <input
            ref={input}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setSelected(0);
            }}
            placeholder="Find a page or run a command…"
            aria-label="Find a page or run a command"
            aria-controls="palette-results"
            aria-activedescendant={items[selected] ? `palette-item-${selected}` : undefined}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                setSelected((current) => Math.min(items.length - 1, current + 1));
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                setSelected((current) => Math.max(0, current - 1));
              } else if (event.key === "Enter") {
                event.preventDefault();
                run(items[selected]);
              } else if (event.key === "Escape") {
                event.preventDefault();
                setOverlay(null);
              }
            }}
          />
          <kbd className="palette-esc">esc</kbd>
        </div>
        <div className="palette-results" id="palette-results" role="listbox" aria-label="Results">
          {items.length === 0 ? (
            <div className="palette-empty"><CornerDownLeft size={16} /> No matching pages or commands</div>
          ) : null}
          {items.map((item, index) => {
            const Icon = item.icon === "page" ? FileText : Terminal;
            const showGroup = index === 0 || items[index - 1].group !== item.group;
            return (
              <div key={item.key}>
                {showGroup ? <div className="palette-group">{item.group}</div> : null}
                <button
                  type="button"
                  id={`palette-item-${index}`}
                  role="option"
                  aria-selected={index === selected}
                  className={`palette-item ${index === selected ? "active" : ""}`}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => run(item)}
                >
                  <Icon size={15} className="palette-item-icon" />
                  <span className="palette-item-title">{item.title}</span>
                  <span className="palette-item-subtitle">{item.subtitle}</span>
                  {item.shortcut ? <kbd>{item.shortcut}</kbd> : null}
                </button>
              </div>
            );
          })}
        </div>
        <div className="palette-footer">
          <span><kbd>↑</kbd><kbd>↓</kbd> navigate</span>
          <span><kbd>↵</kbd> run</span>
          <span className="palette-hint">{searching ? "Searching pages…" : "Commands from plugins appear here too."}</span>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, FilePlus2, FileText, MoreHorizontal, Plus, Star, Trash2, Pencil, Download } from "lucide-react";
import type { PageMeta } from "../lib/api";
import { api, errorMessage } from "../lib/api";
import { useAppStore } from "../store";
import { PageIcon } from "./PageIcon";

type DropZone = "before" | "after" | "inside";

interface DropTarget {
  id: string;
  zone: DropZone | "root";
}

function buildChildren(pages: PageMeta[]): Map<string, PageMeta[]> {
  const map = new Map<string, PageMeta[]>();
  const known = new Set(pages.map((page) => page.id));
  for (const page of pages) {
    const parent = page.parentId && known.has(page.parentId) ? page.parentId : "";
    const bucket = map.get(parent) ?? [];
    bucket.push(page);
    map.set(parent, bucket);
  }
  for (const bucket of map.values()) bucket.sort((a, b) => a.position - b.position || a.title.localeCompare(b.title));
  return map;
}

export function PageTree() {
  const pages = useAppStore((state) => state.pages);
  const activePageId = useAppStore((state) => state.activePageId);
  const favorites = useAppStore((state) => state.favorites);
  const workspace = useAppStore((state) => state.workspace);
  const selectPage = useAppStore((state) => state.selectPage);
  const createPage = useAppStore((state) => state.createPage);
  const renamePage = useAppStore((state) => state.renamePage);
  const duplicatePage = useAppStore((state) => state.duplicatePage);
  const trashPage = useAppStore((state) => state.trashPage);
  const movePage = useAppStore((state) => state.movePage);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const notify = useAppStore((state) => state.notify);

  const children = useMemo(() => buildChildren(pages), [pages]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!activePageId) return;
    const ancestors: string[] = [];
    const byId = new Map(pages.map((page) => [page.id, page]));
    let cursor = byId.get(activePageId);
    const seen = new Set<string>();
    while (cursor?.parentId && !seen.has(cursor.parentId)) {
      seen.add(cursor.parentId);
      ancestors.push(cursor.parentId);
      cursor = byId.get(cursor.parentId);
    }
    if (ancestors.length) {
      setExpanded((current) => {
        const next = new Set(current);
        for (const id of ancestors) next.add(id);
        return next;
      });
    }
  }, [activePageId, pages]);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => inputRef.current?.select());
    }
  }, [editing]);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuFor]);

  function toggle(id: string) {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function beginRename(page: PageMeta) {
    setEditing(page.id);
    setDraft(page.title);
    setMenuFor(null);
  }

  function commitRename(page: PageMeta) {
    if (editing !== page.id) return;
    const title = draft.trim() || "Untitled";
    setEditing(null);
    if (title !== page.title) void renamePage(page.id, title);
  }

  function descendantsOf(id: string): Set<string> {
    const result = new Set<string>();
    const walk = (parent: string) => {
      for (const child of children.get(parent) ?? []) {
        result.add(child.id);
        walk(child.id);
      }
    };
    walk(id);
    return result;
  }

  function dropOn(target: DropTarget) {
    if (!dragging) return;
    const moving = pages.find((page) => page.id === dragging);
    if (!moving) return;
    if (target.id === dragging || descendantsOf(dragging).has(target.id)) {
      setDropTarget(null);
      return;
    }
    if (target.zone === "root") {
      void movePage(dragging, "", "");
    } else {
      const targetPage = pages.find((page) => page.id === target.id);
      if (!targetPage) return;
      if (target.zone === "inside") {
        void movePage(dragging, targetPage.id, "");
        setExpanded((current) => new Set(current).add(targetPage.id));
      } else {
        const siblings = children.get(targetPage.parentId) ?? [];
        const index = siblings.findIndex((page) => page.id === targetPage.id);
        const beforeId = target.zone === "before" ? targetPage.id : siblings[index + 1]?.id ?? "";
        void movePage(dragging, targetPage.parentId, beforeId);
      }
    }
    setDropTarget(null);
    setDragging(null);
  }

  async function exportPage(page: PageMeta, kind: "json" | "markdown") {
    setMenuFor(null);
    if (!workspace) return;
    try {
      const result = kind === "json" ? await api.exportJson(workspace.id, page.id) : await api.exportMarkdown(workspace.id, page.id);
      if (result) notify(`Exported to ${result.path}`, "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  function renderRow(page: PageMeta, depth: number) {
    const kids = children.get(page.id) ?? [];
    const isOpen = expanded.has(page.id);
    const active = page.id === activePageId;
    const favorite = favorites.includes(page.id);
    const drop = dropTarget?.id === page.id ? dropTarget.zone : null;
    return (
      <div key={page.id} className="tree-branch">
        <div
          className={`tree-row ${active ? "active" : ""} ${drop ? `drop-${drop}` : ""} ${dragging === page.id ? "dragging" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={editing !== page.id}
          onDragStart={(event) => {
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-noteral-page", page.id);
            event.dataTransfer.setData("text/plain", page.id);
            setDragging(page.id);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            if (!dragging || dragging === page.id) return;
            event.preventDefault();
            event.stopPropagation();
            event.dataTransfer.dropEffect = "move";
            const rect = event.currentTarget.getBoundingClientRect();
            const y = event.clientY - rect.top;
            const zone: DropZone = y < rect.height * 0.26 ? "before" : y > rect.height * 0.74 ? "after" : "inside";
            setDropTarget({ id: page.id, zone });
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setDropTarget(null);
          }}
          onDrop={(event) => {
            event.preventDefault();
            event.stopPropagation();
            dropOn({ id: page.id, zone: dropTarget?.id === page.id ? (dropTarget.zone as DropZone) : "inside" });
          }}
        >
          <button
            type="button"
            className={`tree-caret ${kids.length === 0 ? "empty" : ""}`}
            aria-label={isOpen ? `Collapse ${page.title}` : `Expand ${page.title}`}
            title={isOpen ? "Collapse" : "Expand"}
            tabIndex={kids.length ? 0 : -1}
            onClick={(event) => {
              event.stopPropagation();
              if (kids.length) toggle(page.id);
            }}
          >
            {kids.length ? isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} /> : null}
          </button>
          {editing === page.id ? (
            <input
              ref={inputRef}
              className="tree-rename"
              value={draft}
              aria-label="Page title"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={() => commitRename(page)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitRename(page);
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  setEditing(null);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="tree-page"
              onClick={() => void selectPage(page.id)}
              onDoubleClick={() => beginRename(page)}
              title={page.title}
            >
              <span className="tree-icon" aria-hidden="true"><PageIcon value={page.icon} size={14} fallback={<FileText size={14} />} /></span>
              <span className="tree-title">{page.title}</span>
              {favorite ? <Star size={11} className="tree-star" aria-label="Favorite" /> : null}
            </button>
          )}
          <div className="tree-actions">
            <button
              type="button"
              className="icon-button tiny"
              aria-label={`Add child page under ${page.title}`}
              title="Add child page"
              onClick={(event) => {
                event.stopPropagation();
                void createPage(page.id);
              }}
            >
              <Plus size={13} />
            </button>
            <button
              type="button"
              className="icon-button tiny"
              aria-label={`Actions for ${page.title}`}
              aria-expanded={menuFor === page.id}
              title="Page actions"
              onClick={(event) => {
                event.stopPropagation();
                setMenuFor(menuFor === page.id ? null : page.id);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
          {menuFor === page.id ? (
            <div className="menu tree-menu" role="menu" onClick={(event) => event.stopPropagation()}>
              <button type="button" role="menuitem" onClick={() => beginRename(page)}><Pencil size={14} /> Rename</button>
              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); void toggleFavorite(page.id); }}>
                <Star size={14} /> {favorite ? "Remove favorite" : "Add favorite"}
              </button>
              <button type="button" role="menuitem" onClick={() => void createPage(page.id)}><FilePlus2 size={14} /> New child page</button>
              <button type="button" role="menuitem" onClick={() => { setMenuFor(null); void duplicatePage(page.id); }}><Copy size={14} /> Duplicate</button>
              <div className="menu-separator" />
              <button type="button" role="menuitem" onClick={() => void exportPage(page, "markdown")}><Download size={14} /> Export Markdown</button>
              <button type="button" role="menuitem" onClick={() => void exportPage(page, "json")}><Download size={14} /> Export JSON</button>
              <div className="menu-separator" />
              <button
                type="button"
                role="menuitem"
                className="danger"
                onClick={() => {
                  setMenuFor(null);
                  void trashPage(page.id);
                }}
              >
                <Trash2 size={14} /> Move to trash
              </button>
            </div>
          ) : null}
        </div>
        {isOpen && kids.length ? <div className="tree-children">{kids.map((child) => renderRow(child, depth + 1))}</div> : null}
      </div>
    );
  }

  const roots = children.get("") ?? [];
  return (
    <div className="page-tree">
      <div
        className={`tree-root-drop ${dropTarget?.zone === "root" ? "is-over" : ""}`}
        onDragOver={(event) => {
          if (!dragging) return;
          event.preventDefault();
          setDropTarget({ id: "", zone: "root" });
        }}
        onDragLeave={() => setDropTarget(null)}
        onDrop={(event) => {
          event.preventDefault();
          dropOn({ id: "", zone: "root" });
        }}
      >
        <div className="sidebar-section-heading">
          <span>Pages</span>
          <button type="button" className="icon-button tiny" aria-label="New page" title="New page" onClick={() => void createPage()}>
            <Plus size={14} />
          </button>
        </div>
        {roots.length === 0 ? (
          <div className="empty-hint">
            <FileText size={18} />
            <p>No pages yet.</p>
            <button type="button" className="text-button" onClick={() => void createPage()}>Create a page</button>
          </div>
        ) : (
          <div className="tree-scroll">{roots.map((page) => renderRow(page, 0))}</div>
        )}
      </div>
    </div>
  );
}

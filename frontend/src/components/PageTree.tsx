import { KindIcon } from "./KindIcon";
import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Copy, CornerLeftUp, FileText, Folder, FolderInput, FolderOpen, MoreHorizontal, Plus, Star, Table2, Trash2, Pencil, Download, ArrowUpRight } from "lucide-react";
import type { PageMeta } from "../lib/api";
import { api, errorMessage } from "../lib/api";
import { kindOf, useAppStore } from "../store";
import { NewItemMenu } from "./NewItemMenu";
import { ContributedMenuItems } from "./ContributedMenuItems";
import { parseNodeData } from "./CustomNodeView";
import { PageIcon } from "./PageIcon";
import { Popover, type Anchor } from "./database/Popover";
import { PagePickerDialog } from "./PagePickerDialog";
import { rangeBetween, topLevelOnly, visibleOrder } from "./treeSelection";

type DropZone = "before" | "after" | "inside";

interface DropTarget {
  id: string;
  zone: DropZone | "root";
}

function buildChildren(pages: PageMeta[]): Map<string, PageMeta[]> {
  const map = new Map<string, PageMeta[]>();
  const known = new Set(pages.map((page) => page.id));
  // Database rows live inside their database view, not in the sidebar.
  const databases = new Set(pages.filter((page) => kindOf(page) === "database").map((page) => page.id));
  for (const page of pages) {
    if (databases.has(page.parentId)) continue;
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
  const createItem = useAppStore((state) => state.createItem);
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
  // The actions menu: anchored to a row's "..." button, or to the pointer on right-click.
  const [menu, setMenu] = useState<{ pageId: string; anchor: Anchor } | null>(null);
  const menuFor = menu?.pageId ?? null;
  const [newMenu, setNewMenu] = useState<{ anchor: HTMLElement; parentId: string } | null>(null);
  const [dragging, setDragging] = useState<string[] | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  // Rows picked with Ctrl/Cmd+click or Shift+click. Empty means "just the clicked row".
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const selectionAnchor = useRef<string | null>(null);
  const [moveIds, setMoveIds] = useState<string[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const byId = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const visible = useMemo(() => visibleOrder(children, expanded), [children, expanded]);
  const closeMenu = () => setMenu(null);

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

  // Rows that were collapsed away, trashed or moved out drop out of the selection.
  useEffect(() => {
    setSelected((current) => {
      if (!current.size) return current;
      const shown = new Set(visible);
      const next = new Set([...current].filter((id) => shown.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [visible]);

  // A menu whose page is gone has nothing to act on.
  useEffect(() => {
    if (menu && !byId.has(menu.pageId)) setMenu(null);
  }, [menu, byId]);

  useEffect(() => {
    if (!selected.size) return;
    const onKey = (event: KeyboardEvent) => {
      // Open popovers and dialogs claim Escape first (and prevent it).
      if (event.key === "Escape" && !event.defaultPrevented) setSelected(new Set());
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected]);

  function clearSelection() {
    setSelected((current) => (current.size ? new Set() : current));
  }

  /** Ctrl/Cmd+click: add or remove one row, starting from the open page. */
  function toggleSelected(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (!next.size && activePageId && activePageId !== id && visible.includes(activePageId)) next.add(activePageId);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    selectionAnchor.current = id;
  }

  /** Shift+click: every visible row between the last clicked row and this one. */
  function selectRange(id: string) {
    const anchor = selectionAnchor.current && visible.includes(selectionAnchor.current) ? selectionAnchor.current : activePageId;
    setSelected(new Set(rangeBetween(visible, anchor, id)));
  }

  /** The pages a menu or drag on `id` acts on: the whole selection when `id` is part of it. */
  function targetsFor(id: string): string[] {
    if (selected.size > 1 && selected.has(id)) return topLevelOnly(selected, (pageId) => byId.get(pageId)?.parentId, visible);
    return [id];
  }

  function openMenu(pageId: string, anchor: Anchor) {
    // Acting on a row outside the selection means acting on that row alone.
    if (!selected.has(pageId)) clearSelection();
    setMenu({ pageId, anchor });
  }

  function plural(count: number) {
    return count === 1 ? "1 page" : `${count} pages`;
  }

  async function trashMany(ids: string[]) {
    closeMenu();
    if (ids.length === 1) return void trashPage(ids[0]);
    for (const id of ids) await trashPage(id, { quiet: true });
    clearSelection();
    notify(`${plural(ids.length)} moved to trash.`, "info");
  }

  async function duplicateMany(ids: string[]) {
    closeMenu();
    if (ids.length === 1) return void duplicatePage(ids[0]);
    for (const id of ids) await duplicatePage(id, { open: false });
    notify(`${plural(ids.length)} duplicated.`, "success");
  }

  async function favoriteMany(ids: string[]) {
    closeMenu();
    const allFavorite = ids.every((id) => favorites.includes(id));
    // Toggling is per page: only flip the ones not already in the wanted state.
    for (const id of ids) if (favorites.includes(id) === allFavorite) await toggleFavorite(id);
  }

  async function moveMany(ids: string[], parentId: string, beforeId: string) {
    for (const id of ids) await movePage(id, parentId, beforeId);
  }

  /** Pages a "Move to…" pick may put `moving` inside. */
  function canHost(page: PageMeta, moving: string[]): boolean {
    if (page.deletedAt || kindOf(page) === "database") return false;
    if (kindOf(byId.get(page.parentId) ?? page) === "database" && page.parentId) return false;
    return !moving.some((id) => id === page.id || descendantsOf(id).has(page.id));
  }

  async function moveTo(ids: string[], parentId: string) {
    await moveMany(ids, parentId, "");
    if (parentId) setExpanded((current) => new Set(current).add(parentId));
    const where = parentId ? byId.get(parentId)?.title || "Untitled" : "the top level";
    notify(`Moved ${ids.length === 1 ? `“${byId.get(ids[0])?.title || "Untitled"}”` : plural(ids.length)} to ${where}.`, "success");
  }

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
    closeMenu();
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
    const moving = dragging.filter((id) => byId.has(id));
    if (!moving.length) return;
    const movingSet = new Set(moving);
    if (moving.some((id) => id === target.id || descendantsOf(id).has(target.id))) {
      setDropTarget(null);
      return;
    }
    if (target.zone === "root") {
      void moveMany(moving, "", "");
    } else {
      const targetPage = byId.get(target.id);
      if (!targetPage) return;
      if (target.zone === "inside") {
        void moveMany(moving, targetPage.id, "");
        setExpanded((current) => new Set(current).add(targetPage.id));
      } else {
        const siblings = children.get(targetPage.parentId) ?? [];
        const index = siblings.findIndex((page) => page.id === targetPage.id);
        // Land after the target: before the next sibling that is not itself moving.
        const beforeId = target.zone === "before" ? targetPage.id : siblings.slice(index + 1).find((page) => !movingSet.has(page.id))?.id ?? "";
        void moveMany(moving, targetPage.parentId, beforeId);
      }
    }
    setDropTarget(null);
    setDragging(null);
  }

  async function exportPage(page: PageMeta, kind: "json" | "markdown") {
    closeMenu();
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
    const kind = kindOf(page);
    const isOpen = expanded.has(page.id);
    const icon =
      kind === "folder" ? (
        isOpen && kids.length ? <FolderOpen size={14} /> : <Folder size={14} />
      ) : kind === "database" ? (
        <Table2 size={14} />
      ) : kind === "custom" ? (
        <KindIcon page={page} />
      ) : (
        <FileText size={14} />
      );
    const active = page.id === activePageId;
    const favorite = favorites.includes(page.id);
    const drop = dropTarget?.id === page.id ? dropTarget.zone : null;
    const isSelected = selected.has(page.id);
    return (
      <div key={page.id} className="tree-branch">
        <div
          data-tree-id={page.id}
          className={`tree-row kind-${kind} ${active ? "active" : ""} ${isSelected ? "selected" : ""} ${menuFor === page.id ? "menu-open" : ""} ${drop ? `drop-${drop}` : ""} ${dragging?.includes(page.id) ? "dragging" : ""}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable={editing !== page.id}
          aria-selected={selected.size ? isSelected : undefined}
          onContextMenu={(event) => {
            if (editing === page.id) return;
            event.preventDefault();
            openMenu(page.id, { x: event.clientX, y: event.clientY });
          }}
          onDragStart={(event) => {
            closeMenu();
            // Dragging a selected row carries the whole selection along.
            const ids = targetsFor(page.id);
            if (ids.length === 1) clearSelection();
            event.dataTransfer.effectAllowed = "move";
            event.dataTransfer.setData("application/x-noteral-page", page.id);
            event.dataTransfer.setData("text/plain", page.id);
            setDragging(ids);
          }}
          onDragEnd={() => {
            setDragging(null);
            setDropTarget(null);
          }}
          onDragOver={(event) => {
            if (!dragging || dragging.includes(page.id)) return;
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
              onMouseDown={(event) => {
                // Shift+click would otherwise select the text between rows.
                if (event.shiftKey) event.preventDefault();
              }}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey) {
                  toggleSelected(page.id);
                  return;
                }
                if (event.shiftKey) {
                  selectRange(page.id);
                  return;
                }
                clearSelection();
                selectionAnchor.current = page.id;
                // Folders are containers: a click opens or closes them in place.
                if (kind === "folder") toggle(page.id);
                else void selectPage(page.id);
              }}
              onDoubleClick={() => beginRename(page)}
              aria-expanded={kind === "folder" ? isOpen : undefined}
              title={page.title}
            >
              <span className="tree-icon" aria-hidden="true"><PageIcon value={page.icon} size={14} fallback={icon} /></span>
              <span className="tree-title">{page.title}</span>
              {favorite ? <Star size={11} className="tree-star" aria-label="Favorite" /> : null}
            </button>
          )}
          <div className="tree-actions">
            <button
              type="button"
              className="icon-button tiny"
              aria-label={kind === "database" ? `Add a page to ${page.title}` : `Add inside ${page.title}`}
              title={kind === "database" ? "New page in database" : "Add a page, folder or database inside"}
              onClick={(event) => {
                event.stopPropagation();
                if (kind === "database") void createItem("page", page.id);
                else setNewMenu({ anchor: event.currentTarget, parentId: page.id });
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
              aria-haspopup="menu"
              onClick={(event) => {
                event.stopPropagation();
                if (menu?.pageId === page.id && menu.anchor === event.currentTarget) closeMenu();
                else openMenu(page.id, event.currentTarget);
              }}
            >
              <MoreHorizontal size={14} />
            </button>
          </div>
        </div>
        {isOpen && kids.length ? <div className="tree-children">{kids.map((child) => renderRow(child, depth + 1))}</div> : null}
      </div>
    );
  }

  /** The actions for one page, or — when it is part of a multi-selection — for all of them. */
  function renderMenu(page: PageMeta) {
    const ids = targetsFor(page.id);
    if (ids.length > 1) {
      const allFavorite = ids.every((id) => favorites.includes(id));
      return (
        <div className="menu tree-menu" role="menu" aria-label={`${plural(ids.length)} selected`}>
          <div className="tree-menu-label">{plural(ids.length)} selected</div>
          <button type="button" role="menuitem" onClick={() => void favoriteMany(ids)}>
            <Star size={14} /> {allFavorite ? "Remove from favorites" : "Add to favorites"}
          </button>
          <button type="button" role="menuitem" onClick={() => void duplicateMany(ids)}><Copy size={14} /> Duplicate</button>
          <button type="button" role="menuitem" onClick={() => { closeMenu(); setMoveIds(ids); }}><FolderInput size={14} /> Move to…</button>
          <div className="menu-separator" />
          <ContributedMenuItems context={{ menu: "treeSelection", pageIds: ids }} onDone={closeMenu} />
          <button type="button" role="menuitem" onClick={() => { closeMenu(); clearSelection(); }}>Clear selection</button>
          <div className="menu-separator" />
          <button type="button" role="menuitem" className="danger" onClick={() => void trashMany(ids)}>
            <Trash2 size={14} /> Move {plural(ids.length)} to trash
          </button>
        </div>
      );
    }
    const kind = kindOf(page);
    const favorite = favorites.includes(page.id);
    const inDatabase = kindOf(byId.get(page.parentId) ?? page) === "database" && !!page.parentId;
    return (
      <div className="menu tree-menu" role="menu" aria-label={`Actions for ${page.title}`}>
        <button type="button" role="menuitem" onClick={() => beginRename(page)}><Pencil size={14} /> Rename</button>
        <button type="button" role="menuitem" onClick={() => { closeMenu(); void toggleFavorite(page.id); }}>
          <Star size={14} /> {favorite ? "Remove favorite" : "Add favorite"}
        </button>
        {kind === "folder" ? (
          <button type="button" role="menuitem" onClick={() => { closeMenu(); void selectPage(page.id); }}><ArrowUpRight size={14} /> Open folder</button>
        ) : null}
        <button type="button" role="menuitem" onClick={() => { closeMenu(); void duplicatePage(page.id); }}><Copy size={14} /> Duplicate</button>
        {inDatabase ? null : (
          <button type="button" role="menuitem" onClick={() => { closeMenu(); setMoveIds([page.id]); }}><FolderInput size={14} /> Move to…</button>
        )}
        <div className="menu-separator" />
        <button type="button" role="menuitem" onClick={() => void exportPage(page, "markdown")}><Download size={14} /> Export Markdown</button>
        <button type="button" role="menuitem" onClick={() => void exportPage(page, "json")}><Download size={14} /> Export JSON</button>
        <ContributedMenuItems context={{ menu: "tree", pageId: page.id, kind, nodeType: page.kind === "custom" ? parseNodeData(page.data).type : undefined }} onDone={closeMenu} />
        <div className="menu-separator" />
        <button type="button" role="menuitem" className="danger" onClick={() => void trashMany([page.id])}>
          <Trash2 size={14} /> Move to trash
        </button>
      </div>
    );
  }

  const menuPage = menu ? byId.get(menu.pageId) : undefined;
  const roots = children.get("") ?? [];
  return (
    <div
      className="page-tree"
      onClick={(event) => {
        // A click on empty space (not a row or a control) clears the selection.
        const target = event.target as HTMLElement;
        if (!target.closest(".tree-row, button, input")) clearSelection();
      }}
    >
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
          <button
            type="button"
            className="icon-button tiny"
            aria-label="New page, folder or database"
            aria-haspopup="menu"
            aria-expanded={newMenu?.parentId === ""}
            title="New page, folder or database"
            onClick={(event) => setNewMenu({ anchor: event.currentTarget, parentId: "" })}
          >
            <Plus size={14} />
          </button>
        </div>
        {roots.length === 0 ? (
          <div className="empty-hint">
            <FileText size={18} />
            <p>No pages yet.</p>
            <button type="button" className="text-button" onClick={(event) => setNewMenu({ anchor: event.currentTarget, parentId: "" })}>Create a page</button>
          </div>
        ) : (
          <div className="tree-scroll">{roots.map((page) => renderRow(page, 0))}</div>
        )}
      </div>
      {newMenu ? (
        <NewItemMenu
          anchor={newMenu.anchor}
          parentId={newMenu.parentId}
          onClose={() => setNewMenu(null)}
          onCreated={(id, kind) => {
            const parent = newMenu.parentId;
            if (parent) setExpanded((current) => new Set(current).add(parent));
            // Folders do not open a tab, so name them right where they appear.
            if (kind === "folder") {
              setEditing(id);
              setDraft("New folder");
            }
          }}
        />
      ) : null}
      {menu && menuPage ? (
        <Popover
          anchor={menu.anchor}
          placement={menu.anchor instanceof HTMLElement ? "bottom-end" : "bottom-start"}
          className="tree-menu-popover"
          label={`Actions for ${menuPage.title}`}
          onClose={closeMenu}
        >
          {renderMenu(menuPage)}
        </Popover>
      ) : null}
      <PagePickerDialog
        open={!!moveIds}
        onClose={() => setMoveIds(null)}
        title={moveIds && moveIds.length > 1 ? `Move ${plural(moveIds.length)} to…` : "Move to…"}
        placeholder="Search for a page or folder…"
        filter={(page) => canHost(page, moveIds ?? [])}
        create={{ label: "Top level", hint: "Move out of any folder", icon: <CornerLeftUp size={14} />, onCreate: () => void moveTo(moveIds ?? [], "") }}
        onPick={(pageId) => void moveTo(moveIds ?? [], pageId)}
      />
    </div>
  );
}

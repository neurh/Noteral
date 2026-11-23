import { ArrowUpRight, ChevronDown, Database, Pencil, Table2, Plus, Search, SlidersHorizontal, Trash2, Copy, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAppStore } from "../../store";
import {
  VIEW_TYPES,
  applyView,
  defaultFilter,
  newView,
  seedValuesForView,
  type DatabaseView as View,
  type RowValues,
  type ViewType,
} from "../../lib/database";
import { PageIcon } from "../PageIcon";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView, ListView } from "./Cards";
import { FilterBar, FilterIcon, PropertyPicker, SortEditor, SortIcon } from "./FilterSort";
import { ViewIcon } from "./parts";
import { Popover } from "./Popover";
import { TableView } from "./TableView";
import { ViewSettings, deleteView, duplicateView } from "./ViewSettings";
import { updateView } from "./ops";
import { useDatabase } from "./useDatabase";

function storedView(key: string): string | null {
  try {
    return localStorage.getItem(`noteral.db.view.${key}`);
  } catch {
    return null;
  }
}

function storeView(key: string, viewId: string) {
  try {
    localStorage.setItem(`noteral.db.view.${key}`, viewId);
  } catch {
    // Private mode or quota: the choice just isn't remembered.
  }
}

interface DatabaseViewProps {
  databaseId: string;
  /** Embedded in another page as a block (shows its own title row). */
  inline?: boolean;
  /** Distinguishes several embeds of one database when remembering the view. */
  stateKey?: string;
}

function InlineTitle({ databaseId, title, icon }: { databaseId: string; title: string; icon: string }) {
  const renamePage = useAppStore((state) => state.renamePage);
  const selectPage = useAppStore((state) => state.selectPage);
  const [text, setText] = useState(title);
  useEffect(() => setText(title), [title]);
  const commit = () => {
    const clean = text.trim() || "Untitled";
    if (clean !== title) void renamePage(databaseId, clean);
    else setText(title);
  };
  return (
    <div className="db-inline-title">
      <span className="db-title-icon">
        <PageIcon value={icon} size={18} fallback={<Table2 size={17} />} />
      </span>
      <input
        className="db-inline-title-input"
        value={text}
        placeholder="Untitled"
        aria-label="Database name"
        onChange={(event) => setText(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Enter") event.currentTarget.blur();
          if (event.key === "Escape") {
            setText(title);
            event.currentTarget.blur();
          }
        }}
      />
      <button type="button" className="icon-button tiny db-inline-open" aria-label="Open as full page" title="Open as full page" onClick={() => void selectPage(databaseId)}>
        <ArrowUpRight size={15} />
      </button>
    </div>
  );
}

export function DatabaseView({ databaseId, inline = false, stateKey }: DatabaseViewProps) {
  const db = useDatabase(databaseId);
  const { schema } = db;
  const key = stateKey ?? databaseId;
  const [viewId, setViewIdState] = useState<string | null>(() => storedView(key));
  const view: View = schema.views.find((item) => item.id === viewId) ?? schema.views[0];
  const setViewId = (id: string) => {
    setViewIdState(id);
    storeView(key, id);
  };

  const [search, setSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [editTitleFor, setEditTitleFor] = useState<string | null>(null);
  const [editRuleId, setEditRuleId] = useState<string | null>(null);
  const [addView, setAddView] = useState<HTMLElement | null>(null);
  const [viewMenu, setViewMenu] = useState<{ view: View; anchor: HTMLElement } | null>(null);
  const [settings, setSettings] = useState<HTMLElement | null>(null);
  const [filterPick, setFilterPick] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => (view ? applyView(db.rows, schema, view, search) : []), [db.rows, schema, view, search]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  if (!db.meta) {
    return (
      <div className="db-missing">
        <Database size={16} /> This database was deleted or moved to trash.
      </div>
    );
  }
  if (!view) return null;

  async function addRow(extra?: RowValues) {
    const values = { ...seedValuesForView(schema, view), ...(extra ?? {}) };
    const meta = await db.addRow(values);
    if (!meta) return;
    if (view.type === "calendar") db.openRow(meta.id);
    else setEditTitleFor(meta.id);
  }

  function createView(type: ViewType) {
    const fresh = newView(type, schema);
    db.updateSchema((target) => {
      target.views.push(fresh);
    });
    setViewId(fresh.id);
  }

  const openSettings = (anchor?: HTMLElement) => setSettings(anchor ?? settingsButton.current);
  const total = db.rows.length;
  const filtered = view.filters.length > 0 || search.trim().length > 0;

  return (
    <div className={`db ${inline ? "is-inline" : "is-page"}`} data-view-type={view.type}>
      {inline ? <InlineTitle databaseId={databaseId} title={db.meta.title} icon={db.meta.icon} /> : null}
      <div className="db-toolbar">
        <div className="db-tabs" role="tablist" aria-label="Views">
          {schema.views.map((item) => (
            <button
              key={item.id}
              type="button"
              role="tab"
              aria-selected={item.id === view.id}
              className={`db-tab ${item.id === view.id ? "is-active" : ""}`}
              onClick={(event) => {
                if (item.id === view.id) setViewMenu({ view: item, anchor: event.currentTarget });
                else setViewId(item.id);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                setViewMenu({ view: item, anchor: event.currentTarget });
              }}
            >
              <ViewIcon type={item.type} />
              <span className="db-tab-name">{item.name}</span>
              {item.id === view.id ? <ChevronDown size={12} className="db-tab-caret" /> : null}
            </button>
          ))}
          <button type="button" className="icon-button tiny db-add-view" aria-label="Add a view" title="Add a view" onClick={(event) => setAddView(event.currentTarget)}>
            <Plus size={14} />
          </button>
        </div>
        <div className="db-actions">
          <button
            type="button"
            className={`db-action ${view.filters.length ? "is-on" : ""}`}
            aria-label="Filter"
            title="Filter"
            onClick={(event) => setFilterPick(event.currentTarget)}
          >
            <FilterIcon />
            <span className="db-action-label">Filter</span>
          </button>
          <button
            type="button"
            className={`db-action ${view.sorts.length ? "is-on" : ""}`}
            aria-label="Sort"
            title="Sort"
            onClick={(event) => setSortAnchor(event.currentTarget)}
          >
            <SortIcon />
            <span className="db-action-label">Sort</span>
          </button>
          <div className={`db-search ${searchOpen || search ? "is-open" : ""}`}>
            <button type="button" className="db-action" aria-label="Search" title="Search" onClick={() => setSearchOpen(true)}>
              <Search size={14} />
            </button>
            {searchOpen || search ? (
              <>
                <input
                  ref={searchRef}
                  className="db-search-input"
                  value={search}
                  placeholder="Type to search…"
                  aria-label="Search this database"
                  onChange={(event) => setSearch(event.target.value)}
                  onBlur={() => {
                    if (!search) setSearchOpen(false);
                  }}
                  onKeyDown={(event) => {
                    event.stopPropagation();
                    if (event.key === "Escape") {
                      setSearch("");
                      setSearchOpen(false);
                    }
                  }}
                />
                {search ? (
                  <button type="button" className="icon-button tiny" aria-label="Clear search" onClick={() => { setSearch(""); searchRef.current?.focus(); }}>
                    <X size={12} />
                  </button>
                ) : null}
              </>
            ) : null}
          </div>
          <button ref={settingsButton} type="button" className="db-action" aria-label="View settings" title="View settings" onClick={(event) => openSettings(event.currentTarget)}>
            <SlidersHorizontal size={14} />
          </button>
          <button type="button" className="db-new" onClick={() => void addRow()}>
            <Plus size={14} /> New
          </button>
        </div>
      </div>
      <FilterBar db={db} view={view} editRuleId={editRuleId} setEditRuleId={setEditRuleId} />
      <div className="db-body">
        {view.type === "table" ? (
          <TableView
            db={db}
            view={view}
            rows={rows}
            onAddRow={() => void addRow()}
            editTitleFor={editTitleFor}
            clearEditTitle={() => setEditTitleFor(null)}
            onFilter={setEditRuleId}
          />
        ) : null}
        {view.type === "board" ? (
          <BoardView
            db={db}
            view={view}
            rows={rows}
            onAddRow={(values) => void addRow(values)}
            editTitleFor={editTitleFor}
            clearEditTitle={() => setEditTitleFor(null)}
            onOpenSettings={openSettings}
          />
        ) : null}
        {view.type === "gallery" ? (
          <GalleryView db={db} view={view} rows={rows} onAddRow={() => void addRow()} editTitleFor={editTitleFor} clearEditTitle={() => setEditTitleFor(null)} />
        ) : null}
        {view.type === "list" ? (
          <ListView db={db} view={view} rows={rows} onAddRow={() => void addRow()} editTitleFor={editTitleFor} clearEditTitle={() => setEditTitleFor(null)} />
        ) : null}
        {view.type === "calendar" ? <CalendarView db={db} view={view} rows={rows} onAddRow={(values) => void addRow(values)} onOpenSettings={openSettings} /> : null}
        {filtered && view.type !== "calendar" ? (
          <div className="db-count" aria-live="polite">
            {rows.length} of {total} {total === 1 ? "page" : "pages"}
          </div>
        ) : null}
        {!filtered && !total && view.type !== "table" && view.type !== "calendar" ? (
          <div className="db-count">No pages yet</div>
        ) : null}
      </div>

      {addView ? (
        <Popover anchor={addView} onClose={() => setAddView(null)} width={210} label="Add a view">
          <div className="db-menu">
            <div className="db-menu-label">Add a view</div>
            {VIEW_TYPES.map((item) => (
              <button
                key={item.type}
                type="button"
                className="db-menu-item"
                onClick={() => {
                  setAddView(null);
                  createView(item.type);
                }}
              >
                <ViewIcon type={item.type} /> {item.name}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
      {viewMenu ? (
        <Popover anchor={viewMenu.anchor} onClose={() => setViewMenu(null)} width={210} label="View options">
          <div className="db-menu">
            <button
              type="button"
              className="db-menu-item"
              onClick={() => {
                setViewMenu(null);
                openSettings();
              }}
            >
              <Pencil size={14} /> Edit view
            </button>
            <button
              type="button"
              className="db-menu-item"
              onClick={() => {
                const id = duplicateView(db, viewMenu.view.id);
                setViewMenu(null);
                setViewId(id);
              }}
            >
              <Copy size={14} /> Duplicate view
            </button>
            {schema.views.length > 1 ? (
              <button
                type="button"
                className="db-menu-item danger"
                onClick={() => {
                  const target = viewMenu.view.id;
                  const next = schema.views.find((item) => item.id !== target);
                  setViewMenu(null);
                  deleteView(db, target);
                  if (next && target === view.id) setViewId(next.id);
                }}
              >
                <Trash2 size={14} /> Delete view
              </button>
            ) : null}
          </div>
        </Popover>
      ) : null}
      {settings ? <ViewSettings db={db} view={view} anchor={settings} onClose={() => setSettings(null)} onSelectView={setViewId} /> : null}
      {filterPick ? (
        <Popover anchor={filterPick} onClose={() => setFilterPick(null)} width={240} placement="bottom-end" label="Add filter">
          <PropertyPicker
            schema={schema}
            onPick={(property) => {
              setFilterPick(null);
              const rule = defaultFilter(property);
              updateView(db, view.id, (target) => { target.filters = [...target.filters, rule]; });
              setEditRuleId(rule.id);
            }}
          />
        </Popover>
      ) : null}
      {sortAnchor ? <SortEditor db={db} view={view} anchor={sortAnchor} onClose={() => setSortAnchor(null)} /> : null}
    </div>
  );
}


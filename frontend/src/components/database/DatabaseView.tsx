import { ArrowUpRight, ChevronDown, ChevronRight, Copy, Database, Pencil, Plus, Search, SlidersHorizontal, Table2, Trash2, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useAppStore } from "../../store";
import {
  NO_GROUP,
  VIEW_TYPES,
  applyView,
  countRules,
  defaultFilter,
  groupRows,
  newView,
  propertyById,
  seedValuesForView,
  valueType,
  type BoardGroup,
  type DatabaseRow,
  type DatabaseView as View,
  type Property,
  type RowValues,
  type ViewType,
} from "../../lib/database";
import { openRowIn } from "../../lib/rowPeek";
import { PageIcon } from "../PageIcon";
import { AdvancedFilter } from "./AdvancedFilter";
import { BoardView } from "./BoardView";
import { CalendarView } from "./CalendarView";
import { GalleryView, ListView } from "./Cards";
import { ChartView } from "./ChartView";
import { CustomView } from "./CustomView";
import { FilterBar, FilterIcon, PropertyPicker, SortEditor, SortIcon, starterGroup } from "./FilterSort";
import { OptionChip, ViewIcon } from "./parts";
import { Popover } from "./Popover";
import { TableView } from "./TableView";
import { ViewSettings, deleteView, duplicateView, groupablePropertiesFor } from "./ViewSettings";
import { updateView } from "./ops";
import { useDatabase, type DatabaseApi } from "./useDatabase";

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

/* ------------------------------------------------------------------ tabs */

const MORE_WIDTH = 64;
const MORE_WIDTH_SHORT = 44;
const ADD_WIDTH = 30;

/**
 * View tabs that share the header row with the actions. Tabs that don't fit
 * collapse into a "N more" menu; the active tab always stays visible.
 */
function ViewTabs({
  views,
  activeId,
  onSelect,
  onMenu,
  onAdd,
}: {
  views: View[];
  activeId: string;
  onSelect: (id: string) => void;
  onMenu: (view: View, anchor: HTMLElement) => void;
  onAdd: (anchor: HTMLElement) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(views.length);
  const [more, setMore] = useState<HTMLElement | null>(null);

  const recompute = useCallback(() => {
    const container = box.current;
    const sizer = measure.current;
    if (!container || !sizer) return;
    const available = container.clientWidth;
    const widths = Array.from(sizer.children).map((child) => (child as HTMLElement).offsetWidth + 2);
    const total = widths.reduce((sum, width) => sum + width, 0);
    if (total + ADD_WIDTH <= available) {
      setFit(views.length);
      return;
    }
    // Matches the container query that shortens "N more" to "+N".
    const db = container.closest(".db") as HTMLElement | null;
    let used = ADD_WIDTH + ((db?.clientWidth ?? 999) <= 520 ? MORE_WIDTH_SHORT : MORE_WIDTH);
    let count = 0;
    for (const width of widths) {
      if (used + width > available) break;
      used += width;
      count++;
    }
    setFit(Math.max(1, count));
  }, [views.length]);

  useLayoutEffect(() => {
    recompute();
  }, [recompute, views]);
  useEffect(() => {
    const container = box.current;
    if (!container) return;
    const observer = new ResizeObserver(() => recompute());
    observer.observe(container);
    return () => observer.disconnect();
  }, [recompute]);

  const activeIndex = Math.max(0, views.findIndex((view) => view.id === activeId));
  let shown = views.slice(0, fit);
  if (activeIndex >= fit) shown = [...views.slice(0, Math.max(0, fit - 1)), views[activeIndex]];
  const shownIds = new Set(shown.map((view) => view.id));
  const hidden = views.filter((view) => !shownIds.has(view.id));

  const tab = (item: View, measuring = false) => (
    <button
      key={item.id}
      type="button"
      role={measuring ? undefined : "tab"}
      tabIndex={measuring ? -1 : undefined}
      aria-selected={measuring ? undefined : item.id === activeId}
      className={`db-tab ${item.id === activeId ? "is-active" : ""}`}
      onClick={
        measuring
          ? undefined
          : (event) => {
              if (item.id === activeId) onMenu(item, event.currentTarget);
              else onSelect(item.id);
            }
      }
      onContextMenu={
        measuring
          ? undefined
          : (event) => {
              event.preventDefault();
              onMenu(item, event.currentTarget);
            }
      }
      title={item.name}
    >
      <ViewIcon type={item.type} />
      <span className="db-tab-name">{item.name}</span>
      {item.id === activeId ? <ChevronDown size={12} className="db-tab-caret" /> : null}
    </button>
  );

  return (
    <div className="db-tabs" ref={box}>
      <div className="db-tabs-measure" ref={measure} aria-hidden>
        {views.map((item) => tab(item, true))}
      </div>
      <div className="db-tabs-row" role="tablist" aria-label="Views">
        {shown.map((item) => tab(item))}
        {hidden.length ? (
          <button type="button" className="db-tab db-tab-more" aria-haspopup="menu" aria-label={`${hidden.length} more views`} onClick={(event) => setMore(event.currentTarget)}>
            <span className="db-tab-more-full">{hidden.length} more</span>
            <span className="db-tab-more-short" aria-hidden>+{hidden.length}</span>
            <ChevronDown size={12} />
          </button>
        ) : null}
        <button type="button" className="icon-button tiny db-add-view" aria-label="Add a view" title="Add a view" onClick={(event) => onAdd(event.currentTarget)}>
          <Plus size={14} />
        </button>
      </div>
      {more ? (
        <Popover anchor={more} onClose={() => setMore(null)} width={220} label="More views">
          <div className="db-menu">
            <div className="db-menu-label">Views</div>
            <div className="db-menu-scroll">
              {views.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`db-menu-item ${item.id === activeId ? "is-active" : ""}`}
                  onClick={() => {
                    setMore(null);
                    onSelect(item.id);
                  }}
                >
                  <ViewIcon type={item.type} />
                  <span className="db-menu-item-text">{item.name}</span>
                </button>
              ))}
            </div>
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

/* --------------------------------------------------------------- groups */

/** Values that put a new row into a group. */
function seedForGroup(property: Property, group: BoardGroup): RowValues {
  const type = valueType(property);
  if (property.type === "formula") return {};
  if (type === "checkbox") return { [property.id]: group.id === "true" };
  if (group.id === NO_GROUP) return {};
  if (type === "select" || type === "status") return { [property.id]: group.id };
  if (type === "multiSelect") return { [property.id]: [group.id] };
  return {};
}

const defaultLimit = (inline: boolean) => (inline ? 25 : 50);

/** Shows the first N rows and a "Load more" button. */
function Paged({ rows, limit, children }: { rows: DatabaseRow[]; limit: number; children: (rows: DatabaseRow[]) => ReactNode }) {
  const [shown, setShown] = useState(limit);
  useEffect(() => setShown(limit), [limit]);
  const visible = rows.length > shown ? rows.slice(0, shown) : rows;
  return (
    <>
      {children(visible)}
      {rows.length > shown ? (
        <button type="button" className="db-load-more" onClick={() => setShown((count) => count + limit)}>
          <ChevronDown size={13} /> Load more <span>{rows.length - shown} hidden</span>
        </button>
      ) : null}
    </>
  );
}

function GroupedRows({
  db,
  view,
  rows,
  property,
  limit,
  render,
}: {
  db: DatabaseApi;
  view: View;
  rows: DatabaseRow[];
  property: Property;
  limit: number;
  render: (rows: DatabaseRow[], seed: RowValues) => ReactNode;
}) {
  const groups = useMemo(() => groupRows(rows, property), [rows, property]);
  const hidden = new Set(view.hiddenGroups ?? []);
  const collapsed = new Set(view.collapsedGroups ?? []);
  const visible = groups.filter((group) => !hidden.has(group.id) && !((view.hideEmptyGroups || group.id === NO_GROUP) && !group.rows.length));
  const toggle = (id: string) =>
    updateView(db, view.id, (target) => {
      const next = new Set(target.collapsedGroups ?? []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      target.collapsedGroups = [...next];
    });
  const hasOptions = ["select", "status", "multiSelect"].includes(valueType(property));
  return (
    <div className="db-groups">
      {visible.map((group) => {
        const isCollapsed = collapsed.has(group.id);
        return (
          <section key={group.id} className={`db-group ${isCollapsed ? "is-collapsed" : ""}`}>
            <button type="button" className="db-group-head" aria-expanded={!isCollapsed} onClick={() => toggle(group.id)}>
              <ChevronRight size={14} className="db-group-chevron" />
              {hasOptions && group.option ? <OptionChip option={group.option} /> : <span className="db-group-name">{group.name}</span>}
              <span className="db-group-count">{group.rows.length}</span>
            </button>
            {isCollapsed ? null : (
              <div className="db-group-body">
                <Paged rows={group.rows} limit={limit}>
                  {(slice) => render(slice, seedForGroup(property, group))}
                </Paged>
              </div>
            )}
          </section>
        );
      })}
      {!visible.length ? <div className="db-count">No groups to show</div> : null}
    </div>
  );
}

/* ----------------------------------------------------------------- view */

export function DatabaseView({ databaseId, inline = false, stateKey }: DatabaseViewProps) {
  const base = useDatabase(databaseId);
  const { schema } = base;
  const key = stateKey ?? databaseId;
  const [viewId, setViewIdState] = useState<string | null>(() => storedView(key));
  const view: View | undefined = schema.views.find((item) => item.id === viewId) ?? schema.views[0];
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
  const [settings, setSettings] = useState<{ anchor: HTMLElement; page?: "group" } | null>(null);
  const [filterPick, setFilterPick] = useState<HTMLElement | null>(null);
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [advanced, setAdvanced] = useState<HTMLElement | null>(null);
  const settingsButton = useRef<HTMLButtonElement>(null);
  const filterButton = useRef<HTMLButtonElement>(null);

  const rows = useMemo(() => (view ? applyView(base.rows, schema, view, search) : []), [base.rows, schema, view, search]);
  const openIn = view?.openIn ?? "modal";
  const rowIds = useMemo(() => rows.map((row) => row.id), [rows]);
  // Views open rows through the view's "Open pages in" setting.
  const db: DatabaseApi = useMemo(() => ({ ...base, openRow: (rowId: string) => void openRowIn(openIn, rowId, rowIds) }), [base, openIn, rowIds]);

  useEffect(() => {
    if (searchOpen) searchRef.current?.focus();
  }, [searchOpen]);

  if (!base.meta) {
    return (
      <div className="db-missing">
        <Database size={16} /> This database was deleted or moved to trash.
      </div>
    );
  }
  if (!view) return null;
  const current = view;

  async function addRow(extra?: RowValues) {
    const values = { ...seedValuesForView(schema, current), ...(extra ?? {}) };
    const meta = await db.addRow(values);
    if (!meta) return;
    if (current.type === "calendar" || current.type === "chart" || current.type === "custom") db.openRow(meta.id);
    else setEditTitleFor(meta.id);
  }

  function createView(type: ViewType) {
    const fresh = newView(type, schema);
    db.updateSchema((target) => {
      target.views.push(fresh);
    });
    setViewId(fresh.id);
  }

  const openSettings = (anchor?: HTMLElement, page?: "group") => {
    const target = anchor ?? settingsButton.current;
    if (target) setSettings({ anchor: target, page });
  };
  const openAdvanced = (anchor?: HTMLElement) => {
    if (!current.advanced) updateView(db, current.id, (target) => { target.advanced = starterGroup(schema); });
    setAdvanced(anchor ?? filterButton.current ?? settingsButton.current);
  };
  const total = db.rows.length;
  const filterCount = current.filters.length + countRules(current.advanced);
  const filtered = filterCount > 0 || search.trim().length > 0;
  const limit = current.limit || defaultLimit(inline);
  const groupProperty = current.groupBy && current.type !== "board" ? propertyById(schema, current.groupBy) : undefined;
  const grouped = groupProperty && groupablePropertiesFor(current, schema.properties).some((item) => item.id === groupProperty.id) ? groupProperty : undefined;
  const clearEditTitle = () => setEditTitleFor(null);

  const renderRows = (slice: DatabaseRow[], seed: RowValues = {}): ReactNode => {
    const onAdd = () => void addRow(seed);
    if (current.type === "table")
      return <TableView db={db} view={current} rows={slice} onAddRow={onAdd} editTitleFor={editTitleFor} clearEditTitle={clearEditTitle} onFilter={setEditRuleId} />;
    if (current.type === "gallery") return <GalleryView db={db} view={current} rows={slice} onAddRow={onAdd} editTitleFor={editTitleFor} clearEditTitle={clearEditTitle} />;
    return <ListView db={db} view={current} rows={slice} onAddRow={onAdd} editTitleFor={editTitleFor} clearEditTitle={clearEditTitle} />;
  };
  const paged = current.type === "table" || current.type === "gallery" || current.type === "list";

  return (
    <div
      className={`db ${inline ? "is-inline" : "is-page"}`}
      data-view-type={current.type}
      data-icons={current.showIcons === false ? "off" : undefined}
      data-card-size={current.type === "gallery" ? current.cardSize ?? "medium" : undefined}
      data-row-numbers={current.type === "table" && current.rowNumbers ? "on" : undefined}
    >
      {inline ? <InlineTitle databaseId={databaseId} title={db.meta?.title ?? ""} icon={db.meta?.icon ?? ""} /> : null}
      <div className="db-toolbar">
        <ViewTabs
          views={schema.views}
          activeId={current.id}
          onSelect={setViewId}
          onMenu={(item, anchor) => setViewMenu({ view: item, anchor })}
          onAdd={(anchor) => setAddView(anchor)}
        />
        <div className="db-actions">
          <button
            ref={filterButton}
            type="button"
            className={`db-action ${filterCount ? "is-on" : ""}`}
            aria-label="Filter"
            title="Filter"
            onClick={(event) => {
              if (current.showFilterBar === false && filterCount) {
                updateView(db, current.id, (target) => { target.showFilterBar = true; });
                return;
              }
              setFilterPick(event.currentTarget);
            }}
          >
            <FilterIcon />
            <span className="db-action-label">Filter</span>
            {filterCount ? <span className="db-action-count">{filterCount}</span> : null}
          </button>
          <button
            type="button"
            className={`db-action ${current.sorts.length ? "is-on" : ""}`}
            aria-label="Sort"
            title="Sort"
            onClick={(event) => setSortAnchor(event.currentTarget)}
          >
            <SortIcon />
            <span className="db-action-label">Sort</span>
            {current.sorts.length ? <span className="db-action-count">{current.sorts.length}</span> : null}
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
            <Plus size={14} /> <span className="db-new-label">New</span>
          </button>
        </div>
      </div>
      <FilterBar db={db} view={current} editRuleId={editRuleId} setEditRuleId={setEditRuleId} onOpenAdvanced={openAdvanced} />
      <div className="db-body">
        {paged ? (
          grouped ? (
            <GroupedRows db={db} view={current} rows={rows} property={grouped} limit={limit} render={renderRows} />
          ) : (
            <Paged rows={rows} limit={limit}>
              {(slice) => renderRows(slice)}
            </Paged>
          )
        ) : null}
        {current.type === "board" ? (
          <BoardView
            db={db}
            view={current}
            rows={rows}
            onAddRow={(values) => void addRow(values)}
            editTitleFor={editTitleFor}
            clearEditTitle={clearEditTitle}
            onOpenSettings={(anchor) => openSettings(anchor, "group")}
          />
        ) : null}
        {current.type === "calendar" ? <CalendarView db={db} view={current} rows={rows} onAddRow={(values) => void addRow(values)} onOpenSettings={openSettings} /> : null}
        {current.type === "chart" ? <ChartView db={db} view={current} rows={rows} inline={inline} onOpenSettings={openSettings} /> : null}
        {current.type === "custom" ? <CustomView db={db} view={current} rows={rows} inline={inline} /> : null}
        {filtered && current.type !== "calendar" && current.type !== "custom" ? (
          <div className="db-count" aria-live="polite">
            {rows.length} of {total} {total === 1 ? "page" : "pages"}
          </div>
        ) : null}
        {!filtered && !total && current.type !== "table" && current.type !== "calendar" && current.type !== "custom" ? <div className="db-count">No pages yet</div> : null}
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
                const anchor = viewMenu.anchor;
                setViewMenu(null);
                if (viewMenu.view.id !== current.id) setViewId(viewMenu.view.id);
                openSettings(anchor.isConnected ? anchor : undefined);
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
                  if (next && target === current.id) setViewId(next.id);
                }}
              >
                <Trash2 size={14} /> Delete view
              </button>
            ) : null}
          </div>
        </Popover>
      ) : null}
      {settings ? (
        <ViewSettings
          db={db}
          view={current}
          anchor={settings.anchor}
          initialPage={settings.page}
          onClose={() => setSettings(null)}
          onSelectView={setViewId}
          onOpenAdvanced={() => {
            const anchor = settings.anchor;
            setSettings(null);
            openAdvanced(filterButton.current ?? anchor);
          }}
        />
      ) : null}
      {filterPick ? (
        <Popover anchor={filterPick} onClose={() => setFilterPick(null)} width={240} placement="bottom-end" label="Add filter">
          <PropertyPicker
            schema={schema}
            onPick={(property) => {
              setFilterPick(null);
              const rule = defaultFilter(property);
              updateView(db, current.id, (target) => {
                target.filters = [...target.filters, rule];
                target.showFilterBar = true;
              });
              setEditRuleId(rule.id);
            }}
            footer={
              <button
                type="button"
                className="db-menu-item"
                onClick={() => {
                  const anchor = filterPick;
                  setFilterPick(null);
                  openAdvanced(anchor);
                }}
              >
                <FilterIcon /> Advanced filter
              </button>
            }
          />
        </Popover>
      ) : null}
      {sortAnchor ? <SortEditor db={db} view={current} anchor={sortAnchor} onClose={() => setSortAnchor(null)} /> : null}
      {advanced && current.advanced ? <AdvancedFilter db={db} view={current} anchor={advanced} onClose={() => setAdvanced(null)} /> : null}
    </div>
  );
}

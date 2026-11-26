import {
  Lock,
  LockOpen,
  ArrowUpDown,
  BarChart3,
  ChevronLeft,
  ChevronRight,
  Code2,
  Copy,
  Database,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  LayoutGrid,
  ListTree,
  PanelsTopLeft,
  Plus,
  Rows3,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  BOARD_GROUP_TYPES,
  OPEN_MODES,
  TITLE_ID,
  VIEW_TYPES,
  canGroupBy,
  countRules,
  defaultFilter,
  groupRows,
  newView,
  orderedPropertyIds,
  propertyById,
  uid,
  valueType,
  type DatabaseView,
  type OpenMode,
  type Property,
  type ViewType,
} from "../../lib/database";
import { ChartSettings } from "./ChartSettings";
import { CustomViewEditor } from "./CustomView";
import { FilterRuleEditor, PropertyPicker, SortList, filterSummary, starterGroup } from "./FilterSort";
import { PropertyIcon, ViewGlyph, ViewIcon } from "./parts";
import { SourcePicker } from "./SourcePicker";
import { Popover } from "./Popover";
import { findView, movePropertyInView, setPropertyHidden, updateView } from "./ops";
import type { DatabaseApi } from "./useDatabase";

/** Applies a layout switch, filling in the setting the new layout needs. */
export function switchLayout(db: DatabaseApi, viewId: string, type: ViewType) {
  db.updateSchema((schema) => {
    const view = findView(schema, viewId);
    if (!view || view.type === type) return;
    const fresh = newView(type, schema);
    view.type = type;
    if (type === "board") {
      const current = view.groupBy ? schema.properties.find((p) => p.id === view.groupBy) : undefined;
      if (!current || !BOARD_GROUP_TYPES.includes(valueType(current))) view.groupBy = fresh.groupBy;
    }
    if (type === "calendar" && !view.dateProperty) view.dateProperty = fresh.dateProperty;
    if (type === "gallery" && !view.cardPreview) view.cardPreview = "cover";
    if (type === "chart" && !view.chart) view.chart = fresh.chart;
    if (type === "custom" && !view.custom) view.custom = fresh.custom;
    if (VIEW_TYPES.some((item) => item.name === view.name)) view.name = VIEW_TYPES.find((item) => item.type === type)?.name ?? view.name;
  });
}

export function duplicateView(db: DatabaseApi, viewId: string): string {
  const id = uid("view");
  db.updateSchema((schema) => {
    const index = schema.views.findIndex((view) => view.id === viewId);
    if (index < 0) return;
    const copy: DatabaseView = { ...structuredClone(schema.views[index]), id, name: `${schema.views[index].name} copy` };
    schema.views.splice(index + 1, 0, copy);
  });
  return id;
}

export function deleteView(db: DatabaseApi, viewId: string) {
  db.updateSchema((schema) => {
    if (schema.views.length <= 1) return;
    schema.views = schema.views.filter((view) => view.id !== viewId);
  });
}

/** Layouts that can be grouped, and by what. */
export function groupablePropertiesFor(view: DatabaseView, properties: Property[]): Property[] {
  if (view.type === "board") return properties.filter((p) => BOARD_GROUP_TYPES.includes(valueType(p)));
  if (view.type === "table" || view.type === "list" || view.type === "gallery") return properties.filter(canGroupBy);
  return [];
}

export const ROW_LIMITS = [10, 25, 50, 100, 250, 0];

function Select<T extends string>({ value, options, onChange, label, none }: { value: T | undefined; options: { id: T; name: string }[]; onChange: (value: T) => void; label: string; none?: string }) {
  return (
    <select className="db-select" aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value as T)}>
      {value === undefined || none ? <option value="">{none ?? "None"}</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}

function Switch({ on, onToggle, label }: { on: boolean; onToggle: () => void; label: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} className={`db-switch ${on ? "is-on" : ""}`} onClick={onToggle}>
      <span />
    </button>
  );
}

function Row({ label, children, hint, icon: Icon }: { label: string; children: ReactNode; hint?: string; icon?: LucideIcon }) {
  return (
    <label className={`db-settings-row ${Icon ? "has-icon" : ""}`}>
      {Icon ? <Icon size={14} className="db-settings-row-icon" aria-hidden /> : null}
      <span className="db-settings-row-label">
        {label}
        {hint ? <small>{hint}</small> : null}
      </span>
      {children}
    </label>
  );
}

function NavRow({ icon: Icon, label, value, onClick }: { icon: LucideIcon; label: string; value?: string; onClick?: () => void }) {
  return (
    <button type="button" className={`db-menu-item db-settings-nav ${onClick ? "" : "is-static"}`} onClick={onClick} disabled={!onClick}>
      <Icon size={14} />
      <span className="db-settings-nav-label">{label}</span>
      {value ? <span className="db-settings-nav-value">{value}</span> : null}
      {onClick ? <ChevronRight size={14} className="db-settings-nav-chevron" /> : null}
    </button>
  );
}

function PageHead({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <div className="db-settings-head">
      <button type="button" className="icon-button tiny" aria-label="Back" onClick={onBack}>
        <ChevronLeft size={15} />
      </button>
      <span>{title}</span>
    </div>
  );
}

export type SettingsPage = "root" | "layout" | "properties" | "filter" | "sort" | "group" | "chart" | "open" | "source";

interface ViewSettingsProps {
  db: DatabaseApi;
  view: DatabaseView;
  anchor: HTMLElement;
  onClose: () => void;
  /** Duplicates the view (the caller selects the copy). */
  onDuplicate: () => void;
  /** Deletes the view; absent when it is the last one. */
  onDelete?: () => void;
  /** Opens the icon picker for this view (the popover closes first). */
  onPickIcon?: () => void;
  /** The database the view reads; `onChange` lets a block point the view at another one. */
  source?: { id: string; title: string; icon: string; onChange?: (databaseId: string) => void };
  /** Opens the advanced filter editor (the popover closes first). */
  onOpenAdvanced?: () => void;
  /** Page to open on (e.g. the board's "Group" button opens "group"). */
  initialPage?: SettingsPage;
}

const PAGE_WIDTH: Partial<Record<SettingsPage, number>> = { sort: 340, chart: 320, source: 280 };

export function ViewSettings({ db, view, anchor, onClose, onDuplicate, onDelete, onPickIcon, source, onOpenAdvanced, initialPage = "root" }: ViewSettingsProps) {
  const { schema } = db;
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const [name, setName] = useState(view.name);
  const [editingCode, setEditingCode] = useState(false);
  const set = (change: (target: DatabaseView) => void) => updateView(db, view.id, change);
  const typeName = VIEW_TYPES.find((item) => item.type === view.type)?.name ?? view.type;
  const shownCount = schema.properties.filter((p) => !view.hidden.includes(p.id)).length;
  const filterCount = view.filters.length + countRules(view.advanced);
  const groupable = groupablePropertiesFor(view, schema.properties);
  const groupProperty = view.groupBy ? propertyById(schema, view.groupBy) : undefined;
  const dated = schema.properties.filter((p) => ["date", "createdTime", "lastEdited"].includes(valueType(p)));
  const paged = view.type === "table" || view.type === "list" || view.type === "gallery";
  const hasRows = view.type !== "chart" && view.type !== "custom";
  const openMode = OPEN_MODES.find((mode) => mode.id === (view.openIn ?? "modal"));
  const back = () => setPage("root");

  useEffect(() => setName(view.name), [view.name]);

  const commitName = () => {
    const clean = name.trim();
    if (clean && clean !== view.name) set((target) => { target.name = clean; });
    else if (!clean) setName(view.name);
  };

  // Display options for the current layout, shown under the layout picker.
  const layoutOptions = (
    <>
        <div className="db-menu-sep" />
        <div className="db-settings-section" aria-label={`${typeName} options`}>
          {view.type === "table" ? (
            <>
              <Row label="Wrap cell content">
                <Switch on={!!view.wrap} label="Wrap cell content" onToggle={() => set((target) => { target.wrap = !target.wrap; })} />
              </Row>
              <Row label="Row numbers">
                <Switch on={!!view.rowNumbers} label="Row numbers" onToggle={() => set((target) => { target.rowNumbers = !target.rowNumbers; })} />
              </Row>
            </>
          ) : null}
          {view.type === "board" ? (
            <Row label="Colour columns">
              <Switch on={!!view.colorColumns} label="Colour columns" onToggle={() => set((target) => { target.colorColumns = !target.colorColumns; })} />
            </Row>
          ) : null}
          {view.type === "gallery" ? (
            <>
              <Row label="Card preview">
                <Select
                  label="Card preview"
                  value={view.cardPreview ?? "cover"}
                  options={[
                    { id: "cover", name: "Page cover" },
                    { id: "none", name: "None" },
                  ]}
                  onChange={(value) => set((target) => { target.cardPreview = value as "cover" | "none"; })}
                />
              </Row>
              <Row label="Card size">
                <div className="db-segmented" role="radiogroup" aria-label="Card size">
                  {(["small", "medium", "large"] as const).map((size) => (
                    <button
                      key={size}
                      type="button"
                      role="radio"
                      aria-checked={(view.cardSize ?? "medium") === size}
                      className={(view.cardSize ?? "medium") === size ? "is-active" : ""}
                      title={size[0].toUpperCase() + size.slice(1)}
                      onClick={() => set((target) => { target.cardSize = size; })}
                    >
                      {size[0].toUpperCase()}
                    </button>
                  ))}
                </div>
              </Row>
            </>
          ) : null}
          {view.type === "calendar" ? (
            <Row label="Show calendar by">
              <Select
                label="Calendar date property"
                value={view.dateProperty}
                options={dated.map((p) => ({ id: p.id, name: p.name }))}
                onChange={(value) => set((target) => { target.dateProperty = value; })}
              />
            </Row>
          ) : null}
          {hasRows ? (
            <Row label="Show page icons">
              <Switch on={view.showIcons !== false} label="Show page icons" onToggle={() => set((target) => { target.showIcons = target.showIcons === false; })} />
            </Row>
          ) : null}
          {paged ? (
            <Row label="Load limit">
              <Select
                label="Load limit"
                value={String(view.limit ?? 0)}
                options={ROW_LIMITS.map((limit) => ({ id: String(limit), name: limit ? `${limit} rows` : "Default" }))}
                onChange={(value) => set((target) => { target.limit = Number(value) || undefined; })}
              />
            </Row>
          ) : null}
          <Row label="Show filter bar">
            <Switch on={view.showFilterBar !== false} label="Show filter bar" onToggle={() => set((target) => { target.showFilterBar = target.showFilterBar === false; })} />
          </Row>
        </div>
        {view.type !== "custom" ? <NavRow icon={PanelsTopLeft} label="Open pages in" value={openMode?.name} onClick={() => setPage("open")} /> : null}
    </>
  );

  let body: ReactNode;
  if (page === "layout") body = (
    <>
      <LayoutPage db={db} view={view} onBack={back} />
      {layoutOptions}
    </>
  );
  else if (page === "properties") body = <PropertiesPage db={db} view={view} onBack={back} />;
  else if (page === "filter") body = <FilterPage db={db} view={view} onBack={back} onOpenAdvanced={onOpenAdvanced} />;
  else if (page === "sort") body = (
    <>
      <PageHead title="Sort" onBack={back} />
      <SortList db={db} view={view} />
    </>
  );
  else if (page === "group") body = <GroupPage db={db} view={view} onBack={back} />;
  else if (page === "chart") body = (
    <>
      <PageHead title="Chart" onBack={back} />
      <ChartSettings db={db} view={view} />
    </>
  );
  else if (page === "open") body = <OpenPage view={view} onBack={() => setPage("layout")} onPick={(mode) => set((target) => { target.openIn = mode; })} />;
  else if (page === "source" && source?.onChange) body = (
    <>
      <PageHead title="Source" onBack={back} />
      <SourcePicker
        current={source.id}
        label="Show rows from"
        onPick={(databaseId) => {
          if (databaseId !== source.id) source.onChange?.(databaseId);
          back();
        }}
      />
    </>
  );
  else
    body = (
      <>
        <div className="db-settings-name">
          <button
            type="button"
            className="db-settings-icon"
            aria-label="Change view icon"
            title="Change icon"
            disabled={!onPickIcon}
            onClick={() => {
              commitName();
              onPickIcon?.();
            }}
          >
            <ViewGlyph view={view} size={15} />
          </button>
          <input
            className="db-input"
            value={name}
            aria-label="View name"
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.key === "Enter") commitName();
            }}
          />
        </div>
        <NavRow icon={LayoutGrid} label="Layout" value={typeName} onClick={() => setPage("layout")} />
        {source ? (
          <NavRow
            icon={Database}
            label="Source"
            value={source.title || "Untitled"}
            onClick={source.onChange ? () => setPage("source") : undefined}
          />
        ) : null}
        <div className="db-menu-sep" />
        {view.type !== "custom" ? <NavRow icon={Eye} label="Properties" value={`${shownCount} shown`} onClick={() => setPage("properties")} /> : null}
        <NavRow icon={Filter} label="Filter" value={filterCount ? `${filterCount} ${filterCount === 1 ? "rule" : "rules"}` : "None"} onClick={() => setPage("filter")} />
        <NavRow icon={ArrowUpDown} label="Sort" value={view.sorts.length ? `${view.sorts.length} ${view.sorts.length === 1 ? "sort" : "sorts"}` : "None"} onClick={() => setPage("sort")} />
        {groupable.length || view.type === "board" ? (
          <NavRow icon={Rows3} label={view.type === "board" ? "Group by" : "Group"} value={groupProperty?.name ?? "None"} onClick={() => setPage("group")} />
        ) : null}
        {view.type === "chart" ? <NavRow icon={BarChart3} label="Chart options" value={chartKindName(view)} onClick={() => setPage("chart")} /> : null}
        {view.type === "custom" ? (
          <button type="button" className="db-menu-item db-settings-nav" onClick={() => setEditingCode(true)}>
            <Code2 size={14} />
            <span className="db-settings-nav-label">Edit view code</span>
            <ChevronRight size={14} className="db-settings-nav-chevron" />
          </button>
        ) : null}

        <div className="db-menu-sep" />
        <Row icon={db.locked ? Lock : LockOpen} label="Lock database" hint={db.locked ? "Rows can't be edited, added or removed" : undefined}>
          <Switch on={db.locked} label="Lock database" onToggle={() => db.updateSchema((draft) => { draft.locked = !draft.locked || undefined; })} />
        </Row>
        <div className="db-menu-sep" />
        <button
          type="button"
          className="db-menu-item"
          onClick={() => {
            commitName();
            onClose();
            onDuplicate();
          }}
        >
          <Copy size={14} /> Duplicate view
        </button>
        {onDelete ? (
          <button
            type="button"
            className="db-menu-item danger"
            onClick={() => {
              onClose();
              onDelete();
            }}
          >
            <Trash2 size={14} /> Delete view
          </button>
        ) : null}
      </>
    );

  return (
    <>
      <Popover anchor={anchor} onClose={() => { commitName(); onClose(); }} width={PAGE_WIDTH[page] ?? 300} placement="bottom-end" label="View settings">
        <div className={`db-menu db-settings is-${page}`} key={page}>
          {body}
        </div>
      </Popover>
      {editingCode ? <CustomViewEditor db={db} view={view} onClose={() => setEditingCode(false)} /> : null}
    </>
  );
}

function chartKindName(view: DatabaseView): string {
  const kind = view.chart?.kind ?? "bar";
  return kind[0].toUpperCase() + kind.slice(1);
}

/** Layout picker. The layout's display options render below it. */
function LayoutPage({ db, view, onBack }: { db: DatabaseApi; view: DatabaseView; onBack: () => void }) {
  return (
    <>
      <PageHead title="Layout" onBack={onBack} />
      <div className="db-layouts" role="radiogroup" aria-label="Layout">
        {VIEW_TYPES.map((item) => (
          <button
            key={item.type}
            type="button"
            role="radio"
            aria-checked={view.type === item.type}
            className={`db-layout ${view.type === item.type ? "is-active" : ""}`}
            onClick={() => switchLayout(db, view.id, item.type)}
          >
            <ViewIcon type={item.type} />
            <span>{item.name}</span>
          </button>
        ))}
      </div>
    </>
  );
}

function OpenPage({ view, onBack, onPick }: { view: DatabaseView; onBack: () => void; onPick: (mode: OpenMode) => void }) {
  return (
    <>
      <PageHead title="Open pages in" onBack={onBack} />
      <div className="db-open-modes" role="radiogroup" aria-label="Open pages in">
        {OPEN_MODES.map((mode) => {
          const active = (view.openIn ?? "modal") === mode.id;
          return (
            <button
              key={mode.id}
              type="button"
              role="radio"
              aria-checked={active}
              className={`db-open-mode ${active ? "is-active" : ""}`}
              onClick={() => onPick(mode.id as OpenMode)}
              title={mode.description}
            >
              <OpenModeGlyph mode={mode.id} />
              <span>{mode.name}</span>
            </button>
          );
        })}
      </div>
      <p className="db-settings-note">{OPEN_MODES.find((mode) => mode.id === (view.openIn ?? "modal"))?.description}</p>
    </>
  );
}

/** A tiny drawing of where the page opens. */
export function OpenModeGlyph({ mode }: { mode: OpenMode }) {
  return (
    <svg className="db-open-glyph" viewBox="0 0 36 24" aria-hidden>
      <rect x="0.5" y="0.5" width="35" height="23" rx="3" className="frame" />
      {mode === "modal" ? <rect x="9" y="5" width="18" height="14" rx="2" className="fill" /> : null}
      {mode === "side" ? <rect x="21" y="2.5" width="12.5" height="19" rx="1.5" className="fill" /> : null}
      {mode === "tab" ? (
        <>
          <rect x="3" y="3" width="10" height="4" rx="1" className="line" />
          <rect x="14.5" y="3" width="10" height="4" rx="1" className="fill" />
          <rect x="3" y="9" width="30" height="12" rx="1.5" className="line" />
        </>
      ) : null}
      {mode === "current" ? <rect x="3" y="3" width="30" height="18" rx="1.5" className="fill" /> : null}
    </svg>
  );
}

function PropertiesPage({ db, view, onBack }: { db: DatabaseApi; view: DatabaseView; onBack: () => void }) {
  const { schema } = db;
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const ids = orderedPropertyIds(schema, view);
  const needle = query.trim().toLowerCase();
  const properties = ids
    .map((id) => propertyById(schema, id))
    .filter((p): p is Property => !!p)
    .filter((p) => !needle || p.name.toLowerCase().includes(needle));
  const hidden = new Set(view.hidden);
  const anyShown = schema.properties.some((p) => !hidden.has(p.id));
  return (
    <>
      <PageHead title="Properties" onBack={onBack} />
      <input
        className="db-input db-settings-search"
        placeholder="Search properties…"
        value={query}
        aria-label="Search properties"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => event.stopPropagation()}
      />
      <div className="db-menu-label db-settings-props-head">
        <span>Shown in view</span>
        <button
          type="button"
          className="db-ghost"
          onClick={() => updateView(db, view.id, (target) => { target.hidden = anyShown ? schema.properties.map((p) => p.id) : []; })}
        >
          {anyShown ? "Hide all" : "Show all"}
        </button>
      </div>
      <div className="db-settings-props">
        {properties.map((property) => {
          const isTitle = property.id === TITLE_ID;
          const isHidden = hidden.has(property.id);
          return (
            <div
              key={property.id}
              className={`db-settings-prop ${dragId === property.id ? "is-dragging" : ""} ${overId === property.id && dragId !== property.id ? "is-over" : ""}`}
              draggable={!isTitle && !needle}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDragId(property.id);
              }}
              onDragOver={(event) => {
                if (!dragId || isTitle) return;
                event.preventDefault();
                setOverId(property.id);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (dragId && dragId !== property.id) movePropertyInView(db, view.id, dragId, property.id);
                setDragId(null);
                setOverId(null);
              }}
              onDragEnd={() => {
                setDragId(null);
                setOverId(null);
              }}
            >
              <span className="db-grip" aria-hidden>{isTitle || needle ? null : <GripVertical size={13} />}</span>
              <PropertyIcon property={property} />
              <span className={`db-settings-prop-name ${isHidden ? "is-muted" : ""}`}>{property.name}</span>
              {isTitle ? null : (
                <button
                  type="button"
                  className="icon-button tiny"
                  aria-label={isHidden ? `Show ${property.name}` : `Hide ${property.name}`}
                  onClick={() => setPropertyHidden(db, view.id, property.id, !isHidden)}
                >
                  {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              )}
            </div>
          );
        })}
        {!properties.length ? <div className="db-menu-empty">No matching properties</div> : null}
      </div>
    </>
  );
}

function FilterPage({ db, view, onBack, onOpenAdvanced }: { db: DatabaseApi; view: DatabaseView; onBack: () => void; onOpenAdvanced?: () => void }) {
  const { schema } = db;
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const set = (change: (target: DatabaseView) => void) => updateView(db, view.id, change);
  const advanced = countRules(view.advanced);
  return (
    <>
      <PageHead title="Filter" onBack={onBack} />
      {view.filters.length > 1 ? (
        <Row label="Match">
          <div className="db-segmented" role="radiogroup" aria-label="Match">
            {(["and", "or"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={(view.filterMode ?? "and") === mode}
                className={(view.filterMode ?? "and") === mode ? "is-active" : ""}
                onClick={() => set((target) => { target.filterMode = mode; })}
              >
                {mode === "and" ? "All" : "Any"}
              </button>
            ))}
          </div>
        </Row>
      ) : null}
      {view.filters.map((rule) => {
        const summary = filterSummary(schema, rule);
        const property = propertyById(schema, rule.propertyId);
        return (
          <div key={rule.id} className="db-settings-rule">
            <button type="button" className="db-menu-item" onClick={(event) => setEditing({ id: rule.id, anchor: event.currentTarget })}>
              {property ? <PropertyIcon property={property} /> : <Filter size={14} />}
              <span className="db-settings-rule-text">
                <strong>{summary.name}</strong> {summary.detail}
              </span>
            </button>
            <button
              type="button"
              className="icon-button tiny"
              aria-label="Remove filter"
              onClick={() => set((target) => { target.filters = target.filters.filter((item) => item.id !== rule.id); })}
            >
              <Trash2 size={13} />
            </button>
          </div>
        );
      })}
      {!view.filters.length ? <div className="db-menu-empty">No simple filters</div> : null}
      <button type="button" className="db-menu-item" onClick={(event) => setAdding(event.currentTarget)}>
        <Plus size={14} /> Add filter
      </button>
      <div className="db-menu-sep" />
      <button
        type="button"
        className="db-menu-item db-settings-nav"
        onClick={() => {
          if (!view.advanced) set((target) => { target.advanced = starterGroup(schema); });
          onOpenAdvanced?.();
        }}
      >
        <ListTree size={14} />
        <span className="db-settings-nav-label">Advanced filter</span>
        <span className="db-settings-nav-value">{view.advanced ? `${advanced} ${advanced === 1 ? "rule" : "rules"}` : "Add"}</span>
        <ChevronRight size={14} className="db-settings-nav-chevron" />
      </button>
      {view.filters.length || view.advanced ? (
        <button
          type="button"
          className="db-menu-item danger"
          onClick={() => set((target) => { target.filters = []; target.advanced = undefined; })}
        >
          <Trash2 size={14} /> Clear all filters
        </button>
      ) : null}
      {editing ? <FilterRuleEditor db={db} view={view} ruleId={editing.id} anchor={editing.anchor} onClose={() => setEditing(null)} /> : null}
      {adding ? (
        <Popover anchor={adding} onClose={() => setAdding(null)} width={240} label="Filter by">
          <PropertyPicker
            schema={schema}
            onPick={(property) => {
              const rule = defaultFilter(property);
              setAdding(null);
              set((target) => { target.filters = [...target.filters, rule]; });
            }}
          />
        </Popover>
      ) : null}
    </>
  );
}

function GroupPage({ db, view, onBack }: { db: DatabaseApi; view: DatabaseView; onBack: () => void }) {
  const { schema } = db;
  const set = (change: (target: DatabaseView) => void) => updateView(db, view.id, change);
  const groupable = groupablePropertiesFor(view, schema.properties);
  const property = view.groupBy ? propertyById(schema, view.groupBy) : undefined;
  const groups = property ? groupRows(db.rows, property) : [];
  const hidden = new Set(view.hiddenGroups ?? []);
  const board = view.type === "board";
  return (
    <>
      <PageHead title="Group" onBack={onBack} />
      <Row label="Group by">
        <Select
          label="Group by"
          value={property?.id}
          none={board ? undefined : "None"}
          options={groupable.map((p) => ({ id: p.id, name: p.name }))}
          onChange={(value) =>
            set((target) => {
              target.groupBy = value || undefined;
              target.hiddenGroups = [];
              target.collapsedGroups = [];
            })
          }
        />
      </Row>
      {board && !groupable.length ? <div className="db-menu-empty">Add a select, status or checkbox property to build a board.</div> : null}
      {property ? (
        <>
          <Row label="Hide empty groups">
            <Switch on={!!view.hideEmptyGroups} label="Hide empty groups" onToggle={() => set((target) => { target.hideEmptyGroups = !target.hideEmptyGroups; })} />
          </Row>
          {!board ? (
            <div className="db-settings-pair">
              <button type="button" className="db-ghost" onClick={() => set((target) => { target.collapsedGroups = groups.map((g) => g.id); })}>
                Collapse all
              </button>
              <button type="button" className="db-ghost" onClick={() => set((target) => { target.collapsedGroups = []; })}>
                Expand all
              </button>
            </div>
          ) : null}
          <div className="db-menu-label db-settings-props-head">
            <span>Groups</span>
            <span className="db-settings-count">{groups.length - groups.filter((g) => hidden.has(g.id)).length} shown</span>
          </div>
          <div className="db-settings-props">
            {groups.map((group) => {
              const isHidden = hidden.has(group.id);
              return (
                <div key={group.id} className="db-settings-prop">
                  <span className={`db-group-dot tone-${group.color}`} aria-hidden />
                  <span className={`db-settings-prop-name ${isHidden ? "is-muted" : ""}`}>{group.name}</span>
                  <span className="db-settings-count">{group.rows.length}</span>
                  <button
                    type="button"
                    className="icon-button tiny"
                    aria-label={isHidden ? `Show ${group.name}` : `Hide ${group.name}`}
                    onClick={() =>
                      set((target) => {
                        const list = new Set(target.hiddenGroups ?? []);
                        if (list.has(group.id)) list.delete(group.id);
                        else list.add(group.id);
                        target.hiddenGroups = [...list];
                      })
                    }
                  >
                    {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                  </button>
                </div>
              );
            })}
          </div>
          {!board ? (
            <button
              type="button"
              className="db-menu-item danger"
              onClick={() => set((target) => { target.groupBy = undefined; target.hiddenGroups = []; target.collapsedGroups = []; })}
            >
              <Trash2 size={14} /> Remove grouping
            </button>
          ) : null}
        </>
      ) : null}
    </>
  );
}

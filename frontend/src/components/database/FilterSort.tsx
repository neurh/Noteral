import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, EyeOff, GripVertical, ListFilter, ListTree, Plus, Trash2, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  DATE_RANGES,
  RELATIVE_DATES,
  TITLE_ID,
  asValueProperty,
  countRules,
  defaultFilter,
  emptyFilterGroup,
  filterIsActive,
  filterOpsFor,
  formatDate,
  opNeedsValue,
  optionById,
  propertyById,
  type DatabaseSchema,
  type DatabaseView,
  type FilterGroup,
  type FilterRule,
  type Property,
} from "../../lib/database";
import { DatePicker } from "./DatePicker";
import { OptionChip, PropertyIcon } from "./parts";
import { Popover } from "./Popover";
import { updateView } from "./ops";
import type { DatabaseApi } from "./useDatabase";

function allProperties(schema: DatabaseSchema): Property[] {
  return [propertyById(schema, TITLE_ID)!, ...schema.properties];
}

/** Searchable list of properties, used to start a filter or sort. */
export function PropertyPicker({
  schema,
  onPick,
  exclude = [],
  placeholder = "Filter by…",
  footer,
}: {
  schema: DatabaseSchema;
  onPick: (property: Property) => void;
  exclude?: string[];
  placeholder?: string;
  footer?: ReactNode;
}) {
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const items = allProperties(schema).filter((p) => !exclude.includes(p.id) && p.name.toLowerCase().includes(needle));
  return (
    <div className="db-menu">
      <div className="db-menu-pad">
        <input
          className="db-input"
          value={query}
          autoFocus
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && items[0]) onPick(items[0]);
          }}
        />
      </div>
      <div className="db-menu-scroll">
        {items.map((property) => (
          <button key={property.id} type="button" className="db-menu-item" onClick={() => onPick(property)}>
            <PropertyIcon property={property} /> {property.name || "Untitled"}
          </button>
        ))}
        {!items.length ? <div className="db-menu-empty">No properties</div> : null}
      </div>
      {footer ? (
        <>
          <div className="db-menu-sep" />
          {footer}
        </>
      ) : null}
    </div>
  );
}

function optionNames(property: Property, value: unknown): string {
  const ids = Array.isArray(value) ? value : [value];
  return ids.map((id) => optionById(property, id)?.name).filter(Boolean).join(", ");
}

function dateValueText(value: unknown): string {
  const relative = RELATIVE_DATES.find((item) => item.id === value);
  return relative ? relative.name.toLowerCase() : formatDate(String(value ?? ""));
}

export function filterSummary(schema: DatabaseSchema, rule: FilterRule): { name: string; detail: string } {
  const source = propertyById(schema, rule.propertyId);
  if (!source) return { name: "Deleted property", detail: "" };
  const property = asValueProperty(source);
  const op = filterOpsFor(property).find((item) => item.op === rule.op)?.name ?? "";
  if (!opNeedsValue(rule.op)) return { name: source.name, detail: op.toLowerCase() };
  if (!filterIsActive(rule)) return { name: source.name, detail: "" };
  let value = String(rule.value);
  let prefix = ["is", "contains", "eq"].includes(rule.op) ? "" : `${op.toLowerCase()} `;
  if (property.type === "select" || property.type === "status" || property.type === "multiSelect") {
    value = optionNames(property, rule.value);
    if (Array.isArray(rule.value) && rule.value.length > 1) prefix = rule.op === "isNot" || rule.op === "notContains" ? "none of " : "any of ";
  }
  if (property.type === "checkbox") value = rule.value ? "Checked" : "Unchecked";
  if (property.type === "date" || property.type === "createdTime" || property.type === "lastEdited") {
    value = rule.op === "within" ? (DATE_RANGES.find((item) => item.id === rule.value)?.name ?? "").toLowerCase() : dateValueText(rule.value);
  }
  return { name: source.name, detail: `${prefix}${value}` };
}

function toggleOption(value: unknown, id: string): string[] {
  const list = Array.isArray(value) ? value.map(String) : value === undefined || value === null || value === "" ? [] : [String(value)];
  return list.includes(id) ? list.filter((item) => item !== id) : [...list, id];
}

function isSelected(value: unknown, id: string): boolean {
  return Array.isArray(value) ? value.includes(id) : value === id;
}

/** The value part of a filter rule, sized for a menu. */
export function RuleValue({ property: source, rule, onChange }: { property: Property; rule: FilterRule; onChange: (value: unknown) => void }) {
  if (!opNeedsValue(rule.op)) return null;
  const property = asValueProperty(source);
  switch (property.type) {
    case "select":
    case "status":
    case "multiSelect": {
      const options = property.options ?? [];
      return (
        <div className="db-menu-scroll is-short">
          {options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="db-menu-item"
              onClick={() => {
                const next = toggleOption(rule.value, option.id);
                onChange(next.length === 0 ? undefined : next.length === 1 ? next[0] : next);
              }}
            >
              <OptionChip option={option} status={property.type === "status"} />
              {isSelected(rule.value, option.id) ? <Check size={14} className="db-menu-check" /> : null}
            </button>
          ))}
          {!options.length ? <div className="db-menu-empty">No options</div> : null}
        </div>
      );
    }
    case "checkbox":
      return (
        <div className="db-segmented">
          <button type="button" className={rule.value ? "is-on" : ""} onClick={() => onChange(true)}>Checked</button>
          <button type="button" className={!rule.value ? "is-on" : ""} onClick={() => onChange(false)}>Unchecked</button>
        </div>
      );
    case "date":
    case "createdTime":
    case "lastEdited": {
      if (rule.op === "within") {
        return (
          <div className="db-menu-scroll is-short">
            {DATE_RANGES.map((range) => (
              <button key={range.id} type="button" className="db-menu-item" onClick={() => onChange(range.id)}>
                {range.name}
                {rule.value === range.id ? <Check size={14} className="db-menu-check" /> : null}
              </button>
            ))}
          </div>
        );
      }
      const relative = typeof rule.value === "string" && rule.value.startsWith("@");
      return (
        <>
          <div className="db-menu-pad">
            <select
              className="db-select is-wide"
              aria-label="Compare with"
              value={relative ? String(rule.value) : "exact"}
              onChange={(event) => onChange(event.target.value === "exact" ? undefined : event.target.value)}
            >
              <option value="exact">Exact date</option>
              {RELATIVE_DATES.map((item) => (
                <option key={item.id} value={item.id}>{item.name}</option>
              ))}
            </select>
          </div>
          {relative ? null : (
            <DatePicker
              allowRange={false}
              value={typeof rule.value === "string" && rule.value ? { start: rule.value } : null}
              onChange={(next) => onChange(next?.start)}
            />
          )}
        </>
      );
    }
    default:
      return (
        <div className="db-menu-pad">
          <input
            className="db-input"
            autoFocus
            type={property.type === "number" ? "number" : "text"}
            value={rule.value === undefined || rule.value === null ? "" : String(rule.value)}
            placeholder="Type a value…"
            aria-label="Filter value"
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) => onChange(property.type === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value)}
          />
        </div>
      );
  }
}

/** Editor for one filter rule. */
export function FilterRuleEditor({ db, view, ruleId, anchor, onClose }: { db: DatabaseApi; view: DatabaseView; ruleId: string; anchor: HTMLElement; onClose: () => void }) {
  const rule = view.filters.find((item) => item.id === ruleId);
  const property = rule ? propertyById(db.schema, rule.propertyId) : undefined;
  const [opsOpen, setOpsOpen] = useState<HTMLElement | null>(null);
  if (!rule || !property) return null;
  const ops = filterOpsFor(property);
  const change = (patch: Partial<FilterRule>) =>
    updateView(db, view.id, (target) => {
      const item = target.filters.find((f) => f.id === ruleId);
      if (item) Object.assign(item, patch);
    });
  return (
    <Popover anchor={anchor} onClose={onClose} width={280} label="Edit filter">
      <div className="db-menu">
        <div className="db-filter-head">
          <span className="db-filter-prop"><PropertyIcon property={property} /> {property.name}</span>
          <button type="button" className="db-ghost db-op-button" onClick={(event) => setOpsOpen(event.currentTarget)}>
            {ops.find((item) => item.op === rule.op)?.name} <ChevronDown size={13} />
          </button>
          <button
            type="button"
            className="icon-button tiny"
            aria-label="Delete filter"
            onClick={() => {
              onClose();
              updateView(db, view.id, (target) => {
                target.filters = target.filters.filter((f) => f.id !== ruleId);
              });
            }}
          >
            <Trash2 size={13} />
          </button>
        </div>
        <RuleValue property={property} rule={rule} onChange={(value) => change({ value })} />
      </div>
      {opsOpen ? (
        <Popover anchor={opsOpen} onClose={() => setOpsOpen(null)} width={190} label="Condition">
          <div className="db-menu">
            {ops.map((item) => (
              <button
                key={item.op}
                type="button"
                className="db-menu-item"
                onClick={() => {
                  setOpsOpen(null);
                  // "Is within" takes a range, the other date conditions a date.
                  if ((item.op === "within") !== (rule.op === "within")) change({ op: item.op, value: undefined });
                  else change({ op: item.op });
                }}
              >
                {item.name}
                {item.op === rule.op ? <Check size={14} className="db-menu-check" /> : null}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </Popover>
  );
}

interface FilterBarProps {
  db: DatabaseApi;
  view: DatabaseView;
  editRuleId: string | null;
  setEditRuleId: (id: string | null) => void;
  /** Opens the advanced filter editor next to an element. */
  onOpenAdvanced: (anchor: HTMLElement) => void;
}

/** The chips row under the toolbar: active sorts and filters. Scrolls sideways when full. */
export function FilterBar({ db, view, editRuleId, setEditRuleId, onOpenAdvanced }: FilterBarProps) {
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [ruleAnchors] = useState(() => new Map<string, HTMLElement>());
  const [, force] = useState(0);
  const usedAnchor = useRef<HTMLElement | undefined>(undefined);
  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const { schema } = db;
  const advancedCount = countRules(view.advanced);
  const advancedItems = view.advanced?.items.length ?? 0;
  const visible = view.showFilterBar !== false && (view.filters.length > 0 || view.sorts.length > 0 || advancedItems > 0);

  // A rule's pill mounts in the same commit as the rule itself, so its anchor
  // is only known after that commit: render once more to open the editor.
  useLayoutEffect(() => {
    const anchor = editRuleId ? ruleAnchors.get(editRuleId) : undefined;
    if (anchor && anchor !== usedAnchor.current) force((n) => n + 1);
  });

  // Fade the edges that have more chips past them; the wheel scrolls sideways.
  useEffect(() => {
    const node = scroller.current;
    if (!node) return;
    const update = () => {
      const max = node.scrollWidth - node.clientWidth;
      setEdges((prev) => {
        const next = { start: node.scrollLeft > 2, end: node.scrollLeft < max - 2 };
        return prev.start === next.start && prev.end === next.end ? prev : next;
      });
    };
    const wheel = (event: WheelEvent) => {
      if (node.scrollWidth <= node.clientWidth || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      event.preventDefault();
      node.scrollLeft += event.deltaY;
    };
    update();
    node.addEventListener("scroll", update, { passive: true });
    node.addEventListener("wheel", wheel, { passive: false });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => {
      node.removeEventListener("scroll", update);
      node.removeEventListener("wheel", wheel);
      observer.disconnect();
    };
  }, [visible]);

  // Keep the rule being edited in view.
  useEffect(() => {
    const anchor = editRuleId ? ruleAnchors.get(editRuleId) : undefined;
    anchor?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [editRuleId, ruleAnchors]);

  if (!visible) return null;
  const firstSort = view.sorts[0] ? propertyById(schema, view.sorts[0].propertyId) : undefined;
  const editAnchor = editRuleId ? ruleAnchors.get(editRuleId) : undefined;
  usedAnchor.current = editAnchor;
  return (
    <div className={`db-filterbar ${edges.start ? "fade-start" : ""} ${edges.end ? "fade-end" : ""}`}>
      <div className="db-filterbar-scroll" ref={scroller}>
        {view.sorts.length ? (
          <button type="button" className="db-pill is-sort" onClick={(event) => setSortAnchor(event.currentTarget)}>
            {view.sorts[0].direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
            {view.sorts.length > 1 ? `${view.sorts.length} sorts` : firstSort?.name ?? "Sort"}
            <ChevronDown size={12} />
          </button>
        ) : null}
        {view.sorts.length && (view.filters.length || advancedItems) ? <span className="db-filterbar-sep" /> : null}
        {view.filters.map((rule, index) => {
          const summary = filterSummary(schema, rule);
          return (
            <span key={rule.id} className="db-filterbar-item">
              {index > 0 ? (
                <button
                  type="button"
                  className="db-ghost db-filter-mode"
                  title="Switch between matching all and any filters"
                  onClick={() => updateView(db, view.id, (target) => { target.filterMode = target.filterMode === "or" ? "and" : "or"; })}
                >
                  {view.filterMode === "or" ? "or" : "and"}
                </button>
              ) : null}
              <button
                type="button"
                ref={(node) => {
                  if (node) ruleAnchors.set(rule.id, node);
                  else ruleAnchors.delete(rule.id);
                }}
                className={`db-pill ${filterIsActive(rule) ? "is-active" : ""}`}
                onClick={() => setEditRuleId(editRuleId === rule.id ? null : rule.id)}
              >
                <span className="db-pill-name">{summary.name}</span>
                {summary.detail ? <span className="db-pill-detail">: {summary.detail}</span> : null}
                <ChevronDown size={12} />
              </button>
            </span>
          );
        })}
        {advancedItems ? (
          <span className="db-filterbar-item">
            {view.filters.length ? <span className="db-filter-mode is-static">and</span> : null}
            <button type="button" className={`db-pill ${advancedCount ? "is-active" : ""}`} onClick={(event) => onOpenAdvanced(event.currentTarget)}>
              <ListTree size={13} />
              <span className="db-pill-name">Advanced</span>
              <span className="db-pill-detail">: {advancedCount === 1 ? "1 rule" : `${advancedCount} rules`}</span>
              <ChevronDown size={12} />
            </button>
          </span>
        ) : null}
        <button type="button" className="db-ghost db-add-filter" onClick={(event) => setAddAnchor(event.currentTarget)}>
          <Plus size={13} /> Filter
        </button>
      </div>
      <div className="db-filterbar-end">
        {view.filters.length || advancedItems ? (
          <button
            type="button"
            className="db-ghost db-clear-filters"
            title="Remove all filters"
            onClick={() => updateView(db, view.id, (target) => { target.filters = []; target.advanced = undefined; })}
          >
            Clear
          </button>
        ) : null}
        <button
          type="button"
          className="icon-button tiny"
          aria-label="Hide filter bar"
          title="Hide filter bar (filters still apply)"
          onClick={() => updateView(db, view.id, (target) => { target.showFilterBar = false; })}
        >
          <EyeOff size={13} />
        </button>
      </div>
      {editRuleId && editAnchor ? (
        <FilterRuleEditor db={db} view={view} ruleId={editRuleId} anchor={editAnchor} onClose={() => setEditRuleId(null)} />
      ) : null}
      {addAnchor ? (
        <Popover anchor={addAnchor} onClose={() => setAddAnchor(null)} width={240} label="Add filter">
          <PropertyPicker
            schema={schema}
            onPick={(property) => {
              setAddAnchor(null);
              const rule = defaultFilter(property);
              updateView(db, view.id, (target) => { target.filters = [...target.filters, rule]; });
              setEditRuleId(rule.id);
            }}
            footer={
              <button
                type="button"
                className="db-menu-item"
                onClick={(event) => {
                  const anchor = addAnchor;
                  event.stopPropagation();
                  setAddAnchor(null);
                  if (!view.advanced) updateView(db, view.id, (target) => { target.advanced = starterGroup(db.schema); });
                  onOpenAdvanced(anchor);
                }}
              >
                <ListTree size={14} /> Advanced filter
              </button>
            }
          />
        </Popover>
      ) : null}
      {sortAnchor ? <SortEditor db={db} view={view} anchor={sortAnchor} onClose={() => setSortAnchor(null)} /> : null}
    </div>
  );
}

/** A fresh advanced filter group with one rule on the title, ready to edit. */
export function starterGroup(schema: DatabaseSchema): FilterGroup {
  const group = emptyFilterGroup("and");
  group.items.push(defaultFilter(propertyById(schema, TITLE_ID)!));
  return group;
}

/** The list of sort rules: drag to reorder, flip direction, remove. */
export function SortList({ db, view, onEmpty }: { db: DatabaseApi; view: DatabaseView; onEmpty?: () => void }) {
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [replacing, setReplacing] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const { schema } = db;
  const used = view.sorts.map((s) => s.propertyId);
  const move = (from: number, to: number) =>
    updateView(db, view.id, (target) => {
      const [item] = target.sorts.splice(from, 1);
      if (item) target.sorts.splice(to, 0, item);
    });
  return (
    <>
      <div className="db-menu">
        {view.sorts.length > 1 ? <div className="db-menu-label">Sorted by, in order</div> : null}
        {view.sorts.map((sort, index) => {
          const property = propertyById(schema, sort.propertyId);
          return (
            <div
              key={`${sort.propertyId}-${index}`}
              className={`db-sort-row ${drag === index ? "is-dragging" : ""} ${over === index && drag !== index ? "is-over" : ""}`}
              draggable={view.sorts.length > 1}
              onDragStart={(event) => {
                event.dataTransfer.effectAllowed = "move";
                setDrag(index);
              }}
              onDragOver={(event) => {
                if (drag === null) return;
                event.preventDefault();
                setOver(index);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (drag !== null && drag !== index) move(drag, index);
                setDrag(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDrag(null);
                setOver(null);
              }}
            >
              {view.sorts.length > 1 ? <span className="db-grip" aria-hidden><GripVertical size={13} /></span> : null}
              <button type="button" className="db-ghost db-sort-prop" onClick={(event) => setReplacing({ index, anchor: event.currentTarget })}>
                {property ? <PropertyIcon property={property} /> : null}
                <span>{property?.name ?? "Deleted property"}</span>
                <ChevronDown size={13} />
              </button>
              <button
                type="button"
                className="db-ghost db-sort-dir"
                onClick={() => updateView(db, view.id, (target) => {
                  const item = target.sorts[index];
                  if (item) item.direction = item.direction === "asc" ? "desc" : "asc";
                })}
              >
                {sort.direction === "asc" ? <><ArrowUp size={13} /> Ascending</> : <><ArrowDown size={13} /> Descending</>}
              </button>
              <button
                type="button"
                className="icon-button tiny"
                aria-label="Remove sort"
                onClick={() => updateView(db, view.id, (target) => { target.sorts = target.sorts.filter((_, i) => i !== index); })}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
        {!view.sorts.length ? <div className="db-menu-empty">No sorts applied</div> : null}
        <div className="db-menu-sep" />
        <button type="button" className="db-menu-item" onClick={(event) => setAdding(event.currentTarget)}>
          <Plus size={14} /> Add sort
        </button>
        {view.sorts.length ? (
          <button
            type="button"
            className="db-menu-item danger"
            onClick={() => {
              updateView(db, view.id, (target) => { target.sorts = []; });
              onEmpty?.();
            }}
          >
            <Trash2 size={14} /> Delete sort
          </button>
        ) : null}
      </div>
      {adding ? (
        <Popover anchor={adding} onClose={() => setAdding(null)} width={240} label="Sort by">
          <PropertyPicker
            schema={schema}
            exclude={used}
            placeholder="Sort by…"
            onPick={(property) => {
              setAdding(null);
              updateView(db, view.id, (target) => { target.sorts = [...target.sorts, { propertyId: property.id, direction: "asc" }]; });
            }}
          />
        </Popover>
      ) : null}
      {replacing ? (
        <Popover anchor={replacing.anchor} onClose={() => setReplacing(null)} width={240} label="Sort by">
          <PropertyPicker
            schema={schema}
            exclude={used.filter((_, i) => i !== replacing.index)}
            placeholder="Sort by…"
            onPick={(property) => {
              const index = replacing.index;
              setReplacing(null);
              updateView(db, view.id, (target) => {
                if (target.sorts[index]) target.sorts[index].propertyId = property.id;
              });
            }}
          />
        </Popover>
      ) : null}
    </>
  );
}

export function SortEditor({ db, view, anchor, onClose }: { db: DatabaseApi; view: DatabaseView; anchor: HTMLElement; onClose: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={340} label="Sorts">
      <SortList db={db} view={view} onEmpty={onClose} />
    </Popover>
  );
}

export function SortIcon() {
  return <ArrowUpDown size={14} />;
}

export function FilterIcon() {
  return <ListFilter size={14} />;
}

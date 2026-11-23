import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, ListFilter, Plus, Trash2, X } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import {
  TITLE_ID,
  defaultFilter,
  filterIsActive,
  filterOpsFor,
  formatDate,
  opNeedsValue,
  optionById,
  propertyById,
  type DatabaseSchema,
  type DatabaseView,
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
export function PropertyPicker({ schema, onPick, exclude = [], placeholder = "Filter by…" }: { schema: DatabaseSchema; onPick: (property: Property) => void; exclude?: string[]; placeholder?: string }) {
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
    </div>
  );
}

export function filterSummary(schema: DatabaseSchema, rule: FilterRule): { name: string; detail: string } {
  const property = propertyById(schema, rule.propertyId);
  if (!property) return { name: "Deleted property", detail: "" };
  const op = filterOpsFor(property.type).find((item) => item.op === rule.op)?.name ?? "";
  if (!opNeedsValue(rule.op)) return { name: property.name, detail: op.toLowerCase() };
  if (!filterIsActive(rule)) return { name: property.name, detail: "" };
  let value = String(rule.value);
  if (property.type === "select" || property.type === "status" || property.type === "multiSelect") value = optionById(property, rule.value)?.name ?? "";
  if (property.type === "checkbox") value = rule.value ? "Checked" : "Unchecked";
  if (property.type === "date" || property.type === "createdTime" || property.type === "lastEdited") value = formatDate(value);
  const prefix = ["is", "contains", "eq"].includes(rule.op) ? "" : `${op.toLowerCase()} `;
  return { name: property.name, detail: `${prefix}${value}` };
}

function RuleValue({ property, rule, onChange }: { property: Property; rule: FilterRule; onChange: (value: unknown) => void }) {
  if (!opNeedsValue(rule.op)) return null;
  switch (property.type) {
    case "select":
    case "status":
    case "multiSelect": {
      const options = property.options ?? [];
      return (
        <div className="db-menu-scroll is-short">
          {options.map((option) => (
            <button key={option.id} type="button" className="db-menu-item" onClick={() => onChange(rule.value === option.id ? undefined : option.id)}>
              <OptionChip option={option} status={property.type === "status"} />
              {rule.value === option.id ? <Check size={14} className="db-menu-check" /> : null}
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
    case "lastEdited":
      return (
        <DatePicker
          allowRange={false}
          value={typeof rule.value === "string" && rule.value ? { start: rule.value } : null}
          onChange={(next) => onChange(next?.start)}
        />
      );
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
  const ops = filterOpsFor(property.type);
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
                  change({ op: item.op });
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

/** The chips row under the toolbar: active sorts and filters. */
export function FilterBar({ db, view, editRuleId, setEditRuleId }: { db: DatabaseApi; view: DatabaseView; editRuleId: string | null; setEditRuleId: (id: string | null) => void }) {
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [ruleAnchors] = useState(() => new Map<string, HTMLElement>());
  const [, force] = useState(0);
  const usedAnchor = useRef<HTMLElement | undefined>(undefined);
  const { schema } = db;
  // A rule's pill mounts in the same commit as the rule itself, so its anchor
  // is only known after that commit: render once more to open the editor.
  useLayoutEffect(() => {
    const anchor = editRuleId ? ruleAnchors.get(editRuleId) : undefined;
    if (anchor && anchor !== usedAnchor.current) force((n) => n + 1);
  });
  if (!view.filters.length && !view.sorts.length) return null;
  const firstSort = view.sorts[0] ? propertyById(schema, view.sorts[0].propertyId) : undefined;
  const editAnchor = editRuleId ? ruleAnchors.get(editRuleId) : undefined;
  usedAnchor.current = editAnchor;
  return (
    <div className="db-filterbar">
      {view.sorts.length ? (
        <button type="button" className="db-pill is-sort" onClick={(event) => setSortAnchor(event.currentTarget)}>
          {view.sorts[0].direction === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />}
          {view.sorts.length > 1 ? `${view.sorts.length} sorts` : firstSort?.name ?? "Sort"}
          <ChevronDown size={12} />
        </button>
      ) : null}
      {view.sorts.length && view.filters.length ? <span className="db-filterbar-sep" /> : null}
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
      <button type="button" className="db-ghost db-add-filter" onClick={(event) => setAddAnchor(event.currentTarget)}>
        <Plus size={13} /> Add filter
      </button>
      {view.filters.length ? (
        <button
          type="button"
          className="db-ghost db-clear-filters"
          onClick={() => updateView(db, view.id, (target) => { target.filters = []; })}
        >
          Clear
        </button>
      ) : null}
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
          />
        </Popover>
      ) : null}
      {sortAnchor ? <SortEditor db={db} view={view} anchor={sortAnchor} onClose={() => setSortAnchor(null)} /> : null}
    </div>
  );
}

/** The list of sort rules with direction and removal. */
export function SortEditor({ db, view, anchor, onClose }: { db: DatabaseApi; view: DatabaseView; anchor: HTMLElement; onClose: () => void }) {
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const [replacing, setReplacing] = useState<{ index: number; anchor: HTMLElement } | null>(null);
  const { schema } = db;
  const used = view.sorts.map((s) => s.propertyId);
  return (
    <Popover anchor={anchor} onClose={onClose} width={320} label="Sorts">
      <div className="db-menu">
        {view.sorts.map((sort, index) => {
          const property = propertyById(schema, sort.propertyId);
          return (
            <div key={`${sort.propertyId}-${index}`} className="db-sort-row">
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
              onClose();
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
    </Popover>
  );
}

export function SortIcon() {
  return <ArrowUpDown size={14} />;
}

export function FilterIcon() {
  return <ListFilter size={14} />;
}

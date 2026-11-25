import { ChevronDown, Copy, Ellipsis, Group, ListTree, Plus, Trash2, Ungroup } from "lucide-react";
import { useState } from "react";
import {
  DATE_RANGES,
  RELATIVE_DATES,
  TITLE_ID,
  asValueProperty,
  countRules,
  defaultFilter,
  emptyFilterGroup,
  filterOpsFor,
  isFilterGroup,
  opNeedsValue,
  optionById,
  propertyById,
  uid,
  type DatabaseSchema,
  type DatabaseView,
  type FilterGroup,
  type FilterNode,
  type FilterOp,
  type FilterRule,
  type Property,
} from "../../lib/database";
import { RuleValue } from "./FilterSort";
import { Popover } from "./Popover";
import { updateView } from "./ops";
import type { DatabaseApi } from "./useDatabase";

/** Groups nest at most this deep (the root is depth 0). */
const MAX_DEPTH = 2;

function allProperties(schema: DatabaseSchema): Property[] {
  return [propertyById(schema, TITLE_ID)!, ...schema.properties];
}

/** Finds a node and its parent group in a tree by id. */
function locate(group: FilterGroup, id: string): { node: FilterNode; parent: FilterGroup; index: number } | null {
  for (let index = 0; index < group.items.length; index++) {
    const node = group.items[index];
    if (node.id === id) return { node, parent: group, index };
    if (isFilterGroup(node)) {
      const hit = locate(node, id);
      if (hit) return hit;
    }
  }
  return null;
}

function cloneWithIds(node: FilterNode): FilterNode {
  if (isFilterGroup(node)) return { id: uid("grp"), mode: node.mode, items: node.items.map(cloneWithIds) };
  return { ...structuredClone(node), id: uid("flt") };
}

/** Short text for a rule value, shown on the value button. */
function valueLabel(property: Property, rule: FilterRule): string {
  const value = rule.value;
  if (value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length)) return "Value";
  switch (property.type) {
    case "select":
    case "status":
    case "multiSelect": {
      const ids = Array.isArray(value) ? value : [value];
      const names = ids.map((id) => optionById(property, id)?.name).filter(Boolean);
      return names.length > 2 ? `${names.length} options` : names.join(", ") || "Value";
    }
    case "checkbox":
      return value ? "Checked" : "Unchecked";
    case "date":
    case "createdTime":
    case "lastEdited":
      if (rule.op === "within") return DATE_RANGES.find((item) => item.id === value)?.name ?? "Value";
      return RELATIVE_DATES.find((item) => item.id === value)?.name ?? String(value);
    default:
      return String(value);
  }
}

interface EditorContext {
  db: DatabaseApi;
  view: DatabaseView;
  /** Mutates the stored tree of this view. */
  edit: (change: (root: FilterGroup) => void) => void;
}

function RuleRow({ ctx, rule, depth }: { ctx: EditorContext; rule: FilterRule; depth: number }) {
  const { db, edit } = ctx;
  const source = propertyById(db.schema, rule.propertyId);
  const [valueAnchor, setValueAnchor] = useState<HTMLElement | null>(null);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const property = source ? asValueProperty(source) : undefined;
  const ops = property ? filterOpsFor(property) : [];
  const set = (patch: Partial<FilterRule>) =>
    edit((root) => {
      const hit = locate(root, rule.id);
      if (hit && !isFilterGroup(hit.node)) Object.assign(hit.node, patch);
    });
  const inlineInput = property && !["select", "status", "multiSelect", "checkbox", "date", "createdTime", "lastEdited"].includes(property.type);
  return (
    <>
      <select
        className="db-select db-adv-prop"
        aria-label="Property"
        value={rule.propertyId}
        onChange={(event) => {
          const next = propertyById(db.schema, event.target.value);
          if (!next) return;
          const fresh = defaultFilter(next);
          set({ propertyId: next.id, op: fresh.op, value: fresh.value });
        }}
      >
        {!source ? <option value={rule.propertyId}>Deleted property</option> : null}
        {allProperties(db.schema).map((item) => (
          <option key={item.id} value={item.id}>
            {item.name || "Untitled"}
          </option>
        ))}
      </select>
      <select
        className="db-select db-adv-op"
        aria-label="Condition"
        value={rule.op}
        onChange={(event) => {
          const op = event.target.value as FilterOp;
          if ((op === "within") !== (rule.op === "within")) set({ op, value: undefined });
          else set({ op });
        }}
      >
        {ops.map((item) => (
          <option key={item.op} value={item.op}>
            {item.name}
          </option>
        ))}
      </select>
      <div className="db-adv-value">
        {!property || !opNeedsValue(rule.op) ? null : inlineInput ? (
          <input
            className="db-input"
            type={property.type === "number" ? "number" : "text"}
            value={rule.value === undefined || rule.value === null ? "" : String(rule.value)}
            placeholder="Value"
            aria-label="Filter value"
            onKeyDown={(event) => event.stopPropagation()}
            onChange={(event) =>
              set({ value: property.type === "number" ? (event.target.value === "" ? undefined : Number(event.target.value)) : event.target.value })
            }
          />
        ) : (
          <button type="button" className="db-select db-adv-value-button" onClick={(event) => setValueAnchor(event.currentTarget)}>
            <span>{valueLabel(property, rule)}</span>
            <ChevronDown size={12} />
          </button>
        )}
      </div>
      <button type="button" className="icon-button tiny" aria-label="Rule options" onClick={(event) => setMenu(event.currentTarget)}>
        <Ellipsis size={14} />
      </button>
      {valueAnchor && source ? (
        <Popover anchor={valueAnchor} onClose={() => setValueAnchor(null)} width={260} label="Filter value">
          <div className="db-menu">
            <RuleValue property={source} rule={rule} onChange={(value) => set({ value })} />
          </div>
        </Popover>
      ) : null}
      {menu ? (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={200} placement="bottom-end" label="Rule options">
          <div className="db-menu">
            <button
              type="button"
              className="db-menu-item"
              onClick={() => {
                setMenu(null);
                edit((root) => {
                  const hit = locate(root, rule.id);
                  if (hit) hit.parent.items.splice(hit.index + 1, 0, cloneWithIds(hit.node));
                });
              }}
            >
              <Copy size={14} /> Duplicate rule
            </button>
            {depth < MAX_DEPTH ? (
              <button
                type="button"
                className="db-menu-item"
                onClick={() => {
                  setMenu(null);
                  edit((root) => {
                    const hit = locate(root, rule.id);
                    if (!hit) return;
                    const group = emptyFilterGroup(hit.parent.mode === "and" ? "or" : "and");
                    group.items.push(hit.node);
                    hit.parent.items.splice(hit.index, 1, group);
                  });
                }}
              >
                <Group size={14} /> Turn into group
              </button>
            ) : null}
            <button
              type="button"
              className="db-menu-item danger"
              onClick={() => {
                setMenu(null);
                edit((root) => {
                  const hit = locate(root, rule.id);
                  if (hit) hit.parent.items.splice(hit.index, 1);
                });
              }}
            >
              <Trash2 size={14} /> Remove rule
            </button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

function Conjunction({ ctx, group, index }: { ctx: EditorContext; group: FilterGroup; index: number }) {
  if (index === 0) return <span className="db-adv-conj">Where</span>;
  if (index === 1) {
    return (
      <select
        className="db-select db-adv-conj"
        aria-label="Match"
        value={group.mode}
        onChange={(event) =>
          ctx.edit((root) => {
            const target = root.id === group.id ? root : locate(root, group.id)?.node;
            if (target && isFilterGroup(target)) target.mode = event.target.value === "or" ? "or" : "and";
          })
        }
      >
        <option value="and">And</option>
        <option value="or">Or</option>
      </select>
    );
  }
  return <span className="db-adv-conj">{group.mode === "or" ? "Or" : "And"}</span>;
}

function GroupMenu({ ctx, group, depth }: { ctx: EditorContext; group: FilterGroup; depth: number }) {
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" className="icon-button tiny" aria-label="Group options" onClick={(event) => setMenu(event.currentTarget)}>
        <Ellipsis size={14} />
      </button>
      {menu ? (
        <Popover anchor={menu} onClose={() => setMenu(null)} width={200} placement="bottom-end" label="Group options">
          <div className="db-menu">
            <button
              type="button"
              className="db-menu-item"
              onClick={() => {
                setMenu(null);
                ctx.edit((root) => {
                  const hit = locate(root, group.id);
                  if (hit) hit.parent.items.splice(hit.index + 1, 0, cloneWithIds(hit.node));
                });
              }}
            >
              <Copy size={14} /> Duplicate group
            </button>
            {depth > 0 ? (
              <button
                type="button"
                className="db-menu-item"
                onClick={() => {
                  setMenu(null);
                  ctx.edit((root) => {
                    const hit = locate(root, group.id);
                    if (hit && isFilterGroup(hit.node)) hit.parent.items.splice(hit.index, 1, ...hit.node.items);
                  });
                }}
              >
                <Ungroup size={14} /> Ungroup
              </button>
            ) : null}
            <button
              type="button"
              className="db-menu-item danger"
              onClick={() => {
                setMenu(null);
                ctx.edit((root) => {
                  const hit = locate(root, group.id);
                  if (hit) hit.parent.items.splice(hit.index, 1);
                });
              }}
            >
              <Trash2 size={14} /> Remove group
            </button>
          </div>
        </Popover>
      ) : null}
    </>
  );
}

function GroupBody({ ctx, group, depth }: { ctx: EditorContext; group: FilterGroup; depth: number }) {
  const add = (node: FilterNode) =>
    ctx.edit((root) => {
      const target = root.id === group.id ? root : locate(root, group.id)?.node;
      if (target && isFilterGroup(target)) target.items.push(node);
    });
  const title = propertyById(ctx.db.schema, TITLE_ID)!;
  return (
    <div className={`db-adv-group depth-${depth}`}>
      {group.items.map((node, index) => (
        <div key={node.id} className={`db-adv-row ${isFilterGroup(node) ? "is-group" : ""}`}>
          <Conjunction ctx={ctx} group={group} index={index} />
          {isFilterGroup(node) ? (
            <div className="db-adv-nested">
              <div className="db-adv-nested-head">
                <span>{node.mode === "or" ? "Any of these" : "All of these"}</span>
                <GroupMenu ctx={ctx} group={node} depth={depth + 1} />
              </div>
              <GroupBody ctx={ctx} group={node} depth={depth + 1} />
            </div>
          ) : (
            <RuleRow ctx={ctx} rule={node} depth={depth} />
          )}
        </div>
      ))}
      {!group.items.length ? <div className="db-menu-empty db-adv-empty">No rules yet — every row shows.</div> : null}
      <div className="db-adv-add">
        <button type="button" className="db-ghost" onClick={() => add(defaultFilter(title))}>
          <Plus size={13} /> Add rule
        </button>
        {depth < MAX_DEPTH ? (
          <button
            type="button"
            className="db-ghost"
            onClick={() => {
              const inner = emptyFilterGroup(group.mode === "and" ? "or" : "and");
              inner.items.push(defaultFilter(title));
              add(inner);
            }}
          >
            <ListTree size={13} /> Add group
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** Editor for a view's nested and/or filter tree. */
export function AdvancedFilter({ db, view, anchor, onClose }: { db: DatabaseApi; view: DatabaseView; anchor: HTMLElement; onClose: () => void }) {
  const root = view.advanced ?? emptyFilterGroup("and");
  const ctx: EditorContext = {
    db,
    view,
    edit: (change) =>
      updateView(db, view.id, (target) => {
        if (!target.advanced) target.advanced = { ...root, items: [] };
        change(target.advanced);
      }),
  };
  const count = countRules(view.advanced);
  return (
    <Popover anchor={anchor} onClose={onClose} width={580} placement="bottom-start" label="Advanced filter" className="db-adv-popover">
      <div className="db-menu db-adv">
        <div className="db-adv-head">
          <span className="db-adv-title">
            <ListTree size={14} /> Advanced filter
          </span>
          <span className="db-adv-count">{count ? `${count} active ${count === 1 ? "rule" : "rules"}` : "No active rules"}</span>
        </div>
        {view.filters.length ? <div className="db-adv-note">Also matches the {view.filters.length === 1 ? "simple filter" : `${view.filters.length} simple filters`} in the bar.</div> : null}
        <GroupBody ctx={ctx} group={root} depth={0} />
        <div className="db-menu-sep" />
        <button
          type="button"
          className="db-menu-item danger"
          onClick={() => {
            onClose();
            updateView(db, view.id, (target) => { target.advanced = undefined; });
          }}
        >
          <Trash2 size={14} /> Delete advanced filter
        </button>
      </div>
    </Popover>
  );
}


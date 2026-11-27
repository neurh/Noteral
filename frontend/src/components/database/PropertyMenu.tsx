import {
  ArrowDown,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUp,
  Check,
  ChevronRight,
  Copy,
  EyeOff,
  Gauge,
  ListFilter,
  Plus,
  Puzzle,
  Sigma,
  Trash2,
  WrapText,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useContributions } from "../../lib/contributions";
import { PageIcon } from "../PageIcon";
import { OptionField } from "../PluginOptions";
import { customConfig } from "./CustomCell";
import {
  NUMBER_FORMATS,
  PROPERTY_TYPES,
  TITLE_ID,
  defaultFilter,
  hasOptions,
  nextOptionColor,
  typeName,
  uid,
  type DatabaseView,
  type Property,
  type PropertyType,
  type SelectOption,
} from "../../lib/database";
import { FormulaEditor } from "./FormulaEditor";
import { NumberDisplayMenu, displayName } from "./NumberDisplayMenu";
import { OptionEditor } from "./OptionPicker";
import { OptionChip, PropertyIcon } from "./parts";
import { Popover } from "./Popover";
import {
  changePropertyType,
  duplicateProperty,
  removeProperty,
  renameProperty,
  setPropertyHidden,
  updateView,
} from "./ops";
import type { DatabaseApi } from "./useDatabase";

/** The list of property types (built-in, then plugin and layer types), used when adding or changing a property. */
export function TypeList({ current, currentCustom, onPick, title = "Type" }: { current?: PropertyType; currentCustom?: string; onPick: (type: PropertyType, customType?: string) => void; title?: string }) {
  const [query, setQuery] = useState("");
  const { propertyTypes } = useContributions();
  const needle = query.trim().toLowerCase();
  const types = PROPERTY_TYPES.filter((item) => item.name.toLowerCase().includes(needle));
  const custom = propertyTypes.filter((item) => `${item.title} ${item.type} ${item.description ?? ""} ${item.owner.name}`.toLowerCase().includes(needle));
  return (
    <div className="db-menu">
      <div className="db-menu-pad">
        <input
          className="db-input"
          placeholder="Search for a property type…"
          value={query}
          autoFocus
          aria-label="Search property types"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            if (types[0]) onPick(types[0].type);
            else if (custom[0]) onPick("custom", custom[0].type);
          }}
        />
      </div>
      <div className="db-menu-label">{title}</div>
      <div className="db-menu-scroll">
        {types.map((item) => (
          <button key={item.type} type="button" className="db-menu-item" onClick={() => onPick(item.type)}>
            <PropertyIcon type={item.type} />
            {item.name}
            {current === item.type ? <Check size={14} className="db-menu-check" /> : null}
          </button>
        ))}
        {custom.length ? <div className="db-menu-label">From plugins</div> : null}
        {custom.map((item) => (
          <button key={item.key} type="button" className="db-menu-item" title={item.description ? `${item.description} — ${item.owner.name}` : item.owner.name} onClick={() => onPick("custom", item.type)}>
            <span className="db-prop-icon">{item.icon ? <PageIcon value={item.icon} size={14} fallback={<Puzzle size={14} />} /> : <Puzzle size={14} />}</span>
            {item.title}
            <span className="db-menu-value">{item.owner.name}</span>
            {current === "custom" && currentCustom === item.type ? <Check size={14} className="db-menu-check" /> : null}
          </button>
        ))}
        {!types.length && !custom.length ? <div className="db-menu-empty">No matching types</div> : null}
      </div>
    </div>
  );
}

/** A custom property's per-property options (the type's config fields). */
function CustomConfigSection({ db, property }: { db: DatabaseApi; property: Property }) {
  const { propertyTypeMap } = useContributions();
  const def = property.customType ? propertyTypeMap.get(property.customType) : undefined;
  const timers = useRef(new Map<string, number>());
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  useEffect(() => () => { for (const timer of timers.current.values()) window.clearTimeout(timer); }, []);
  if (!def?.config?.length) return null;
  const config = { ...customConfig(def, property), ...draft };
  return (
    <div className="db-custom-config">
      <div className="db-menu-label">{def.title} options</div>
      {def.config.map((field) => (
        <OptionField
          key={field.key}
          id={`db-cfg-${property.id}-${field.key}`}
          field={field}
          value={config[field.key]}
          onChange={(f, value, delay = 0) => {
            setDraft((current) => ({ ...current, [f.key]: value }));
            window.clearTimeout(timers.current.get(f.key));
            timers.current.set(f.key, window.setTimeout(() => {
              db.updateSchema((schema) => {
                const target = schema.properties.find((item) => item.id === property.id);
                if (target) target.config = { ...(target.config ?? {}), [f.key]: value };
              });
            }, delay));
          }}
        />
      ))}
    </div>
  );
}

function OptionsSection({ db, property }: { db: DatabaseApi; property: Property }) {
  const [editing, setEditing] = useState<{ option: SelectOption; anchor: HTMLElement } | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const options = property.options ?? [];
  const add = () => {
    const name = (draft ?? "").trim();
    setDraft(null);
    if (!name || options.some((o) => o.name.toLowerCase() === name.toLowerCase())) return;
    db.updateSchema((schema) => {
      const target = schema.properties.find((p) => p.id === property.id);
      if (target) target.options = [...(target.options ?? []), { id: uid("opt"), name, color: nextOptionColor(target.options ?? []), ...(property.type === "status" ? { group: "todo" as const } : {}) }];
    });
  };
  return (
    <>
      <div className="db-menu-label db-menu-label-row">
        Options
        <button type="button" className="icon-button tiny" aria-label="Add an option" onClick={() => setDraft("")}>
          <Plus size={13} />
        </button>
      </div>
      <div className="db-menu-scroll is-short">
        {draft !== null ? (
          <div className="db-menu-pad">
            <input
              className="db-input"
              value={draft}
              autoFocus
              placeholder="Option name"
              aria-label="New option name"
              onChange={(event) => setDraft(event.target.value)}
              onBlur={add}
              onKeyDown={(event) => {
                if (event.key === "Enter") add();
                if (event.key === "Escape") {
                  event.stopPropagation();
                  setDraft(null);
                }
              }}
            />
          </div>
        ) : null}
        {options.map((option) => (
          <button
            key={option.id}
            type="button"
            className="db-menu-item"
            onClick={(event) => setEditing({ option, anchor: event.currentTarget })}
          >
            <OptionChip option={option} status={property.type === "status"} />
            <ChevronRight size={14} className="db-menu-trail" />
          </button>
        ))}
        {!options.length && draft === null ? <div className="db-menu-empty">No options</div> : null}
      </div>
      {editing ? (
        <OptionEditor
          anchor={editing.anchor}
          property={property}
          option={options.find((o) => o.id === editing.option.id) ?? editing.option}
          updateSchema={db.updateSchema}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

interface PropertyMenuProps {
  db: DatabaseApi;
  property: Property;
  anchor: HTMLElement;
  onClose: () => void;
  view?: DatabaseView;
  /** Table columns can insert neighbours. */
  onInsert?: (side: "left" | "right") => void;
  /** Opens the view's filter editor with a new rule for this property. */
  onFilter?: (ruleId: string) => void;
}

/** Column header / property menu: rename, type, sort, filter, hide, delete. */
export function PropertyMenu({ db, property, anchor, onClose, view, onInsert, onFilter }: PropertyMenuProps) {
  const [name, setName] = useState(property.name);
  const [sub, setSub] = useState<{ kind: "type" | "format" | "display"; anchor: HTMLElement } | null>(null);
  // A new, empty formula opens straight into the editor.
  const [editFormula, setEditFormula] = useState(() => property.type === "formula" && !property.formula?.trim());
  const isTitle = property.id === TITLE_ID;
  const commitName = () => {
    if (name.trim() && name.trim() !== property.name) renameProperty(db, property.id, name);
  };
  const close = () => {
    commitName();
    onClose();
  };
  const sortBy = (direction: "asc" | "desc") => {
    if (!view) return;
    updateView(db, view.id, (target) => {
      target.sorts = [{ propertyId: property.id, direction }, ...target.sorts.filter((s) => s.propertyId !== property.id)];
    });
    close();
  };
  const currentSort = view?.sorts.find((s) => s.propertyId === property.id)?.direction;

  if (editFormula) {
    const live = db.schema.properties.find((item) => item.id === property.id) ?? property;
    return (
      <FormulaEditor
        db={db}
        property={live}
        onClose={() => {
          commitName();
          onClose();
        }}
      />
    );
  }

  return (
    <Popover anchor={anchor} onClose={close} width={250} label={`${property.name} property`}>
      <div className="db-menu">
        <div className="db-menu-pad db-prop-name">
          <span className="db-prop-name-icon"><PropertyIcon property={property} /></span>
          <input
            className="db-input"
            value={name}
            autoFocus
            aria-label="Property name"
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") close();
            }}
          />
        </div>
        {!isTitle ? (
          <button type="button" className="db-menu-item" onClick={(event) => setSub({ kind: "type", anchor: event.currentTarget })}>
            <PropertyIcon property={property} /> Type
            <span className="db-menu-value">{typeName(property.type)}</span>
            <ChevronRight size={14} className="db-menu-trail" />
          </button>
        ) : null}
        {property.type === "formula" ? (
          <button type="button" className="db-menu-item" onClick={() => setEditFormula(true)}>
            <Sigma size={14} /> Edit formula
            <code className="db-menu-value db-formula-snippet">{property.formula?.trim() || "Empty"}</code>
            <ChevronRight size={14} className="db-menu-trail" />
          </button>
        ) : null}
        {property.type === "number" ? (
          <button type="button" className="db-menu-item" onClick={(event) => setSub({ kind: "format", anchor: event.currentTarget })}>
            <span className="db-menu-glyph">#</span> Number format
            <span className="db-menu-value">{NUMBER_FORMATS.find((f) => f.id === (property.format ?? "number"))?.name}</span>
            <ChevronRight size={14} className="db-menu-trail" />
          </button>
        ) : null}
        {property.type === "number" || (property.type === "formula" && (property.resultType === "number" || !!property.display)) ? (
          <button type="button" className="db-menu-item" onClick={(event) => setSub({ kind: "display", anchor: event.currentTarget })}>
            <Gauge size={14} /> Show as
            <span className="db-menu-value">{displayName(property)}</span>
            <ChevronRight size={14} className="db-menu-trail" />
          </button>
        ) : null}
        {hasOptions(property.type) ? (
          <>
            <div className="db-menu-sep" />
            <OptionsSection db={db} property={property} />
          </>
        ) : null}
        {property.type === "custom" ? <CustomConfigSection db={db} property={property} /> : null}
        {view ? (
          <>
            <div className="db-menu-sep" />
            <button type="button" className="db-menu-item" onClick={() => sortBy("asc")}>
              <ArrowUp size={14} /> Sort ascending {currentSort === "asc" ? <Check size={14} className="db-menu-check" /> : null}
            </button>
            <button type="button" className="db-menu-item" onClick={() => sortBy("desc")}>
              <ArrowDown size={14} /> Sort descending {currentSort === "desc" ? <Check size={14} className="db-menu-check" /> : null}
            </button>
            {onFilter ? (
              <button
                type="button"
                className="db-menu-item"
                onClick={() => {
                  const rule = defaultFilter(property);
                  updateView(db, view.id, (target) => {
                    target.filters = [...target.filters, rule];
                  });
                  close();
                  onFilter(rule.id);
                }}
              >
                <ListFilter size={14} /> Filter
              </button>
            ) : null}
            {!isTitle ? (
              <button
                type="button"
                className="db-menu-item"
                onClick={() => {
                  setPropertyHidden(db, view.id, property.id, true);
                  close();
                }}
              >
                <EyeOff size={14} /> Hide in view
              </button>
            ) : null}
            {view.type === "table" ? (
              <button
                type="button"
                className="db-menu-item"
                onClick={() => updateView(db, view.id, (target) => { target.wrap = !target.wrap; })}
              >
                <WrapText size={14} /> Wrap content {view.wrap ? <Check size={14} className="db-menu-check" /> : null}
              </button>
            ) : null}
          </>
        ) : null}
        {onInsert && !db.locked ? (
          <>
            <div className="db-menu-sep" />
            <button type="button" className="db-menu-item" onClick={() => { close(); onInsert("left"); }}>
              <ArrowLeftToLine size={14} /> Insert left
            </button>
            <button type="button" className="db-menu-item" onClick={() => { close(); onInsert("right"); }}>
              <ArrowRightToLine size={14} /> Insert right
            </button>
          </>
        ) : null}
        {!isTitle ? (
          <>
            <div className="db-menu-sep" />
            {db.locked ? null : (
              <button type="button" className="db-menu-item" onClick={() => { duplicateProperty(db, property.id, view?.id); close(); }}>
                <Copy size={14} /> Duplicate property
              </button>
            )}
            <button
              type="button"
              className="db-menu-item danger"
              onClick={() => {
                onClose();
                removeProperty(db, property.id);
              }}
            >
              <Trash2 size={14} /> Delete property
            </button>
          </>
        ) : null}
      </div>
      {sub?.kind === "type" ? (
        <Popover anchor={sub.anchor} onClose={() => setSub(null)} placement="right-start" width={240} label="Property type">
          <TypeList
            current={property.type}
            currentCustom={property.customType}
            onPick={(type, customType) => {
              setSub(null);
              changePropertyType(db, property.id, type, customType);
              if (type === "formula") setEditFormula(true);
            }}
          />
        </Popover>
      ) : null}
      {sub?.kind === "display" ? (
        <NumberDisplayMenu
          property={db.schema.properties.find((item) => item.id === property.id) ?? property}
          anchor={sub.anchor}
          onClose={() => setSub(null)}
          updateSchema={db.updateSchema}
          values={db.rows.map((row) => row.values[property.id])}
        />
      ) : null}
      {sub?.kind === "format" ? (
        <Popover anchor={sub.anchor} onClose={() => setSub(null)} placement="right-start" width={210} label="Number format">
          <div className="db-menu">
            {NUMBER_FORMATS.map((format) => (
              <button
                key={format.id}
                type="button"
                className="db-menu-item"
                onClick={() => {
                  setSub(null);
                  db.updateSchema((schema) => {
                    const target = schema.properties.find((p) => p.id === property.id);
                    if (target) target.format = format.id;
                  });
                }}
              >
                {format.name}
                {(property.format ?? "number") === format.id ? <Check size={14} className="db-menu-check" /> : null}
              </button>
            ))}
          </div>
        </Popover>
      ) : null}
    </Popover>
  );
}

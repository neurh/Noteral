import { Copy, Eye, EyeOff, GripVertical, Trash2 } from "lucide-react";
import { useState } from "react";
import {
  TITLE_ID,
  VIEW_TYPES,
  newView,
  orderedPropertyIds,
  propertyById,
  uid,
  type DatabaseView,
  type Property,
  type ViewType,
} from "../../lib/database";
import { PropertyIcon, ViewIcon } from "./parts";
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
    if (type === "board" && !view.groupBy) view.groupBy = fresh.groupBy;
    if (type === "calendar" && !view.dateProperty) view.dateProperty = fresh.dateProperty;
    if (type === "gallery" && !view.cardPreview) view.cardPreview = "cover";
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

function Select<T extends string>({ value, options, onChange, label }: { value: T | undefined; options: { id: T; name: string }[]; onChange: (value: T) => void; label: string }) {
  return (
    <select className="db-select" aria-label={label} value={value ?? ""} onChange={(event) => onChange(event.target.value as T)}>
      {value === undefined ? <option value="">None</option> : null}
      {options.map((option) => (
        <option key={option.id} value={option.id}>
          {option.name}
        </option>
      ))}
    </select>
  );
}

interface ViewSettingsProps {
  db: DatabaseApi;
  view: DatabaseView;
  anchor: HTMLElement;
  onClose: () => void;
  onSelectView: (viewId: string) => void;
}

export function ViewSettings({ db, view, anchor, onClose, onSelectView }: ViewSettingsProps) {
  const { schema } = db;
  const [name, setName] = useState(view.name);
  const [dragId, setDragId] = useState<string | null>(null);
  const [overId, setOverId] = useState<string | null>(null);
  const ids = orderedPropertyIds(schema, view);
  const properties = ids.map((id) => propertyById(schema, id)).filter((p): p is Property => !!p);
  const hidden = new Set(view.hidden);
  const groupable = schema.properties.filter((p) => p.type === "status" || p.type === "select" || p.type === "multiSelect" || p.type === "checkbox");
  const dated = schema.properties.filter((p) => p.type === "date" || p.type === "createdTime" || p.type === "lastEdited");

  const commitName = () => {
    const clean = name.trim();
    if (clean && clean !== view.name) updateView(db, view.id, (target) => { target.name = clean; });
  };

  return (
    <Popover anchor={anchor} onClose={() => { commitName(); onClose(); }} width={290} placement="bottom-end" label="View settings">
      <div className="db-menu db-settings">
        <div className="db-settings-name">
          <ViewIcon type={view.type} />
          <input
            className="db-input"
            value={name}
            aria-label="View name"
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
            onKeyDown={(event) => {
              if (event.key === "Enter") commitName();
            }}
          />
        </div>
        <div className="db-menu-label">Layout</div>
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
        {view.type === "board" ? (
          <label className="db-settings-row">
            <span>Group by</span>
            <Select
              label="Group by"
              value={view.groupBy}
              options={groupable.map((p) => ({ id: p.id, name: p.name }))}
              onChange={(value) => updateView(db, view.id, (target) => { target.groupBy = value; target.hiddenGroups = []; })}
            />
          </label>
        ) : null}
        {view.type === "calendar" ? (
          <label className="db-settings-row">
            <span>Show calendar by</span>
            <Select
              label="Calendar date property"
              value={view.dateProperty}
              options={dated.map((p) => ({ id: p.id, name: p.name }))}
              onChange={(value) => updateView(db, view.id, (target) => { target.dateProperty = value; })}
            />
          </label>
        ) : null}
        {view.type === "gallery" ? (
          <label className="db-settings-row">
            <span>Card preview</span>
            <Select
              label="Card preview"
              value={view.cardPreview ?? "cover"}
              options={[
                { id: "cover", name: "Page cover" },
                { id: "none", name: "None" },
              ]}
              onChange={(value) => updateView(db, view.id, (target) => { target.cardPreview = value as "cover" | "none"; })}
            />
          </label>
        ) : null}
        {view.type === "table" ? (
          <label className="db-settings-row">
            <span>Wrap cell content</span>
            <button
              type="button"
              role="switch"
              aria-checked={!!view.wrap}
              className={`db-switch ${view.wrap ? "is-on" : ""}`}
              onClick={() => updateView(db, view.id, (target) => { target.wrap = !target.wrap; })}
            >
              <span />
            </button>
          </label>
        ) : null}
        {view.type !== "calendar" ? (
          <>
            <div className="db-menu-label db-settings-props-head">
              <span>Properties</span>
              <button
                type="button"
                className="db-ghost"
                onClick={() =>
                  updateView(db, view.id, (target) => {
                    const anyShown = schema.properties.some((p) => !target.hidden.includes(p.id));
                    target.hidden = anyShown ? schema.properties.map((p) => p.id) : [];
                  })
                }
              >
                {schema.properties.some((p) => !hidden.has(p.id)) ? "Hide all" : "Show all"}
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
                    draggable={!isTitle}
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
                    <span className="db-grip" aria-hidden>{isTitle ? null : <GripVertical size={13} />}</span>
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
            </div>
          </>
        ) : null}
        <div className="db-menu-sep" />
        <button
          type="button"
          className="db-menu-item"
          onClick={() => {
            const id = duplicateView(db, view.id);
            onClose();
            onSelectView(id);
          }}
        >
          <Copy size={14} /> Duplicate view
        </button>
        {schema.views.length > 1 ? (
          <button
            type="button"
            className="db-menu-item danger"
            onClick={() => {
              const next = schema.views.find((item) => item.id !== view.id);
              onClose();
              deleteView(db, view.id);
              if (next) onSelectView(next.id);
            }}
          >
            <Trash2 size={14} /> Delete view
          </button>
        ) : null}
      </div>
    </Popover>
  );
}

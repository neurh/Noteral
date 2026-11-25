import { Code2 } from "lucide-react";
import { useMemo, useState } from "react";
import {
  DEFAULT_CUSTOM_VIEW,
  TITLE_ID,
  cellText,
  cellValue,
  dateStart,
  isComputed,
  optionById,
  propertyById,
  visiblePropertyIds,
  type DatabaseRow,
  type DatabaseView,
  type Property,
} from "../../lib/database";
import { APP_VIEW_PERMISSIONS, ViewFrame } from "../ViewFrame";
import { Modal } from "../Modal";
import { updateView } from "./ops";
import type { DatabaseApi } from "./useDatabase";

/** Most rows handed to a custom view (keeps messages small). */
const MAX_ROWS = 2000;

/**
 * Defines `noteral.database` inside the frame. Runs before the author's
 * markup so their scripts can use it straight away.
 */
const PRELUDE = `<script>(function(){
var N=window.noteral,L=[];
function data(){return (N.props&&N.props.database)||{schema:[],view:{},rows:[]};}
var D={
get schema(){return data().schema;},get view(){return data().view;},get rows(){return data().rows;},get name(){return data().name;},
onChange:function(f){L.push(f);try{f(data())}catch(e){console.error(e)}return function(){L=L.filter(function(x){return x!==f})}},
openRow:function(id){N.post("database:openRow",{id:String(id)});},
setValue:function(id,property,value){N.post("database:setValue",{id:String(id),property:String(property),value:value});},
setTitle:function(id,title){N.post("database:setValue",{id:String(id),property:"title",value:String(title)});},
addRow:function(values,title){N.post("database:addRow",{values:values||{},title:title||""});},
deleteRow:function(id){N.post("database:deleteRow",{id:String(id)});}
};
N.database=D;
N.onProps(function(){var d=data();for(var i=0;i<L.length;i++){try{L[i](d)}catch(e){console.error(e)}}});
})();</script>`;

function propertyKind(property: Property): string {
  return property.type === "formula" ? `formula:${property.resultType ?? "text"}` : property.type;
}

/** A row as the frame sees it: raw values and display text keyed by property name. */
function frameRow(row: DatabaseRow, properties: Property[]) {
  const values: Record<string, unknown> = {};
  const cells: Record<string, string> = {};
  for (const property of properties) {
    if (property.id === TITLE_ID) continue;
    const raw = cellValue(row, property);
    let value: unknown = raw;
    if (property.type === "select" || property.type === "status") value = optionById(property, raw)?.name ?? null;
    else if (property.type === "multiSelect") value = Array.isArray(raw) ? raw.map((id) => optionById(property, id)?.name).filter(Boolean) : [];
    else if (property.type === "date" || (property.type === "formula" && property.resultType === "date")) value = dateStart(raw) || null;
    else if (raw === undefined) value = null;
    values[property.name] = value;
    cells[property.name] = cellText(row, property);
  }
  return { id: row.id, title: row.meta.title, icon: row.meta.icon ?? "", values, cells };
}

/** Converts a value from a custom view into what the property stores. */
export function storedValue(property: Property, value: unknown): unknown {
  if (value === null || value === undefined || value === "") return undefined;
  switch (property.type) {
    case "number": {
      const number = Number(value);
      return Number.isFinite(number) ? number : undefined;
    }
    case "checkbox":
      return Boolean(value);
    case "select":
    case "status": {
      const text = String(value);
      const option = property.options?.find((item) => item.id === text || item.name.toLowerCase() === text.toLowerCase());
      return option?.id;
    }
    case "multiSelect": {
      const list = Array.isArray(value) ? value : String(value).split(",");
      const ids = list
        .map((item) => String(item).trim())
        .map((text) => property.options?.find((option) => option.id === text || option.name.toLowerCase() === text.toLowerCase())?.id)
        .filter(Boolean);
      return ids.length ? ids : undefined;
    }
    case "date": {
      if (typeof value === "object" && value && "start" in value) return value;
      return { start: String(value) };
    }
    default:
      return String(value);
  }
}

function findProperty(db: DatabaseApi, key: string): Property | undefined {
  const lower = key.toLowerCase();
  if (key === TITLE_ID || lower === db.schema.titleName?.toLowerCase()) return propertyById(db.schema, TITLE_ID);
  return db.schema.properties.find((item) => item.id === key || item.name.toLowerCase() === lower);
}

function writableValues(db: DatabaseApi, input: unknown): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  if (!input || typeof input !== "object") return values;
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    const property = findProperty(db, key);
    if (!property || property.id === TITLE_ID || isComputed(property.type)) continue;
    values[property.id] = storedValue(property, value);
  }
  return values;
}

/** A view whose whole body is HTML (often written by the assistant or a plugin). */
export function CustomView({ db, view, rows, inline }: { db: DatabaseApi; view: DatabaseView; rows: DatabaseRow[]; inline: boolean }) {
  const [editing, setEditing] = useState(false);
  const html = view.custom?.html || DEFAULT_CUSTOM_VIEW;
  const properties = useMemo(() => {
    const ids = visiblePropertyIds(db.schema, view);
    return ids.map((id) => propertyById(db.schema, id)).filter((item): item is Property => Boolean(item));
  }, [db.schema, view]);
  const props = useMemo(
    () => ({
      database: {
        id: db.meta?.id ?? "",
        name: db.meta?.title ?? "",
        view: { id: view.id, name: view.name, type: view.type },
        schema: properties.map((property) => ({
          id: property.id,
          name: property.name,
          type: propertyKind(property),
          options: property.options?.map((option) => ({ name: option.name, color: option.color })),
        })),
        rows: rows.slice(0, MAX_ROWS).map((row) => frameRow(row, properties)),
        total: rows.length,
      },
    }),
    [db.meta?.id, db.meta?.title, view.id, view.name, view.type, properties, rows],
  );
  const known = (id: unknown) => typeof id === "string" && db.rows.some((row) => row.id === id);
  const onAction = (name: string, payload: unknown) => {
    const data = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
    if (name === "database:openRow" && known(data.id)) db.openRow(String(data.id));
    else if (name === "database:setValue" && known(data.id)) {
      const property = findProperty(db, String(data.property ?? ""));
      if (!property) return;
      if (property.id === TITLE_ID) db.renameRow(String(data.id), String(data.value ?? ""));
      else if (!isComputed(property.type)) db.setValue(String(data.id), property.id, storedValue(property, data.value));
    } else if (name === "database:addRow") {
      void db.addRow(writableValues(db, data.values), typeof data.title === "string" ? data.title : undefined);
    } else if (name === "database:deleteRow" && known(data.id)) {
      void db.deleteRows([String(data.id)]);
    }
  };
  const height = view.custom?.height;
  return (
    <div className={`db-custom ${inline ? "is-inline" : ""}`} style={height ? { height } : undefined}>
      <ViewFrame
        viewKey={`db-custom:${db.meta?.id ?? ""}:${view.id}`}
        html={PRELUDE + html}
        owner={{ kind: "app", id: `database-${view.id}`, name: view.name || "Custom view" }}
        permissions={APP_VIEW_PERMISSIONS}
        props={props}
        surface="database"
        fill={!inline || Boolean(height)}
        minHeight={inline ? 120 : 0}
        maxHeight={inline ? 1600 : 4000}
        onAction={onAction}
        title={view.name || "Custom view"}
        className="db-custom-frame"
      />
      <button type="button" className="db-custom-edit" onClick={() => setEditing(true)} aria-label="Edit view code">
        <Code2 size={13} /> Edit code
      </button>
      {editing ? <CustomViewEditor db={db} view={view} onClose={() => setEditing(false)} /> : null}
    </div>
  );
}

/** Edits the HTML of a custom view. */
export function CustomViewEditor({ db, view, onClose }: { db: DatabaseApi; view: DatabaseView; onClose: () => void }) {
  const [draft, setDraft] = useState(view.custom?.html || DEFAULT_CUSTOM_VIEW);
  const [height, setHeight] = useState(view.custom?.height ? String(view.custom.height) : "");
  const save = () => {
    const parsed = Number(height);
    updateView(db, view.id, (target) => {
      target.custom = { html: draft, height: Number.isFinite(parsed) && parsed >= 120 ? Math.min(2400, Math.round(parsed)) : undefined };
    });
    onClose();
  };
  return (
    <Modal
      open
      title="Custom view code"
      subtitle="HTML, CSS and scripts. Use noteral.database for the rows; the assistant can write this for you."
      onClose={onClose}
      width="large"
      className="db-custom-editor"
      footer={
        <>
          <label className="db-custom-height">
            Inline height
            <input className="db-input" type="number" min={120} max={2400} placeholder="Auto" value={height} onChange={(event) => setHeight(event.target.value)} />
          </label>
          <button type="button" className="secondary-button" onClick={() => setDraft(DEFAULT_CUSTOM_VIEW)}>
            Reset to starter
          </button>
          <button type="button" className="secondary-button" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="primary-button" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <textarea
        className="db-code"
        spellCheck={false}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === "Tab") {
            event.preventDefault();
            const el = event.currentTarget;
            const { selectionStart: start, selectionEnd: end } = el;
            const next = draft.slice(0, start) + "  " + draft.slice(end);
            setDraft(next);
            requestAnimationFrame(() => el.setSelectionRange(start + 2, start + 2));
          } else if (event.key === "s" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            save();
          }
        }}
      />
      <details className="db-custom-help">
        <summary>noteral.database reference</summary>
        <pre>{`noteral.database.rows        // [{ id, title, icon, values: { [name]: raw }, cells: { [name]: text } }]
noteral.database.schema      // [{ id, name, type, options? }]
noteral.database.onChange(fn)          // called now and whenever rows change
noteral.database.openRow(id)
noteral.database.setValue(id, "Status", "Done")
noteral.database.setTitle(id, "New title")
noteral.database.addRow({ Status: "Todo" }, "Title")
noteral.database.deleteRow(id)
Kit classes: n-list, n-item, n-card, n-grid, n-row, n-col, n-chip, n-btn, n-muted, n-faint`}</pre>
      </details>
    </Modal>
  );
}

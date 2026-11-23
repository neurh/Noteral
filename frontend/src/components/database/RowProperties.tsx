import { ChevronRight, Plus, Table2 } from "lucide-react";
import { useState } from "react";
import { useAppStore } from "../../store";
import { cellValue, dateStart, isEmptyValue, type DatabaseRow, type Property } from "../../lib/database";
import { PageIcon } from "../PageIcon";
import { CellDisplay, CellEditor, isEditable } from "./CellValue";
import { PropertyIcon } from "./parts";
import { Popover } from "./Popover";
import { PropertyMenu, TypeList } from "./PropertyMenu";
import { addProperty } from "./ops";
import { useDatabase } from "./useDatabase";

interface RowPropertiesProps {
  databaseId: string;
  rowId: string;
}

/** The property panel shown under the title of a page that lives in a database. */
export function RowProperties({ databaseId, rowId }: RowPropertiesProps) {
  const db = useDatabase(databaseId);
  const selectPage = useAppStore((state) => state.selectPage);
  const [editing, setEditing] = useState<{ id: string; anchor: HTMLElement } | null>(null);
  const [menu, setMenu] = useState<{ property: Property; anchor: HTMLElement } | null>(null);
  const [adding, setAdding] = useState<HTMLElement | null>(null);
  const row: DatabaseRow | undefined = db.rows.find((item) => item.id === rowId);
  if (!db.meta || !row) return null;

  const editingProperty = editing ? db.schema.properties.find((p) => p.id === editing.id) : undefined;

  return (
    <section className="db-rowprops" aria-label="Properties">
      <button type="button" className="db-rowprops-source" onClick={() => void selectPage(databaseId)}>
        <PageIcon value={db.meta.icon} size={13} fallback={<Table2 size={13} />} />
        <span>{db.meta.title || "Untitled"}</span>
        <ChevronRight size={12} />
      </button>
      {db.schema.properties.map((property) => {
        const value = cellValue(row, property);
        const empty = property.type !== "checkbox" && isEmptyValue(property.type === "date" ? dateStart(value) : value);
        const editable = isEditable(property);
        return (
          <div key={property.id} className="db-rowprop">
            <button type="button" className="db-rowprop-name" onClick={(event) => setMenu({ property, anchor: event.currentTarget })}>
              <PropertyIcon property={property} />
              <span>{property.name}</span>
            </button>
            <div
              className={`db-rowprop-value type-${property.type} ${editable ? "is-editable" : ""} ${editing?.id === property.id ? "is-editing" : ""}`}
              role={editable ? "button" : undefined}
              tabIndex={editable ? 0 : undefined}
              onClick={(event) => {
                if (!editable) return;
                if ((event.target as HTMLElement).closest("a")) return;
                if (property.type === "checkbox") {
                  db.setValue(row.id, property.id, !value);
                  return;
                }
                setEditing({ id: property.id, anchor: event.currentTarget });
              }}
              onKeyDown={(event) => {
                if (!editable || (event.key !== "Enter" && event.key !== " ")) return;
                event.preventDefault();
                if (property.type === "checkbox") db.setValue(row.id, property.id, !value);
                else setEditing({ id: property.id, anchor: event.currentTarget });
              }}
            >
              {empty ? <span className="db-rowprop-empty">Empty</span> : <CellDisplay property={property} row={row} />}
            </div>
          </div>
        );
      })}
      <button type="button" className="db-ghost db-rowprops-add" onClick={(event) => setAdding(event.currentTarget)}>
        <Plus size={14} /> Add a property
      </button>
      {editing && editingProperty ? (
        <CellEditor property={editingProperty} row={row} db={db} anchor={editing.anchor} onClose={() => setEditing(null)} />
      ) : null}
      {menu ? <PropertyMenu db={db} property={db.schema.properties.find((p) => p.id === menu.property.id) ?? menu.property} anchor={menu.anchor} onClose={() => setMenu(null)} /> : null}
      {adding ? (
        <Popover anchor={adding} onClose={() => setAdding(null)} width={230} label="Add a property">
          <TypeList
            onPick={(type) => {
              const anchor = adding;
              setAdding(null);
              const property = addProperty(db, type);
              setMenu({ property, anchor });
            }}
          />
        </Popover>
      ) : null}
    </section>
  );
}

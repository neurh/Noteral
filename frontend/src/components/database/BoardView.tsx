import { EyeOff, MoreHorizontal, Plus } from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import {
  NO_GROUP,
  groupRows,
  propertyById,
  type BoardGroup,
  type DatabaseRow,
  type DatabaseView,
  type Property,
  type RowValues,
} from "../../lib/database";
import { RowCard } from "./Cards";
import { OptionChip } from "./parts";
import { Popover } from "./Popover";
import { OptionEditor } from "./OptionPicker";
import { updateView } from "./ops";
import type { DatabaseApi } from "./useDatabase";

interface BoardViewProps {
  db: DatabaseApi;
  view: DatabaseView;
  rows: DatabaseRow[];
  onAddRow: (values?: RowValues) => void;
  editTitleFor: string | null;
  clearEditTitle: () => void;
  onOpenSettings: (anchor: HTMLElement) => void;
}

function valueForGroup(property: Property, group: BoardGroup, current: unknown, fromGroup?: string): unknown {
  if (property.type === "checkbox") return group.id === "true";
  if (group.id === NO_GROUP) return property.type === "multiSelect" ? [] : undefined;
  if (property.type === "multiSelect") {
    const list = Array.isArray(current) ? (current as string[]).filter((id) => id !== fromGroup) : [];
    return list.includes(group.id) ? list : [...list, group.id];
  }
  return group.id;
}

export function BoardView({ db, view, rows, onAddRow, editTitleFor, clearEditTitle, onOpenSettings }: BoardViewProps) {
  const property = view.groupBy ? propertyById(db.schema, view.groupBy) : undefined;
  const groups = useMemo(() => groupRows(rows, property), [rows, property]);
  const hidden = new Set(view.hiddenGroups ?? []);
  const [drag, setDrag] = useState<{ rowId: string; from: string } | null>(null);
  const [over, setOver] = useState<{ group: string; before: string } | null>(null);
  const [groupMenu, setGroupMenu] = useState<{ group: BoardGroup; anchor: HTMLElement } | null>(null);
  const [optionEdit, setOptionEdit] = useState<{ group: BoardGroup; anchor: HTMLElement } | null>(null);
  const canReorder = view.sorts.length === 0;

  if (!property) {
    return (
      <div className="db-empty-state">
        <p>Board views group pages by a Select, Status or Checkbox property.</p>
        <button type="button" className="secondary-button" onClick={(event) => onOpenSettings(event.currentTarget)}>
          Choose a property to group by
        </button>
      </div>
    );
  }

  const visibleGroups = groups.filter((group) => !hidden.has(group.id) && !(group.id === NO_GROUP && !group.rows.length && property.type !== "checkbox"));
  const hiddenGroups = groups.filter((group) => hidden.has(group.id));

  function drop(event: DragEvent, group: BoardGroup) {
    event.preventDefault();
    const state = drag;
    const target = over;
    setDrag(null);
    setOver(null);
    if (!state || !property) return;
    const row = db.rows.find((r) => r.id === state.rowId);
    if (!row) return;
    if (state.from !== group.id) {
      db.setValue(row.id, property.id, valueForGroup(property, group, row.values[property.id], state.from));
    }
    if (canReorder && target && target.group === group.id && target.before !== row.id) {
      void db.moveRow(row.id, target.before);
    }
  }

  return (
    <div className="db-board">
      {visibleGroups.map((group) => (
        <section
          key={group.id}
          className={`db-board-col ${over?.group === group.id ? "is-over" : ""}`}
          aria-label={group.name}
          onDragOver={(event) => {
            if (!drag) return;
            event.preventDefault();
            // Find the card under the pointer to drop before it.
            const cards = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-row-id]")];
            const next = cards.find((card) => {
              const rect = card.getBoundingClientRect();
              return event.clientY < rect.top + rect.height / 2;
            });
            const before = next?.dataset.rowId ?? "";
            if (over?.group !== group.id || over.before !== before) setOver({ group: group.id, before });
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver((current) => (current?.group === group.id ? null : current));
          }}
          onDrop={(event) => drop(event, group)}
        >
          <header className="db-board-head">
            {group.option ? (
              <OptionChip option={group.option} status={property.type === "status"} />
            ) : (
              <span className={`db-board-none ${property.type === "checkbox" ? "" : "is-muted"}`}>{group.name}</span>
            )}
            <span className="db-board-count">{group.rows.length}</span>
            <span className="db-board-head-actions">
              <button type="button" className="icon-button tiny" aria-label={`${group.name} options`} onClick={(event) => setGroupMenu({ group, anchor: event.currentTarget })}>
                <MoreHorizontal size={14} />
              </button>
              <button
                type="button"
                className="icon-button tiny"
                aria-label={`Add a page to ${group.name}`}
                onClick={() => onAddRow({ [property.id]: valueForGroup(property, group, undefined) })}
              >
                <Plus size={14} />
              </button>
            </span>
          </header>
          <div className="db-board-cards">
            {group.rows.map((row) => (
              <div key={row.id} className="db-card-slot">
                {over?.group === group.id && over.before === row.id && drag?.rowId !== row.id ? <div className="db-drop-line" /> : null}
                <RowCard
                  db={db}
                  view={view}
                  row={row}
                  hideProperty={property.id}
                  editingTitle={editTitleFor === row.id}
                  onTitleDone={clearEditTitle}
                  dragging={drag?.rowId === row.id}
                  onDragStart={() => setDrag({ rowId: row.id, from: group.id })}
                  onDragEnd={() => {
                    setDrag(null);
                    setOver(null);
                  }}
                />
              </div>
            ))}
            {over?.group === group.id && over.before === "" && drag ? <div className="db-drop-line" /> : null}
            <button type="button" className="db-board-new" onClick={() => onAddRow({ [property.id]: valueForGroup(property, group, undefined) })}>
              <Plus size={14} /> New page
            </button>
          </div>
        </section>
      ))}
      {hiddenGroups.length ? (
        <section className="db-board-hidden" aria-label="Hidden groups">
          <div className="db-menu-label">Hidden groups</div>
          {hiddenGroups.map((group) => (
            <button
              key={group.id}
              type="button"
              className="db-board-hidden-item"
              onClick={() => updateView(db, view.id, (target) => { target.hiddenGroups = (target.hiddenGroups ?? []).filter((id) => id !== group.id); })}
              title="Show group"
            >
              {group.option ? <OptionChip option={group.option} status={property.type === "status"} /> : <span>{group.name}</span>}
              <span className="db-board-count">{group.rows.length}</span>
            </button>
          ))}
        </section>
      ) : null}
      {groupMenu ? (
        <Popover anchor={groupMenu.anchor} onClose={() => setGroupMenu(null)} width={200} label="Group options">
          <div className="db-menu">
            <button
              type="button"
              className="db-menu-item"
              onClick={() => {
                const id = groupMenu.group.id;
                setGroupMenu(null);
                updateView(db, view.id, (target) => { target.hiddenGroups = [...new Set([...(target.hiddenGroups ?? []), id])]; });
              }}
            >
              <EyeOff size={14} /> Hide group
            </button>
            {groupMenu.group.option ? (
              <button
                type="button"
                className="db-menu-item"
                onClick={() => {
                  setOptionEdit({ group: groupMenu.group, anchor: groupMenu.anchor });
                  setGroupMenu(null);
                }}
              >
                <MoreHorizontal size={14} /> Edit option
              </button>
            ) : null}
          </div>
        </Popover>
      ) : null}
      {optionEdit?.group.option ? (
        <OptionEditor
          anchor={optionEdit.anchor}
          property={property}
          option={property.options?.find((o) => o.id === optionEdit.group.id) ?? optionEdit.group.option}
          updateSchema={db.updateSchema}
          onClose={() => setOptionEdit(null)}
        />
      ) : null}
    </div>
  );
}

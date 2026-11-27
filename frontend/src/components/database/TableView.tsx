import { ArrowUpRight, Check, ChevronDown, Copy, FileText, GripVertical, Plus, Trash2, X } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type DragEvent, type PointerEvent as ReactPointerEvent } from "react";
import {
  TITLE_ID,
  calcsFor,
  cellValue,
  computeCalc,
  propertyById,
  visiblePropertyIds,
  type CalcKind,
  type DatabaseRow,
  type DatabaseView,
  type Property,
  type PropertyType,
} from "../../lib/database";
import { PageIcon } from "../PageIcon";
import { CellDisplay, CellEditor, isEditable } from "./CellValue";
import { FormulaEditor } from "./FormulaEditor";
import { PropertyIcon } from "./parts";
import { Popover } from "./Popover";
import { PropertyMenu, TypeList } from "./PropertyMenu";
import { autofitColumn } from "./autofit";
import { consumeDragClick, startReorder } from "./dragReorder";
import { addProperty, movePropertyInView, updateView } from "./ops";
import type { DatabaseApi } from "./useDatabase";

const MIN_WIDTH = 72;

function defaultWidth(property: Property): number {
  if (property.id === TITLE_ID) return 280;
  switch (property.type) {
    case "checkbox":
      return 96;
    case "number":
      return 130;
    case "date":
    case "createdTime":
    case "lastEdited":
      return 170;
    case "multiSelect":
      return 220;
    default:
      return 190;
  }
}

interface TableViewProps {
  db: DatabaseApi;
  view: DatabaseView;
  rows: DatabaseRow[];
  onAddRow: () => void;
  /** Row whose title should open for editing (a row just created). */
  editTitleFor: string | null;
  clearEditTitle: () => void;
  onFilter: (ruleId: string) => void;
}

interface CellRef {
  rowId: string;
  propertyId: string;
}

export function TableView({ db, view, rows, onAddRow, editTitleFor, clearEditTitle, onFilter }: TableViewProps) {
  const { schema } = db;
  const columns = useMemo(
    () => visiblePropertyIds(schema, view).map((id) => propertyById(schema, id)).filter((p): p is Property => !!p),
    [schema, view],
  );
  const [editing, setEditing] = useState<CellRef | null>(null);
  const [formulaCell, setFormulaCell] = useState<{ rowId: string; propertyId: string } | null>(null);
  const [menu, setMenu] = useState<{ propertyId: string; anchor: HTMLElement } | null>(null);
  const [pendingMenu, setPendingMenu] = useState<string | null>(null);
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  const [insertAt, setInsertAt] = useState<{ beside: string; side: "left" | "right"; anchor: HTMLElement } | null>(null);
  const [calcMenu, setCalcMenu] = useState<{ property: Property; anchor: HTMLElement } | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [widths, setWidths] = useState<Record<string, number>>({});
  const [dragRow, setDragRow] = useState<string | null>(null);
  const [dropRow, setDropRow] = useState<{ id: string; side: "above" | "below" } | null>(null);
  const cells = useRef(new Map<string, HTMLElement>());
  const headers = useRef(new Map<string, HTMLElement>());
  const resize = useRef<{ id: string; startX: number; startWidth: number } | null>(null);
  const canReorderRows = view.sorts.length === 0;

  const widthOf = (property: Property) => widths[property.id] ?? view.widths[property.id] ?? defaultWidth(property);
  const template = `34px ${columns.map((p) => `${widthOf(p)}px`).join(" ")} 40px minmax(40px, 1fr)`;

  // Drop selection for rows that left the view.
  useEffect(() => {
    setSelected((current) => {
      const visible = new Set(rows.map((r) => r.id));
      const next = new Set([...current].filter((id) => visible.has(id)));
      return next.size === current.size ? current : next;
    });
  }, [rows]);

  useEffect(() => {
    if (!editTitleFor) return;
    if (rows.some((r) => r.id === editTitleFor)) {
      setEditing({ rowId: editTitleFor, propertyId: TITLE_ID });
      clearEditTitle();
    }
  }, [editTitleFor, rows, clearEditTitle]);

  // A property added from the header opens its menu once its column exists.
  useLayoutEffect(() => {
    if (!pendingMenu) return;
    const anchor = headers.current.get(pendingMenu);
    if (anchor) {
      setMenu({ propertyId: pendingMenu, anchor });
      setPendingMenu(null);
    }
  });

  const editingAnchor = editing ? cells.current.get(`${editing.rowId}:${editing.propertyId}`) : undefined;
  const editingRow = editing ? rows.find((r) => r.id === editing.rowId) : undefined;
  const editingProperty = editing ? columns.find((p) => p.id === editing.propertyId) : undefined;
  const formulaProperty = formulaCell ? schema.properties.find((p) => p.id === formulaCell.propertyId) : undefined;

  function navigate(from: CellRef, direction: "next" | "prev" | "down") {
    const rowIndex = rows.findIndex((r) => r.id === from.rowId);
    const colIndex = columns.findIndex((p) => p.id === from.propertyId);
    if (rowIndex < 0 || colIndex < 0) return;
    if (direction === "down") {
      const next = rows[rowIndex + 1];
      if (next) setEditing({ rowId: next.id, propertyId: from.propertyId });
      return;
    }
    const step = direction === "next" ? 1 : -1;
    let r = rowIndex;
    let c = colIndex + step;
    while (r >= 0 && r < rows.length) {
      while (c >= 0 && c < columns.length) {
        const property = columns[c];
        if (isEditable(property) && property.type !== "checkbox") {
          setEditing({ rowId: rows[r].id, propertyId: property.id });
          return;
        }
        c += step;
      }
      r += step;
      c = step > 0 ? 0 : columns.length - 1;
    }
  }

  function startResize(event: ReactPointerEvent<HTMLDivElement>, property: Property) {
    event.preventDefault();
    event.stopPropagation();
    resize.current = { id: property.id, startX: event.clientX, startWidth: widthOf(property) };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = resize.current;
    if (!state) return;
    const width = Math.max(MIN_WIDTH, Math.round(state.startWidth + event.clientX - state.startX));
    setWidths((current) => ({ ...current, [state.id]: width }));
  }

  function endResize(event: ReactPointerEvent<HTMLDivElement>) {
    const state = resize.current;
    if (!state) return;
    resize.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    const width = widths[state.id];
    if (width) {
      updateView(db, view.id, (target) => {
        target.widths = { ...target.widths, [state.id]: width };
      });
    }
    setWidths((current) => {
      const next = { ...current };
      delete next[state.id];
      return next;
    });
  }

  /** Double-click on a resize handle: fit the column to its header and visible cells. */
  function autoFit(property: Property) {
    const header = headers.current.get(property.id);
    if (!header) return;
    const suffix = `:${property.id}`;
    const columnCells: HTMLElement[] = [];
    for (const [key, node] of cells.current) if (key.endsWith(suffix) && node.isConnected) columnCells.push(node);
    const width = autofitColumn(header, columnCells, { min: MIN_WIDTH });
    if (!width || width === widthOf(property)) return;
    updateView(db, view.id, (target) => {
      target.widths = { ...target.widths, [property.id]: width };
    });
  }

  function onCellClick(row: DatabaseRow, property: Property, element: HTMLElement) {
    if (property.type === "formula") {
      // Locked databases keep their formulas; the cell just shows its value.
      if (!db.locked) setFormulaCell({ rowId: row.id, propertyId: property.id });
      return;
    }
    if (!isEditable(property)) return;
    if (property.type === "checkbox") {
      db.setValue(row.id, property.id, !cellValue(row, property));
      return;
    }
    cells.current.set(`${row.id}:${property.id}`, element);
    setEditing({ rowId: row.id, propertyId: property.id });
  }

  /**
   * Columns reorder with the pointer, not native drag and drop: inside the
   * editor a native drag also drives the editor's own drop cursor.
   */
  function onHeaderDrop(source: string, targetId: string, after: boolean) {
    if (source === targetId) return;
    const ids = columns.map((p) => p.id);
    const index = ids.indexOf(targetId);
    const before = after ? ids[index + 1] ?? "" : targetId;
    if (before === source) return;
    // Hidden properties keep their relative spot; aim at the next visible one.
    movePropertyInView(db, view.id, source, before);
  }

  function onRowDrop(event: DragEvent) {
    event.preventDefault();
    const target = dropRow;
    const source = dragRow;
    setDragRow(null);
    setDropRow(null);
    if (!source || !target || source === target.id) return;
    const index = db.rows.findIndex((r) => r.id === target.id);
    const before = target.side === "above" ? target.id : db.rows[index + 1]?.id ?? "";
    if (before === source) return;
    void db.moveRow(source, before);
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const calcs = view.calcs ?? {};
  const hasCalcs = Object.values(calcs).some((kind) => kind && kind !== "none");

  return (
    <div className={`db-table ${view.wrap ? "is-wrap" : ""}`} role="grid" aria-rowcount={rows.length + 1}>
      {formulaCell && formulaProperty && !db.locked ? (
        <FormulaEditor db={db} property={formulaProperty} previewRowId={formulaCell.rowId} onClose={() => setFormulaCell(null)} />
      ) : null}
      {selected.size ? (
        <div className="db-selection-bar" role="toolbar" aria-label="Selected rows">
          <span className="db-selection-count">{selected.size} selected</span>
          <button
            type="button"
            className="db-ghost"
            onClick={() => {
              for (const id of selected) void db.duplicateRow(id);
              setSelected(new Set());
            }}
          >
            <Copy size={13} /> Duplicate
          </button>
          <button
            type="button"
            className="db-ghost danger"
            onClick={() => {
              const ids = [...selected];
              setSelected(new Set());
              void db.deleteRows(ids);
            }}
          >
            <Trash2 size={13} /> Delete
          </button>
          <button type="button" className="icon-button tiny" aria-label="Clear selection" onClick={() => setSelected(new Set())}>
            <X size={13} />
          </button>
        </div>
      ) : null}
      <div className="db-table-scroll">
        <div className="db-table-inner" style={{ "--db-cols": template } as CSSProperties}>
          <div className="db-tr db-thead" role="row">
            <div className="db-th db-gutter" role="columnheader">
              {rows.length ? (
                <button
                  type="button"
                  className={`db-row-check ${allSelected ? "is-checked" : ""} ${selected.size ? "is-visible" : ""}`}
                  aria-label={allSelected ? "Deselect all rows" : "Select all rows"}
                  onClick={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))}
                >
                  {allSelected ? <Check size={11} strokeWidth={3} /> : null}
                </button>
              ) : null}
            </div>
            {columns.map((property) => (
              <div
                key={property.id}
                ref={(node) => {
                  if (node) headers.current.set(property.id, node);
                  else headers.current.delete(property.id);
                }}
                className="db-th"
                role="columnheader"
                data-reorder-id={db.locked ? undefined : property.id}
                onPointerDown={
                  db.locked
                    ? undefined
                    : (event) => {
                        const container = event.currentTarget.parentElement;
                        if (container) startReorder(event, { axis: "x", container, id: property.id, onDrop: onHeaderDrop });
                      }
                }
              >
                <button
                  type="button"
                  className="db-th-button"
                  onClick={(event) => {
                    if (consumeDragClick()) return;
                    setMenu({ propertyId: property.id, anchor: event.currentTarget.parentElement as HTMLElement });
                  }}
                >
                  <PropertyIcon property={property} />
                  <span className="db-th-name">{property.name || "Untitled"}</span>
                </button>
                {db.locked ? null : (
                <div
                  className="db-resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label={`Resize ${property.name}`}
                  onPointerDown={(event) => startResize(event, property)}
                  onPointerMove={moveResize}
                  onPointerUp={endResize}
                  onPointerCancel={endResize}
                  onDoubleClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    autoFit(property);
                  }}
                />
                )}
              </div>
            ))}
            <div className="db-th db-th-add" role="columnheader">
              {db.locked ? null : (
                <button type="button" className="icon-button tiny" aria-label="Add a property" onClick={(event) => setAddAnchor(event.currentTarget)}>
                  <Plus size={14} />
                </button>
              )}
            </div>
            <div className="db-th db-th-fill" aria-hidden />
          </div>

          {rows.map((row, index) => (
            <div
              key={row.id}
              className={`db-tr ${selected.has(row.id) ? "is-selected" : ""} ${dragRow === row.id ? "is-dragging" : ""} ${dropRow?.id === row.id ? `drop-${dropRow.side}` : ""}`}
              role="row"
              onDragOver={(event) => {
                if (!dragRow) return;
                event.preventDefault();
                const rect = event.currentTarget.getBoundingClientRect();
                const side = event.clientY < rect.top + rect.height / 2 ? "above" : "below";
                if (dropRow?.id !== row.id || dropRow.side !== side) setDropRow({ id: row.id, side });
              }}
              onDrop={onRowDrop}
            >
              <div className="db-td db-gutter" role="gridcell">
                {view.rowNumbers ? <span className="db-row-num" aria-hidden>{index + 1}</span> : null}
                <span
                  className={`db-row-handle ${canReorderRows ? "" : "is-disabled"}`}
                  draggable={canReorderRows}
                  title={canReorderRows ? "Drag to move" : "Remove sorts to reorder rows"}
                  onDragStart={(event) => {
                    setDragRow(row.id);
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("application/x-noteral-row", row.id);
                  }}
                  onDragEnd={() => {
                    setDragRow(null);
                    setDropRow(null);
                  }}
                >
                  <GripVertical size={14} />
                </span>
                <button
                  type="button"
                  className={`db-row-check ${selected.has(row.id) ? "is-checked" : ""} ${selected.size ? "is-visible" : ""}`}
                  aria-label={selected.has(row.id) ? "Deselect row" : "Select row"}
                  onClick={() =>
                    setSelected((current) => {
                      const next = new Set(current);
                      if (next.has(row.id)) next.delete(row.id);
                      else next.add(row.id);
                      return next;
                    })
                  }
                >
                  {selected.has(row.id) ? <Check size={11} strokeWidth={3} /> : null}
                </button>
              </div>
              {columns.map((property) => {
                const key = `${row.id}:${property.id}`;
                const isTitle = property.id === TITLE_ID;
                const isActive = editing?.rowId === row.id && editing.propertyId === property.id;
                return (
                  <div
                    key={property.id}
                    ref={(node) => {
                      if (node) cells.current.set(key, node);
                      else cells.current.delete(key);
                    }}
                    className={`db-td type-${property.type} ${isTitle ? "is-title" : ""} ${isActive ? "is-editing" : ""} ${isEditable(property) ? "" : "is-readonly"} ${property.type === "formula" && !db.locked ? "is-formula-cell" : ""}`}
                    role="gridcell"
                    tabIndex={property.type === "checkbox" ? 0 : -1}
                    onClick={(event) => onCellClick(row, property, event.currentTarget)}
                    onKeyDown={
                      property.type === "checkbox"
                        ? (event) => {
                            if (event.key !== " " && event.key !== "Enter") return;
                            event.preventDefault();
                            onCellClick(row, property, event.currentTarget);
                          }
                        : undefined
                    }
                  >
                    {isTitle ? (
                      <>
                        {row.meta.icon ? (
                          <span className="db-title-icon"><PageIcon value={row.meta.icon} size={15} fallback={<FileText size={15} />} /></span>
                        ) : null}
                        <span className="db-title-text">{row.meta.title || "Untitled"}</span>
                        <button
                          type="button"
                          className="db-open-row"
                          onClick={(event) => {
                            event.stopPropagation();
                            db.openRow(row.id);
                          }}
                        >
                          <ArrowUpRight size={13} /> Open
                        </button>
                      </>
                    ) : (
                      <CellDisplay property={property} row={row} db={db} onEdit={(anchor) => onCellClick(row, property, cells.current.get(key) ?? anchor)} />
                    )}
                  </div>
                );
              })}
              <div className="db-td db-td-add" aria-hidden />
              <div className="db-td db-td-fill" aria-hidden />
            </div>
          ))}

          <div className="db-tr db-tnew">
            <button type="button" className="db-new-row" onClick={onAddRow}>
              <Plus size={14} /> New page
            </button>
          </div>

          <div className={`db-tr db-tcalc ${hasCalcs ? "has-calcs" : ""}`}>
            <div className="db-td db-gutter" aria-hidden />
            {columns.map((property) => {
              const kind = calcs[property.id] ?? "none";
              const result = kind !== "none" ? computeCalc(rows, property, kind) : "";
              const label = calcsFor(property).find((item) => item.kind === kind)?.short ?? "";
              return (
                <button
                  key={property.id}
                  type="button"
                  className={`db-td db-calc ${kind !== "none" ? "is-set" : ""}`}
                  onClick={(event) => setCalcMenu({ property, anchor: event.currentTarget })}
                >
                  {kind !== "none" ? (
                    <>
                      <span className="db-calc-label">{label}</span>
                      <span className="db-calc-value">{result || "—"}</span>
                    </>
                  ) : (
                    <span className="db-calc-hint">Calculate <ChevronDown size={12} /></span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {editing && editingAnchor && editingRow && editingProperty ? (
        <CellEditor
          key={`${editing.rowId}:${editing.propertyId}`}
          property={editingProperty}
          row={editingRow}
          db={db}
          anchor={editingAnchor}
          onClose={() => setEditing((current) => (current === editing ? null : current))}
          onNavigate={(direction) => navigate(editing, direction)}
        />
      ) : null}

      {menu ? (
        (() => {
          const property = propertyById(schema, menu.propertyId);
          if (!property) return null;
          return (
            <PropertyMenu
              key={menu.propertyId}
              db={db}
              property={property}
              anchor={menu.anchor}
              view={view}
              onClose={() => setMenu(null)}
              onFilter={onFilter}
              onInsert={(side) => setInsertAt({ beside: property.id, side, anchor: menu.anchor })}
            />
          );
        })()
      ) : null}

      {addAnchor || insertAt ? (
        <Popover
          anchor={insertAt?.anchor ?? addAnchor}
          onClose={() => {
            setAddAnchor(null);
            setInsertAt(null);
          }}
          placement={insertAt ? "bottom-start" : "bottom-end"}
          width={240}
          label="New property"
        >
          <TypeList
            title="Select type"
            onPick={(type: PropertyType, customType?: string) => {
              const beside = insertAt?.beside === TITLE_ID ? schema.properties[0]?.id : insertAt?.beside;
              const side = insertAt?.beside === TITLE_ID ? "left" : insertAt?.side;
              const property = addProperty(db, type, { viewId: view.id, beside, side, customType });
              setAddAnchor(null);
              setInsertAt(null);
              setPendingMenu(property.id);
            }}
          />
        </Popover>
      ) : null}

      {calcMenu ? (
        <Popover anchor={calcMenu.anchor} onClose={() => setCalcMenu(null)} width={200} label="Calculate">
          <div className="db-menu db-menu-scroll">
            {calcsFor(calcMenu.property).map((item) => (
              <Fragment key={item.kind}>
                <button
                  type="button"
                  className="db-menu-item"
                  onClick={() => {
                    const propertyId = calcMenu.property.id;
                    setCalcMenu(null);
                    updateView(db, view.id, (target) => {
                      const next: Record<string, CalcKind> = { ...(target.calcs ?? {}) };
                      if (item.kind === "none") delete next[propertyId];
                      else next[propertyId] = item.kind;
                      target.calcs = next;
                    });
                  }}
                >
                  {item.name}
                  {(calcs[calcMenu.property.id] ?? "none") === item.kind ? <Check size={14} className="db-menu-check" /> : null}
                </button>
                {item.kind === "countAll" ? <div className="db-menu-sep" /> : null}
              </Fragment>
            ))}
          </div>
        </Popover>
      ) : null}
    </div>
  );
}

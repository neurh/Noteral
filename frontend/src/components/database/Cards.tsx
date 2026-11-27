import { ArrowUpRight, Copy, FileText, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { coverStyle } from "../../lib/covers";
import {
  TITLE_ID,
  cellValue,
  isEmptyValue,
  dateStart,
  propertyById,
  visiblePropertyIds,
  type DatabaseRow,
  type DatabaseView,
  type Property,
} from "../../lib/database";
import { PageIcon } from "../PageIcon";
import { CheckboxToggle } from "./CellMarks";
import { CellDisplay } from "./CellValue";
import { Popover } from "./Popover";
import type { DatabaseApi } from "./useDatabase";

function shownProperties(db: DatabaseApi, view: DatabaseView, row: DatabaseRow, hide?: string): Property[] {
  return visiblePropertyIds(db.schema, view)
    .filter((id) => id !== TITLE_ID && id !== hide)
    .map((id) => propertyById(db.schema, id))
    .filter((p): p is Property => {
      if (!p) return false;
      const value = cellValue(row, p);
      if (p.type === "checkbox") return true;
      return !isEmptyValue(p.type === "date" ? dateStart(value) : value);
    });
}

function TitleInput({ db, row, onDone }: { db: DatabaseApi; row: DatabaseRow; onDone: () => void }) {
  const [text, setText] = useState(row.meta.title === "Untitled" ? "" : row.meta.title);
  const done = useRef(false);
  const commit = () => {
    if (done.current) return;
    done.current = true;
    const clean = text.trim() || "Untitled";
    if (clean !== row.meta.title) db.renameRow(row.id, clean);
    onDone();
  };
  return (
    <input
      className="db-card-title-input"
      value={text}
      autoFocus
      placeholder="Untitled"
      aria-label="Page name"
      onClick={(event) => event.stopPropagation()}
      onChange={(event) => setText(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") commit();
        if (event.key === "Escape") {
          done.current = true;
          onDone();
        }
      }}
    />
  );
}

export function RowActions({ db, row, anchor, onClose, onRename }: { db: DatabaseApi; row: DatabaseRow; anchor: HTMLElement; onClose: () => void; onRename: () => void }) {
  return (
    <Popover anchor={anchor} onClose={onClose} width={190} label="Page actions">
      <div className="db-menu">
        <button type="button" className="db-menu-item" onClick={() => { onClose(); db.openRow(row.id); }}>
          <ArrowUpRight size={14} /> Open
        </button>
        <button type="button" className="db-menu-item" onClick={() => { onClose(); onRename(); }}>
          <Pencil size={14} /> Rename
        </button>
        <button type="button" className="db-menu-item" onClick={() => { onClose(); void db.duplicateRow(row.id); }}>
          <Copy size={14} /> Duplicate
        </button>
        <div className="db-menu-sep" />
        <button type="button" className="db-menu-item danger" onClick={() => { onClose(); void db.deleteRows([row.id]); }}>
          <Trash2 size={14} /> Delete
        </button>
      </div>
    </Popover>
  );
}

interface RowCardProps {
  db: DatabaseApi;
  view: DatabaseView;
  row: DatabaseRow;
  hideProperty?: string;
  editingTitle?: boolean;
  onTitleDone?: () => void;
  dragging?: boolean;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  preview?: boolean;
}

/** A page card for board and gallery layouts. */
export function RowCard({ db, view, row, hideProperty, editingTitle, onTitleDone, dragging, onDragStart, onDragEnd, preview }: RowCardProps) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const editing = renaming || !!editingTitle;
  const properties = shownProperties(db, view, row, hideProperty);
  const cover = preview ? coverStyle(row.meta.cover) : undefined;
  return (
    <article
      className={`db-card ${dragging ? "is-dragging" : ""} ${preview ? "has-preview" : ""}`}
      data-row-id={row.id}
      draggable={!!onDragStart && !editing}
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("application/x-noteral-row", row.id);
        onDragStart?.();
      }}
      onDragEnd={onDragEnd}
      onClick={() => {
        if (!editing) db.openRow(row.id);
      }}
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !editing && event.target === event.currentTarget) db.openRow(row.id);
      }}
      aria-label={row.meta.title}
    >
      {preview ? (
        <div className="db-card-preview" style={cover}>
          {!cover ? (
            <span className="db-card-preview-icon">
              <PageIcon value={row.meta.icon} size={30} fallback={<FileText size={26} />} />
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="db-card-body">
        <div className="db-card-title">
          {row.meta.icon && !(preview && !cover) ? (
            <span className="db-title-icon"><PageIcon value={row.meta.icon} size={15} /></span>
          ) : null}
          {editing ? (
            <TitleInput
              db={db}
              row={row}
              onDone={() => {
                setRenaming(false);
                onTitleDone?.();
              }}
            />
          ) : (
            <span className="db-card-title-text">{row.meta.title || "Untitled"}</span>
          )}
        </div>
        {properties.map((property) => (
          <div key={property.id} className={`db-card-prop type-${property.type}`} title={property.name}>
            {property.type === "checkbox" ? (
              <CheckboxToggle checked={!!cellValue(row, property)} name={property.name} showName onToggle={() => db.setValue(row.id, property.id, !cellValue(row, property))} />
            ) : (
              <CellDisplay property={property} row={row} compact db={db} />
            )}
          </div>
        ))}
      </div>
      <button
        type="button"
        className="icon-button tiny db-card-more"
        aria-label="Page actions"
        onClick={(event) => {
          event.stopPropagation();
          setMenu(event.currentTarget);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {menu ? <RowActions db={db} row={row} anchor={menu} onClose={() => setMenu(null)} onRename={() => setRenaming(true)} /> : null}
    </article>
  );
}

interface CollectionProps {
  db: DatabaseApi;
  view: DatabaseView;
  rows: DatabaseRow[];
  onAddRow: () => void;
  editTitleFor: string | null;
  clearEditTitle: () => void;
}

export function GalleryView({ db, view, rows, onAddRow, editTitleFor, clearEditTitle }: CollectionProps) {
  const preview = view.cardPreview !== "none";
  return (
    <div className={`db-gallery ${preview ? "" : "no-preview"}`}>
      {rows.map((row) => (
        <RowCard
          key={row.id}
          db={db}
          view={view}
          row={row}
          preview={preview}
          editingTitle={editTitleFor === row.id}
          onTitleDone={clearEditTitle}
        />
      ))}
      <button type="button" className="db-gallery-new" onClick={onAddRow}>
        <Plus size={15} /> New page
      </button>
    </div>
  );
}

function ListRow({ db, view, row, editingTitle, onTitleDone }: { db: DatabaseApi; view: DatabaseView; row: DatabaseRow; editingTitle: boolean; onTitleDone: () => void }) {
  const [renaming, setRenaming] = useState(false);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const editing = renaming || editingTitle;
  const properties = shownProperties(db, view, row);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (editingTitle) ref.current?.scrollIntoView({ block: "nearest" });
  }, [editingTitle]);
  return (
    <div
      ref={ref}
      className="db-list-row"
      role="listitem"
      tabIndex={0}
      onClick={() => {
        if (!editing) db.openRow(row.id);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" && !editing && event.target === event.currentTarget) db.openRow(row.id);
      }}
    >
      <span className="db-title-icon"><PageIcon value={row.meta.icon} size={16} fallback={<FileText size={16} />} /></span>
      {editing ? (
        <TitleInput
          db={db}
          row={row}
          onDone={() => {
            setRenaming(false);
            onTitleDone();
          }}
        />
      ) : (
        <span className="db-list-title">{row.meta.title || "Untitled"}</span>
      )}
      <span className="db-list-props">
        {properties.map((property) => (
          <span key={property.id} className={`db-list-prop type-${property.type}`} title={property.name}>
            {property.type === "checkbox" ? (
              <CheckboxToggle checked={!!cellValue(row, property)} name={property.name} onToggle={() => db.setValue(row.id, property.id, !cellValue(row, property))} />
            ) : (
              <CellDisplay property={property} row={row} compact db={db} />
            )}
          </span>
        ))}
      </span>
      <button
        type="button"
        className="icon-button tiny db-list-more"
        aria-label="Page actions"
        onClick={(event) => {
          event.stopPropagation();
          setMenu(event.currentTarget);
        }}
      >
        <MoreHorizontal size={14} />
      </button>
      {menu ? <RowActions db={db} row={row} anchor={menu} onClose={() => setMenu(null)} onRename={() => setRenaming(true)} /> : null}
    </div>
  );
}

export function ListView({ db, view, rows, onAddRow, editTitleFor, clearEditTitle }: CollectionProps) {
  return (
    <div className="db-list" role="list">
      {rows.map((row) => (
        <ListRow key={row.id} db={db} view={view} row={row} editingTitle={editTitleFor === row.id} onTitleDone={clearEditTitle} />
      ))}
      <button type="button" className="db-new-row" onClick={onAddRow}>
        <Plus size={14} /> New page
      </button>
    </div>
  );
}

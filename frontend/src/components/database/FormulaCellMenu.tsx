import { AlertCircle, ChevronRight, Sigma } from "lucide-react";
import { useState } from "react";
import type { DatabaseRow, Property } from "../../lib/database";
import { CellDisplay } from "./CellValue";
import { FormulaEditor } from "./FormulaEditor";
import { Popover } from "./Popover";
import type { DatabaseApi } from "./useDatabase";

/**
 * What a click on a formula cell opens: the row's result (and its error, if
 * any) with "Edit formula", which opens the editor previewing this row.
 * Locked databases never open it; the property menu still edits the formula.
 */
export function FormulaCellMenu({
  db,
  row,
  property,
  anchor,
  onClose,
}: {
  db: DatabaseApi;
  row: DatabaseRow;
  property: Property;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const live = db.schema.properties.find((item) => item.id === property.id) ?? property;
  const error = db.rowErrors.get(row.id)?.[property.id];

  if (editing) return <FormulaEditor db={db} property={live} previewRowId={row.id} onClose={onClose} />;

  return (
    <Popover anchor={anchor} onClose={onClose} width={280} label={`${property.name} formula`}>
      <div className="db-menu db-fx-cell">
        <div className="db-fx-cell-head">
          <span className="db-fx-cell-row">{row.meta.title || "Untitled"}</span>
          <span className="db-fx-cell-prop">{property.name}</span>
        </div>
        <div className={`db-fx-cell-value ${error ? "is-error" : ""}`}>
          {error ? (
            <>
              <AlertCircle size={13} aria-hidden /> <span>{error}</span>
            </>
          ) : (
            <CellDisplay row={row} property={live} />
          )}
        </div>
        <div className="db-menu-sep" />
        <button type="button" className="db-menu-item" autoFocus onClick={() => setEditing(true)}>
          <Sigma size={14} /> Edit formula
          <code className="db-menu-value db-formula-snippet">{live.formula?.trim() || "Empty"}</code>
          <ChevronRight size={14} className="db-menu-trail" />
        </button>
      </div>
    </Popover>
  );
}

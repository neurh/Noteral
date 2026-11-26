/**
 * Auto-fit for table columns (double-click a column's resize handle).
 *
 * Each rendered cell of the column is cloned into a hidden probe inside the
 * table, where the table's own CSS (fonts, padding, chips, wrap mode) still
 * applies, laid out at its natural max-content width and measured in one pass.
 */

export const AUTOFIT_MIN = 72;
export const AUTOFIT_MAX = 640;
/** Cells measured at most; enough for any screenful, cheap on large tables. */
export const AUTOFIT_CELL_LIMIT = 1000;

/** The column width that fits the widest measurement, rounded up and clamped. */
export function fitWidth(measured: readonly number[], { min = AUTOFIT_MIN, max = AUTOFIT_MAX, pad = 1 }: { min?: number; max?: number; pad?: number } = {}): number {
  let widest = 0;
  for (const width of measured) if (Number.isFinite(width) && width > widest) widest = width;
  return Math.min(max, Math.max(min, Math.ceil(widest + pad)));
}

/** Natural (unwrapped, untruncated) widths of the given cells, measured inside `host`. */
export function measureCells(host: HTMLElement, cells: readonly HTMLElement[], limit = AUTOFIT_CELL_LIMIT): number[] {
  const doc = host.ownerDocument;
  const probe = doc.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.style.cssText = "position:absolute;left:0;top:0;width:max-content;visibility:hidden;pointer-events:none;z-index:-1;";
  const clones: HTMLElement[] = [];
  for (const cell of cells.slice(0, limit)) {
    // Keep the row's classes so selectors like `.db-thead .db-th` still match.
    const row = doc.createElement("div");
    row.className = cell.parentElement?.className ?? "";
    row.style.cssText = "display:block;width:max-content;";
    const clone = cell.cloneNode(true) as HTMLElement;
    clone.removeAttribute("id");
    clone.style.width = "max-content";
    clone.style.minWidth = "0";
    clone.style.maxWidth = "none";
    row.appendChild(clone);
    probe.appendChild(row);
    clones.push(clone);
  }
  host.appendChild(probe);
  try {
    return clones.map((clone) => clone.getBoundingClientRect().width);
  } finally {
    probe.remove();
  }
}

/** Measures a header and its body cells and returns the width that fits them all. */
export function autofitColumn(header: HTMLElement, cells: readonly HTMLElement[], bounds?: { min?: number; max?: number }): number | null {
  const host = header.closest<HTMLElement>(".db-table-inner") ?? header.parentElement?.parentElement;
  if (!host) return null;
  return fitWidth(measureCells(host, [header, ...cells]), bounds);
}

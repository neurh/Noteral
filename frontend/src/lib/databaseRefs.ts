import type { DatabaseSchema, DatabaseView } from "./database";

/**
 * A database block can show views from several databases ("sources"). The
 * block stores an ordered list of refs; each ref names a source database and
 * one of its views. An empty list means the classic mode: the block shows the
 * source database's own (shared) views.
 */
export interface ViewRef {
  /** Source database page id. */
  db: string;
  /** View id inside that database's schema. */
  view: string;
}

/** One tab of a database block. */
export interface ViewEntry {
  source: string;
  view: DatabaseView;
}

export function parseRefs(raw: unknown): ViewRef[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const value = JSON.parse(raw) as unknown;
    if (!Array.isArray(value)) return [];
    return value
      .filter((item): item is ViewRef => !!item && typeof item === "object" && typeof (item as ViewRef).db === "string" && typeof (item as ViewRef).view === "string")
      .map((item) => ({ db: item.db, view: item.view }));
  } catch {
    return [];
  }
}

export function serializeRefs(refs: ViewRef[]): string {
  return refs.length ? JSON.stringify(refs.map((ref) => ({ db: ref.db, view: ref.view }))) : "";
}

/** Views a database page (or a classic block) shows: everything not owned by a block. */
export function sharedViews(schema: DatabaseSchema): DatabaseView[] {
  const shared = schema.views.filter((view) => !view.owner);
  return shared.length ? shared : schema.views;
}

/**
 * Resolves a block's tabs. Refs whose database or view is gone are skipped;
 * when nothing is left the block falls back to the primary database's views.
 */
export function resolveEntries(primary: string, refs: ViewRef[], schemas: Map<string, DatabaseSchema | undefined>): { entries: ViewEntry[]; linked: boolean } {
  const entries: ViewEntry[] = [];
  for (const ref of refs) {
    const view = schemas.get(ref.db)?.views.find((item) => item.id === ref.view);
    if (view) entries.push({ source: ref.db, view });
  }
  if (entries.length) return { entries, linked: true };
  const schema = schemas.get(primary);
  return { entries: schema ? sharedViews(schema).map((view) => ({ source: primary, view })) : [], linked: false };
}

/** The refs equivalent of a block's current tabs (used when switching a classic block to refs). */
export function refsOf(entries: ViewEntry[]): ViewRef[] {
  return entries.map((entry) => ({ db: entry.source, view: entry.view.id }));
}

/** Moves `id` before or after `target` (ids compared with `key`). */
export function moveItem<T>(items: T[], key: (item: T) => string, id: string, target: string, after: boolean): T[] {
  if (id === target) return items;
  const from = items.findIndex((item) => key(item) === id);
  if (from < 0 || !items.some((item) => key(item) === target)) return items;
  const next = [...items];
  const [moved] = next.splice(from, 1);
  let to = next.findIndex((item) => key(item) === target);
  if (after) to += 1;
  next.splice(to, 0, moved);
  return next;
}

/**
 * Reorders a schema's views so that `id` sits before/after `target`, leaving
 * views of other blocks where they are.
 */
export function reorderViews(schema: DatabaseSchema, id: string, target: string, after: boolean) {
  schema.views = moveItem(schema.views, (view) => view.id, id, target, after);
}

/**
 * A copy of `view` that fits `schema` (another database): settings that point
 * at property ids of the old database are dropped.
 */
export function adaptViewTo(view: DatabaseView, fresh: DatabaseView): DatabaseView {
  return {
    ...fresh,
    name: view.name,
    icon: view.icon,
    openIn: view.openIn,
    showIcons: view.showIcons,
    showFilterBar: view.showFilterBar,
    wrap: view.wrap,
    rowNumbers: view.rowNumbers,
    limit: view.limit,
    cardSize: view.cardSize,
    cardPreview: view.cardPreview ?? fresh.cardPreview,
  };
}

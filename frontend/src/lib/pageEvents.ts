/**
 * Turns two snapshots of the page list into plugin events: page:created,
 * page:renamed, page:moved, page:deleted, plus one pages:changed summary.
 */

export interface PageLike {
  id: string;
  parentId: string;
  title: string;
  kind: string;
  deletedAt?: string;
}

export interface PageEventInfo {
  pageId: string;
  title: string;
  parentId: string | null;
  kind: string;
}

export interface PageChanges {
  created: PageEventInfo[];
  renamed: (PageEventInfo & { previousTitle: string })[];
  moved: (PageEventInfo & { previousParentId: string | null })[];
  deleted: PageEventInfo[];
}

/** Events per batch; beyond this only pages:changed carries the ids. */
export const MAX_PAGE_EVENTS = 200;

function info(page: PageLike): PageEventInfo {
  return { pageId: page.id, title: page.title, parentId: page.parentId || null, kind: page.kind || "page" };
}

function live(pages: readonly PageLike[]): Map<string, PageLike> {
  const map = new Map<string, PageLike>();
  for (const page of pages) if (!page.deletedAt) map.set(page.id, page);
  return map;
}

export function diffPages(before: readonly PageLike[], after: readonly PageLike[]): PageChanges {
  const prev = live(before);
  const next = live(after);
  const changes: PageChanges = { created: [], renamed: [], moved: [], deleted: [] };
  for (const [id, page] of next) {
    const old = prev.get(id);
    if (!old) {
      changes.created.push(info(page));
      continue;
    }
    if (old.title !== page.title) changes.renamed.push({ ...info(page), previousTitle: old.title });
    if ((old.parentId || "") !== (page.parentId || "")) changes.moved.push({ ...info(page), previousParentId: old.parentId || null });
  }
  for (const [id, page] of prev) if (!next.has(id)) changes.deleted.push(info(page));
  return changes;
}

export function isEmpty(changes: PageChanges): boolean {
  return !changes.created.length && !changes.renamed.length && !changes.moved.length && !changes.deleted.length;
}

/** The pages:changed payload: the count plus the ids that changed. */
export function summary(changes: PageChanges, count: number) {
  const ids = (list: PageEventInfo[]) => list.map((item) => item.pageId);
  return { count, created: ids(changes.created), renamed: ids(changes.renamed), moved: ids(changes.moved), deleted: ids(changes.deleted) };
}

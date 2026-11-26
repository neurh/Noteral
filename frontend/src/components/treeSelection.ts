// Pure helpers for multi-selecting rows in the page tree.

interface Node {
  id: string;
}

/** Ids of the rows the tree currently shows, top to bottom. */
export function visibleOrder(children: Map<string, Node[]>, expanded: Set<string>): string[] {
  const order: string[] = [];
  const seen = new Set<string>();
  const walk = (parent: string) => {
    for (const child of children.get(parent) ?? []) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      order.push(child.id);
      if (expanded.has(child.id)) walk(child.id);
    }
  };
  walk("");
  return order;
}

/** The visible rows from `from` to `to`, inclusive, in tree order. */
export function rangeBetween(order: string[], from: string | null | undefined, to: string): string[] {
  const end = order.indexOf(to);
  if (end < 0) return [];
  const start = from ? order.indexOf(from) : -1;
  if (start < 0) return [to];
  const [lo, hi] = start <= end ? [start, end] : [end, start];
  return order.slice(lo, hi + 1);
}

/**
 * The selected ids that are not inside another selected page, in tree order.
 * Trash, duplicate and move act on a whole subtree, so a selected child of a
 * selected parent would otherwise be handled twice.
 */
export function topLevelOnly(ids: Iterable<string>, parentOf: (id: string) => string | undefined, order: string[] = []): string[] {
  const set = new Set(ids);
  const result = [...set].filter((id) => {
    const seen = new Set<string>();
    for (let parent = parentOf(id); parent && !seen.has(parent); parent = parentOf(parent)) {
      if (set.has(parent)) return false;
      seen.add(parent);
    }
    return true;
  });
  const rank = new Map(order.map((id, index) => [id, index]));
  return result.sort((a, b) => (rank.get(a) ?? Infinity) - (rank.get(b) ?? Infinity));
}

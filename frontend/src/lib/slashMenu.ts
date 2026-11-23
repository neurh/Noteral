export interface RankableItem {
  title: string;
  aliases?: string[];
  group?: string;
}

function scoreOf(item: RankableItem, needle: string): number {
  const title = item.title.toLowerCase();
  const aliases = (item.aliases ?? []).map((alias) => alias.toLowerCase());
  if (title === needle) return 0;
  if (title.startsWith(needle)) return 1;
  if (title.split(/[\s-]+/).some((word) => word.startsWith(needle))) return 2;
  if (aliases.includes(needle)) return 3;
  if (aliases.some((alias) => alias.startsWith(needle))) return 4;
  if (title.includes(needle)) return 5;
  if (aliases.some((alias) => alias.includes(needle))) return 6;
  return -1;
}

/**
 * Filters slash-menu items for a query and ranks the best matches first.
 *
 * With no query the menu keeps its grouped order. Once the user types, results
 * become one flat ranked list: group headings are dropped because ranking
 * interleaves groups, and a heading repeated between results reads as noise.
 */
export function rankSlashItems<T extends RankableItem>(items: T[], query: string): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items
    .map((item, index) => ({ item, index, score: scoreOf(item, needle) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map(({ item }) => ({ ...item, group: undefined }));
}

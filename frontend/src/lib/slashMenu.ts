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

export interface ArrangeableItem extends RankableItem {
  key?: string;
}

/**
 * The slash menu's groups with no query, in order. Items are matched by key
 * (BlockNote's defaults and Noteral's own) and moved into these groups; any
 * other item keeps its own group after them, in the order it came.
 */
export const SLASH_GROUPS: { name: string; keys: string[] }[] = [
  {
    name: "Basic blocks",
    keys: ["paragraph", "heading", "heading_2", "heading_3", "bullet_list", "numbered_list", "check_list", "toggle_list", "quote", "callout", "divider"],
  },
  { name: "Insert", keys: ["page_link", "database", "table", "code_block", "emoji"] },
  { name: "Media", keys: ["image", "video", "audio", "file"] },
  { name: "More headings", keys: ["toggle_heading", "toggle_heading_2", "toggle_heading_3", "heading_4", "heading_5", "heading_6"] },
];

/** Puts slash-menu items into {@link SLASH_GROUPS}, leaving unknown groups (custom blocks, plugins) after them. */
export function arrangeSlashItems<T extends ArrangeableItem>(items: T[]): T[] {
  const slots = new Map<string, { group: string; rank: number }>();
  SLASH_GROUPS.forEach((group, groupIndex) =>
    group.keys.forEach((key, keyIndex) => slots.set(key, { group: group.name, rank: groupIndex * 1000 + keyIndex })),
  );
  const tail = new Map<string, number>();
  return items
    .map((item, index) => {
      const slot = item.key ? slots.get(item.key) : undefined;
      if (slot) return { item: { ...item, group: slot.group }, rank: slot.rank, index };
      const group = item.group ?? "";
      if (!tail.has(group)) tail.set(group, tail.size);
      return { item, rank: (SLASH_GROUPS.length + tail.get(group)!) * 1000, index };
    })
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map(({ item }) => item);
}

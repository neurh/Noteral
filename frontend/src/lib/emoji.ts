import compact from "emojibase-data/en/compact.json";
import messages from "emojibase-data/en/messages.json";

export interface EmojiSkin {
  unicode: string;
  label: string;
}

export interface EmojiEntry {
  hexcode: string;
  label: string;
  unicode: string;
  group: number;
  order: number;
  tags: string[];
  skins: EmojiSkin[];
  search: string;
}

type RawEmoji = {
  hexcode: string;
  label: string;
  unicode: string;
  group?: number;
  order?: number;
  tags?: string[];
  skins?: Array<{ unicode: string; label: string }>;
};

const groupLabels = new Map<number, string>(
  (messages as unknown as { groups: Array<{ order: number; message: string }> }).groups.map((group) => [group.order, group.message]),
);

const skinLabels: Record<string, string> = {
  light: "Light",
  "medium-light": "Medium light",
  medium: "Medium",
  "medium-dark": "Medium dark",
  dark: "Dark",
};

function skinName(label: string): string {
  const key = label.replace(/\s*skin tone$/i, "").trim().toLowerCase();
  return skinLabels[key] ?? key;
}

export const EMOJI_GROUPS = [...groupLabels.entries()]
  .filter(([order]) => order !== 2)
  .sort(([a], [b]) => a - b)
  .map(([order, label]) => ({
    order,
    label: label.replace(/\b\w/g, (letter) => letter.toUpperCase()),
  }));

export const EMOJI: EmojiEntry[] = (compact as RawEmoji[])
  .filter((entry) => typeof entry.group === "number" && entry.group !== 2 && entry.unicode)
  .map((entry) => {
    const tags = entry.tags ?? [];
    return {
      hexcode: entry.hexcode,
      label: entry.label,
      unicode: entry.unicode,
      group: entry.group as number,
      order: entry.order ?? 0,
      tags,
      skins: entry.skins ?? [],
      search: `${entry.label} ${tags.join(" ")}`.toLowerCase(),
    };
  })
  .sort((a, b) => a.order - b.order);

export function emojiGroupLabel(order: number): string {
  return groupLabels.get(order)?.replace(/\b\w/g, (letter) => letter.toUpperCase()) ?? "Emoji";
}

export function emojiSkins(emoji: EmojiEntry): Array<{ name: string; char: string }> {
  return [
    { name: "Default", char: emoji.unicode },
    ...emoji.skins.map((skin) => ({ name: skinName(skin.label.split(":").pop() ?? skin.label), char: skin.unicode })),
  ];
}

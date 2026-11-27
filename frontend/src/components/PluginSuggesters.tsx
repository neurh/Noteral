/**
 * Inline suggestion menus contributed by plugins (Plugin.registerSuggester): one BlockNote
 * SuggestionMenuController per trigger character, asking every plugin that registered that
 * trigger for items and inserting (or handing back) the one the user picks.
 */
import { useSyncExternalStore } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { SuggestionMenuController, type DefaultReactSuggestionItem } from "@blocknote/react";
import { Puzzle } from "lucide-react";
import { devlog } from "../lib/devlog";
import { pluginExtensions, type SuggesterRegistration } from "../lib/pluginExtensions";
import { pluginRuntime } from "../plugins/runtime";
import type { SuggestContext, SuggestItem } from "../sdk-host/types";

const ANSWER_TIMEOUT = 3000;

function clip(value: unknown, max: number): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

/** Keeps only the fields the host understands, so a plugin can't smuggle anything else in. */
export function cleanItems(raw: unknown, max: number): SuggestItem[] {
  if (!Array.isArray(raw)) return [];
  const out: SuggestItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const item = entry as Record<string, unknown>;
    const title = clip(item.title, 200).trim();
    if (!title) continue;
    const link = clip(item.link, 2000);
    out.push({
      id: clip(item.id, 200) || undefined,
      title,
      subtitle: clip(item.subtitle, 300) || undefined,
      group: clip(item.group, 80) || undefined,
      insert: typeof item.insert === "string" ? item.insert.slice(0, 10_000) : undefined,
      link: /^(https?:\/\/|noteral:\/\/|mailto:)/i.test(link) ? link : undefined,
      data: item.data,
    });
    if (out.length >= max) break;
  }
  return out;
}

function cursorBlockId(editor: BlockNoteEditor<any, any, any>): string | null {
  try {
    return editor.getTextCursorPosition().block.id;
  } catch {
    return null;
  }
}

function insertItem(editor: BlockNoteEditor<any, any, any>, item: SuggestItem) {
  const text = item.insert ?? item.title;
  if (!text) return;
  if (item.link) editor.insertInlineContent([{ type: "link", href: item.link, content: text }, " "]);
  else editor.insertInlineContent(text);
}

async function itemsFor(editor: BlockNoteEditor<any, any, any>, pageId: string, suggesters: SuggesterRegistration[], trigger: string, query: string): Promise<DefaultReactSuggestionItem[]> {
  const context: SuggestContext = { query, trigger, pageId: pageId || null, blockId: cursorBlockId(editor) };
  const batches = await Promise.all(
    suggesters
      .filter((suggester) => query.length >= suggester.minChars)
      .map(async (suggester) => {
        try {
          const raw = await pluginRuntime.invoke(suggester.pluginId, `__suggest:${suggester.id}`, context, ANSWER_TIMEOUT);
          return cleanItems(raw, suggester.maxItems).map((item): DefaultReactSuggestionItem => ({
            title: item.title,
            subtext: item.subtitle,
            group: item.group ?? suggester.pluginName,
            icon: <Puzzle size={16} />,
            onItemClick: () => {
              if (!suggester.onSelect) {
                insertItem(editor, item);
                return;
              }
              pluginRuntime.invoke(suggester.pluginId, `__select:${suggester.id}`, { item, context }).catch((error) => {
                devlog.add(`plugin:${suggester.pluginId}`, "warn", `Suggester "${suggester.id}" onSelect: ${error instanceof Error ? error.message : String(error)}`);
              });
            },
          }));
        } catch (error) {
          devlog.add(`plugin:${suggester.pluginId}`, "warn", `Suggester "${suggester.id}": ${error instanceof Error ? error.message : String(error)}`);
          return [];
        }
      }),
  );
  return batches.flat();
}

export function PluginSuggesters({ editor, pageId }: { editor: BlockNoteEditor<any, any, any>; pageId: string }) {
  const suggesters = useSyncExternalStore(pluginExtensions.subscribe, pluginExtensions.getSuggesters);
  const triggers = Array.from(new Set(suggesters.map((item) => item.trigger)));
  return (
    <>
      {triggers.map((trigger) => (
        <SuggestionMenuController
          key={trigger}
          triggerCharacter={trigger}
          getItems={(query: string) => itemsFor(editor, pageId, pluginExtensions.getSuggesters().filter((item) => item.trigger === trigger), trigger, query)}
        />
      ))}
    </>
  );
}

/**
 * plugins.docs: lets the assistant read the plugin guide, the whole method reference
 * (plugin-only methods included, which it has no tools for) and the API's types while it
 * writes plugin code. The guide is generated from docs/plugins/*.md by scripts/build-sdk.mjs
 * and loaded on first use.
 */
import { ApiError } from "./host";
import { SDK_VERSION } from "./handlers";
import { EVENTS, METHODS, PERMISSIONS, callersOf } from "./spec";
import type { MethodSpec } from "./spec";
import type { PluginDocsResult } from "./types";

const MAX_TEXT = 24_000;
const STOP = new Set(["a", "an", "the", "and", "or", "of", "to", "in", "on", "for", "with", "how", "do", "i", "is", "it", "my", "plugin", "plugins"]);

type Guide = typeof import("../assistant/generated/pluginGuide");
let guide: Promise<Guide> | undefined;
const loadGuide = () => (guide ??= import("../assistant/generated/pluginGuide"));

const words = (text: string) =>
  text
    .toLowerCase()
    .split(/[^a-z0-9.:_-]+/)
    .map((word) => word.replace(/^[.:_-]+|[.:_-]+$/g, ""))
    .filter((word) => word.length > 1 && !STOP.has(word));

/** Rough relevance: title hits weigh most, then how often the words appear in the text. */
function score(section: { title: string; text: string }, query: string[]): number {
  const title = section.title.toLowerCase();
  const text = section.text.toLowerCase();
  let total = 0;
  for (const word of query) {
    const stem = word.length > 4 ? word.replace(/(ies|es|s)$/, "") : word;
    if (title.includes(stem)) total += 12;
    let at = text.indexOf(stem);
    let hits = 0;
    while (at >= 0 && hits < 20) {
      hits++;
      at = text.indexOf(stem, at + stem.length);
    }
    total += Math.min(hits, 8);
  }
  return total;
}

function methodInfo(method: MethodSpec, withParams: boolean): NonNullable<PluginDocsResult["methods"]>[number] {
  return {
    name: method.name,
    summary: method.summary,
    ...(method.details ? { details: method.details } : {}),
    permission: method.permission,
    callers: callersOf(method),
    ...(withParams ? { params: method.params } : {}),
    returns: method.returns,
  };
}

/** Type names mentioned in a return/params type, e.g. "PluginInstallResult & { … }" or "StorageEntryInfo[]". */
function typeNames(text: string, types: Record<string, string>): string[] {
  return Array.from(new Set(text.match(/\b[A-Z]\w+\b/g) ?? [])).filter((name) => name in types);
}

function clip(sections: { title: string; text: string }[]): { title: string; text: string }[] {
  const out: { title: string; text: string }[] = [];
  let used = 0;
  for (const section of sections) {
    if (used >= MAX_TEXT) break;
    const room = MAX_TEXT - used;
    const text = section.text.length > room ? `${section.text.slice(0, room)}\n…(cut; ask for this topic alone to read the rest)` : section.text;
    out.push({ title: section.title, text });
    used += text.length;
  }
  return out;
}

export const DOCS_HANDLERS = {
  "plugins.docs": async (p: Record<string, unknown>): Promise<PluginDocsResult> => {
    const { PLUGIN_GUIDE, PLUGIN_TYPES } = await loadGuide();
    const topic = typeof p.topic === "string" ? p.topic.trim() : "";
    const methodName = typeof p.method === "string" ? p.method.trim().replace(/^this\.app\./, "").replace(/__/g, ".") : "";
    const typeName = typeof p.type === "string" ? p.type.trim().replace(/\[\]$/, "") : "";
    const result: PluginDocsResult = {};

    if (methodName) {
      const exact = METHODS.find((method) => method.name === methodName);
      if (exact) {
        result.methods = [methodInfo(exact, true)];
        const related = typeNames(exact.returns, PLUGIN_TYPES);
        if (related.length) result.types = Object.fromEntries(related.map((name) => [name, PLUGIN_TYPES[name]]));
      } else {
        const ns = methodName.replace(/\.$/, "");
        const inNamespace = METHODS.filter((method) => method.name.startsWith(`${ns}.`));
        const loose = inNamespace.length ? inNamespace : METHODS.filter((method) => method.name.toLowerCase().includes(ns.toLowerCase()));
        if (!loose.length) throw new ApiError(`No method or namespace "${methodName}". Call plugins.docs with no arguments for the namespaces.`, "invalid_params");
        result.methods = loose.slice(0, 60).map((method) => methodInfo(method, p.full === true || loose.length <= 3));
        if (!(p.full === true || loose.length <= 3)) result.hint = "Pass method: \"<namespace>.<name>\" (or full: true) for parameters.";
      }
    }

    if (typeName) {
      const hit = PLUGIN_TYPES[typeName] ?? Object.entries(PLUGIN_TYPES).find(([name]) => name.toLowerCase() === typeName.toLowerCase())?.[1];
      if (!hit) {
        const near = Object.keys(PLUGIN_TYPES).filter((name) => name.toLowerCase().includes(typeName.toLowerCase())).slice(0, 12);
        throw new ApiError(`No type "${typeName}".${near.length ? ` Similar: ${near.join(", ")}.` : ""}`, "invalid_params");
      }
      result.types = { ...result.types, [typeName]: hit };
    }

    if (topic) {
      const query = words(topic);
      const ranked = PLUGIN_GUIDE.map((section) => ({ section, score: score(section, query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score);
      const best = ranked[0]?.score ?? 0;
      // The best match plus close runners-up (at most 4), so one question gets everything relevant.
      const picked = ranked.filter((entry, index) => index === 0 || (index < 4 && entry.score >= best * 0.5)).map((entry) => entry.section);
      result.sections = clip(picked);
      if (!picked.length) result.hint = "Nothing matched. Call plugins.docs with no arguments for the list of sections.";
    }

    if (!methodName && !typeName && !topic) {
      const namespaces: Record<string, number> = {};
      for (const method of METHODS) {
        const ns = method.name.split(".")[0];
        namespaces[ns] = (namespaces[ns] ?? 0) + 1;
      }
      result.index = {
        sections: PLUGIN_GUIDE.map((section) => section.title),
        namespaces,
        events: EVENTS.map((event) => `${event.name} (${event.payload}${event.permission ? `, needs ${event.permission}` : ""})`),
        permissions: PERMISSIONS.map((permission) => `${permission.id} (${permission.risk})`),
      };
      result.hint = `SDK ${SDK_VERSION}. Ask for a topic (section words), a method or namespace, or a type.`;
    }
    return result;
  },
};

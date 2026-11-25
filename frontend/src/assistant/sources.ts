/** Web sources the assistant (and its sub-agents) searched and read, for the source list. */
import type { ChatMessage, ToolPart } from "./types";

export interface Source {
  url: string;
  title: string;
  host: string;
  snippet?: string;
  /** The page was fetched and read, not only listed in search results. */
  read: boolean;
}

export function hostOf(url: string): string {
  try {
    return new URL(url).host.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function parse(result?: string): Record<string, unknown> | null {
  if (!result) return null;
  try {
    const value = JSON.parse(result) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** Search results of a web.search call. */
export function searchResults(result?: string): { title: string; url: string; snippet?: string }[] {
  const parsed = parse(result);
  const results = Array.isArray(parsed?.results) ? (parsed.results as { title?: string; url?: string; snippet?: string }[]) : [];
  return results
    .filter((item) => typeof item.url === "string" && item.url)
    .slice(0, 10)
    .map((item) => ({ title: item.title || hostOf(item.url!), url: item.url!, snippet: item.snippet }));
}

/** Sources found by one tool call (web.search lists, web.fetch reads). */
export function sourcesOfCall(name: string, args: Record<string, unknown>, result?: string): Source[] {
  if (name === "web.search") return searchResults(result).map((item) => ({ ...item, host: hostOf(item.url), read: false }));
  if (name === "web.fetch") {
    const parsed = parse(result);
    // Long pages are truncated before they reach here, so fall back to a regex for the title.
    const url = String(parsed?.finalUrl || parsed?.url || args.url || "");
    if (!url) return [];
    const title = String(parsed?.title || /"title"\s*:\s*"([^"]{1,200})"/.exec(result ?? "")?.[1] || hostOf(url));
    return [{ url, title, host: hostOf(url), read: true }];
  }
  return [];
}

function toolSources(part: ToolPart): Source[] {
  if (part.status !== "done") return [];
  const own = sourcesOfCall(part.name, part.args, part.result);
  if (!part.agent) return own;
  const nested = part.agent.steps.flatMap((step) => (step.sources ?? []).map((item) => ({ ...item, host: hostOf(item.url), read: step.name === "web.fetch" })));
  return [...own, ...nested];
}

/** Every source in a reply, de-duplicated; a page that was read wins over a search hit. */
export function sourcesOf(message: ChatMessage): Source[] {
  const byUrl = new Map<string, Source>();
  for (const part of message.parts) {
    if (part.type !== "tool") continue;
    for (const source of toolSources(part)) {
      const key = source.url.replace(/#.*$/, "").replace(/\/$/, "");
      const existing = byUrl.get(key);
      if (!existing) byUrl.set(key, source);
      else if (source.read && !existing.read) byUrl.set(key, { ...existing, ...source, snippet: existing.snippet ?? source.snippet });
    }
  }
  return [...byUrl.values()].sort((a, b) => Number(b.read) - Number(a.read));
}

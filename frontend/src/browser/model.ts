/**
 * The in-app browser's data: what each browser tab shows, bookmarks, history
 * and preferences. Pure functions only, so it is easy to test; the store in
 * ./store.ts holds the live copy and persists it per workspace.
 *
 * A tab's location is either "" (the home page) or an http(s) address.
 * Searches are ordinary addresses on the chosen search engine, so they behave
 * like any other page: links work, back and forward work.
 */

export type BrowserMode = "web" | "reader";

export interface BrowserTabState {
  /** Back/forward list; `index` is the entry on screen. */
  entries: string[];
  index: number;
  /** Title of the entry on screen, for the tab strip. */
  title: string;
  /** How web pages show in this tab. Sites that refuse frames always use the reader. */
  mode: BrowserMode;
}

export interface BrowserBookmark {
  url: string;
  title: string;
  addedAt: string;
}

export interface BrowserVisit {
  url: string;
  title: string;
  visitedAt: string;
}

export interface BrowserPrefs {
  /** Mode new tabs start in. */
  defaultMode: BrowserMode;
  /** Open web links from pages in a browser tab instead of the system browser. */
  openLinksInApp: boolean;
  /** Reader text size in px. */
  readerSize: number;
  /** Folder clips go to; "" lets the browser create "Web clips". */
  clipFolderId: string;
  /** Engine the address bar searches with: an id from SEARCH_ENGINES or "custom". */
  searchEngine: string;
  /** Search address for the "custom" engine, with %s where the query goes. */
  customSearchUrl: string;
  /** What Home and new tabs open: "" for Noteral's home page, or an address. */
  homePage: string;
}

export interface BrowserData {
  tabs: Record<string, BrowserTabState>;
  bookmarks: BrowserBookmark[];
  history: BrowserVisit[];
  prefs: BrowserPrefs;
}

export const MAX_HISTORY = 400;
export const MAX_BOOKMARKS = 200;
const MAX_ENTRIES = 50;
export const READER_SIZES = [15, 16, 17, 18, 20, 22];

export const DEFAULT_PREFS: BrowserPrefs = {
  defaultMode: "web",
  openLinksInApp: true,
  readerSize: 17,
  clipFolderId: "",
  searchEngine: "duckduckgo",
  customSearchUrl: "",
  homePage: "",
};

export interface SearchEngine {
  id: string;
  name: string;
  /** Results address with %s for the query. */
  url: string;
  /** Hosts whose result pages count as searches on this engine. */
  hosts: string[];
  /** Query parameter, to read the query back out of a results address. */
  param: string;
}

/**
 * Engines whose result pages work inside Noteral. DuckDuckGo uses its HTML
 * results page, which needs no scripts and loads fast through the app.
 */
export const SEARCH_ENGINES: SearchEngine[] = [
  { id: "duckduckgo", name: "DuckDuckGo", url: "https://html.duckduckgo.com/html/?q=%s", hosts: ["duckduckgo.com"], param: "q" },
  { id: "google", name: "Google", url: "https://www.google.com/search?q=%s", hosts: ["google.com"], param: "q" },
  { id: "bing", name: "Bing", url: "https://www.bing.com/search?q=%s", hosts: ["bing.com"], param: "q" },
  { id: "brave", name: "Brave Search", url: "https://search.brave.com/search?q=%s", hosts: ["search.brave.com"], param: "q" },
  { id: "startpage", name: "Startpage", url: "https://www.startpage.com/do/search?q=%s", hosts: ["startpage.com"], param: "q" },
  { id: "wikipedia", name: "Wikipedia", url: "https://en.wikipedia.org/w/index.php?search=%s", hosts: ["wikipedia.org"], param: "search" },
];

/** A custom search address must be http(s) and contain %s. */
export function validSearchTemplate(template: string): boolean {
  const value = template.trim();
  return value.includes("%s") && normalizeUrl(value.replace(/%s/g, "q")) !== null;
}

export function searchEngine(prefs: Pick<BrowserPrefs, "searchEngine" | "customSearchUrl">): SearchEngine {
  if (prefs.searchEngine === "custom" && validSearchTemplate(prefs.customSearchUrl)) {
    const url = prefs.customSearchUrl.trim();
    const host = hostOf(url.replace(/%s/g, "q"));
    let param = "q";
    try {
      for (const [key, value] of new URL(url.replace(/%s/g, "__q__")).searchParams) if (value === "__q__") param = key;
    } catch {
      /* keep q */
    }
    return { id: "custom", name: host || "Custom", url, hosts: host ? [host] : [], param };
  }
  return SEARCH_ENGINES.find((engine) => engine.id === prefs.searchEngine) ?? SEARCH_ENGINES[0];
}

/** The results address for a query on an engine. */
export function searchUrl(query: string, engine: SearchEngine = SEARCH_ENGINES[0]): string {
  return engine.url.replace(/%s/g, encodeURIComponent(query.trim()).replace(/%20/g, "+"));
}

function onHost(host: string, root: string): boolean {
  return host === root || host.endsWith(`.${root}`);
}

/** The query when an address is a results page on one of the known engines. */
export function searchQueryOf(location: string, engines: SearchEngine[] = SEARCH_ENGINES): string | null {
  if (!isWebLocation(location)) return null;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return null;
  }
  const host = url.hostname.replace(/^www\./, "");
  for (const engine of engines) {
    if (!engine.hosts.some((root) => onHost(host, root))) continue;
    let path = "/";
    try {
      path = new URL(engine.url.replace(/%s/g, "q")).pathname;
    } catch {
      /* any path */
    }
    if (engine.id !== "custom" && url.pathname !== path && !(engine.id === "duckduckgo" && (url.pathname === "/" || url.pathname === "/html/" || url.pathname === "/lite/"))) continue;
    const query = url.searchParams.get(engine.param);
    if (query) return query;
  }
  return null;
}

export function emptyBrowserData(): BrowserData {
  return { tabs: {}, bookmarks: [], history: [], prefs: { ...DEFAULT_PREFS } };
}

export function newTabState(location = "", mode: BrowserMode = DEFAULT_PREFS.defaultMode): BrowserTabState {
  return { entries: [location], index: 0, title: titleForLocation(location), mode };
}

// ── locations ──────────────────────────────────────────────────────────────

export function isWebLocation(location: string): boolean {
  return /^https?:\/\//i.test(location);
}

const HOST_LIKE = /^(localhost|\d{1,3}(\.\d{1,3}){3}|([a-z0-9-]+\.)+[a-z]{2,63})(:\d{1,5})?([/?#].*)?$/i;

/**
 * What the address bar means: a URL (with or without its scheme) opens that
 * page, anything else searches with the chosen engine.
 */
export function resolveInput(raw: string, engine: SearchEngine = SEARCH_ENGINES[0]): string {
  const input = raw.trim();
  if (!input) return "";
  const search = () => searchUrl(input, engine);
  if (/^https?:\/\//i.test(input)) return normalizeUrl(input) ?? search();
  if (/\s/.test(input)) return search();
  if (HOST_LIKE.test(input)) {
    const scheme = /^(localhost|\d{1,3}(\.\d{1,3}){3})(:|\/|$)/i.test(input) ? "http://" : "https://";
    return normalizeUrl(scheme + input) ?? search();
  }
  return search();
}

/** True when the address bar input would search rather than open a site. */
export function inputSearches(raw: string): boolean {
  const input = raw.trim();
  if (!input) return false;
  if (/^https?:\/\//i.test(input)) return normalizeUrl(input) === null;
  return /\s/.test(input) || !HOST_LIKE.test(input);
}

export function normalizeUrl(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString();
  } catch {
    return null;
  }
}

/** What the address bar shows for a location. */
export function displayLocation(location: string): string {
  return location;
}

export function hostOf(location: string): string {
  if (!isWebLocation(location)) return "";
  try {
    return new URL(location).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function titleForLocation(location: string, pageTitle = ""): string {
  if (!location) return "Home";
  const query = searchQueryOf(location);
  if (query !== null && !pageTitle.trim()) return `${query} – Search`;
  return pageTitle.trim() || hostOf(location) || location;
}

/**
 * Drops a trailing site name from a page title ("Note-taking - Wikipedia" on
 * wikipedia.org becomes "Note-taking"). Only strips when the suffix names the
 * site the page is on, so titles that lead with the site stay whole.
 */
export function tidyTitle(title: string, location: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  const match = /^(.{3,}?)\s+[-–—|·:]\s+([^-–—|·:]{2,40})$/.exec(clean);
  if (!match) return clean;
  const site = match[2].toLowerCase().replace(/[^a-z0-9]/g, "");
  const host = hostOf(location).toLowerCase().replace(/[^a-z0-9.]/g, "");
  const labels = host.split(".").filter((label) => label.length > 2);
  if (!site || !labels.some((label) => site.includes(label) || label.includes(site))) return clean;
  return match[1].trim();
}

/** Removes wiki-style "[edit]" section links and the blank lines they leave behind. */
export function tidyArticle(markdown: string): string {
  return markdown
    .replace(/\[\[(?:edit|edit source)\]\([^)]*\)\]/gi, "")
    .replace(/^\s*\[(?:edit|edit source)\]\([^)]*action=edit[^)]*\)\s*$/gim, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** The site's own icon, fetched straight from it. */
export function faviconUrl(location: string): string {
  if (!isWebLocation(location)) return "";
  try {
    return new URL("/favicon.ico", location).toString();
  } catch {
    return "";
  }
}

// ── tab history ────────────────────────────────────────────────────────────

export function currentLocation(tab: BrowserTabState): string {
  return tab.entries[tab.index] ?? "";
}

export function navigate(tab: BrowserTabState, location: string): BrowserTabState {
  if (currentLocation(tab) === location) return tab;
  let entries = [...tab.entries.slice(0, tab.index + 1), location];
  if (entries.length > MAX_ENTRIES) entries = entries.slice(entries.length - MAX_ENTRIES);
  return { ...tab, entries, index: entries.length - 1, title: titleForLocation(location) };
}

/** Swap the entry on screen, e.g. after a redirect. */
export function replaceLocation(tab: BrowserTabState, location: string): BrowserTabState {
  if (currentLocation(tab) === location) return tab;
  const entries = [...tab.entries];
  entries[tab.index] = location;
  return { ...tab, entries };
}

export function canGo(tab: BrowserTabState, delta: -1 | 1): boolean {
  const next = tab.index + delta;
  return next >= 0 && next < tab.entries.length;
}

export function go(tab: BrowserTabState, delta: -1 | 1): BrowserTabState {
  if (!canGo(tab, delta)) return tab;
  const index = tab.index + delta;
  return { ...tab, index, title: titleForLocation(tab.entries[index]) };
}

// ── bookmarks and history ──────────────────────────────────────────────────

export function isBookmarked(data: BrowserData, url: string): boolean {
  return data.bookmarks.some((item) => item.url === url);
}

export function toggleBookmark(data: BrowserData, url: string, title: string, now = new Date()): BrowserData {
  if (isBookmarked(data, url)) return { ...data, bookmarks: data.bookmarks.filter((item) => item.url !== url) };
  const bookmark = { url, title: title || hostOf(url) || url, addedAt: now.toISOString() };
  return { ...data, bookmarks: [bookmark, ...data.bookmarks].slice(0, MAX_BOOKMARKS) };
}

/** Record a visit; revisiting moves the entry to the top instead of duplicating it. */
export function recordVisit(data: BrowserData, url: string, title: string, now = new Date()): BrowserData {
  const visit = { url, title: title || hostOf(url) || url, visitedAt: now.toISOString() };
  const history = [visit, ...data.history.filter((item) => item.url !== url)].slice(0, MAX_HISTORY);
  const bookmarks = data.bookmarks.map((item) => (item.url === url && title && item.title !== title && item.title === hostOf(url) ? { ...item, title } : item));
  return { ...data, history, bookmarks };
}

/** Address-bar suggestions: bookmarks first, then history, matched on title and URL. */
export function suggest(data: BrowserData, input: string, limit = 6): { url: string; title: string; bookmark: boolean }[] {
  const needle = input.trim().toLowerCase();
  if (!needle) return [];
  const seen = new Set<string>();
  const out: { url: string; title: string; bookmark: boolean }[] = [];
  const consider = (url: string, title: string, bookmark: boolean) => {
    if (seen.has(url) || out.length >= limit) return;
    const hay = `${title} ${url.replace(/^https?:\/\/(www\.)?/, "")}`.toLowerCase();
    if (!hay.includes(needle)) return;
    seen.add(url);
    out.push({ url, title, bookmark });
  };
  for (const item of data.bookmarks) consider(item.url, item.title, true);
  for (const item of data.history) consider(item.url, item.title, false);
  return out;
}

// ── persistence ────────────────────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function str(value: unknown, max = 4000): string {
  return typeof value === "string" ? value.slice(0, max) : "";
}

function validLocation(value: unknown): string | null {
  const location = str(value);
  if (location === "") return location;
  // Older versions kept searches as "search:<query>"; they become results pages.
  if (location.startsWith("search:")) {
    const query = location.slice(7).trim();
    return query ? searchUrl(query) : "";
  }
  return normalizeUrl(location);
}

function parseTab(value: unknown): BrowserTabState | null {
  if (!isRecord(value) || !Array.isArray(value.entries)) return null;
  const entries = value.entries.map(validLocation).filter((item): item is string => item !== null).slice(-MAX_ENTRIES);
  if (!entries.length) entries.push("");
  const index = typeof value.index === "number" && Number.isInteger(value.index) ? Math.max(0, Math.min(entries.length - 1, value.index)) : entries.length - 1;
  const mode: BrowserMode = value.mode === "reader" ? "reader" : "web";
  return { entries, index, title: str(value.title, 300) || titleForLocation(entries[index]), mode };
}

function parseLinks<T extends { url: string; title: string }>(value: unknown, dateKey: "addedAt" | "visitedAt", max: number): T[] {
  if (!Array.isArray(value)) return [];
  const out: T[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!isRecord(item)) continue;
    const url = normalizeUrl(str(item.url));
    if (!url || seen.has(url)) continue;
    seen.add(url);
    out.push({ url, title: str(item.title, 300) || hostOf(url), [dateKey]: str(item[dateKey], 40) } as unknown as T);
    if (out.length >= max) break;
  }
  return out;
}

export function parseBrowserData(raw: string): BrowserData {
  let value: unknown;
  try {
    value = JSON.parse(raw || "{}");
  } catch {
    return emptyBrowserData();
  }
  if (!isRecord(value)) return emptyBrowserData();
  const tabs: Record<string, BrowserTabState> = {};
  if (isRecord(value.tabs)) {
    for (const [id, tab] of Object.entries(value.tabs)) {
      const parsed = parseTab(tab);
      if (parsed && id.startsWith("web:")) tabs[id] = parsed;
    }
  }
  const prefs = isRecord(value.prefs) ? value.prefs : {};
  return {
    tabs,
    bookmarks: parseLinks<BrowserBookmark>(value.bookmarks, "addedAt", MAX_BOOKMARKS),
    history: parseLinks<BrowserVisit>(value.history, "visitedAt", MAX_HISTORY),
    prefs: {
      defaultMode: prefs.defaultMode === "reader" ? "reader" : "web",
      openLinksInApp: typeof prefs.openLinksInApp === "boolean" ? prefs.openLinksInApp : DEFAULT_PREFS.openLinksInApp,
      readerSize: READER_SIZES.includes(prefs.readerSize as number) ? (prefs.readerSize as number) : DEFAULT_PREFS.readerSize,
      clipFolderId: str(prefs.clipFolderId, 100),
      searchEngine: prefs.searchEngine === "custom" || SEARCH_ENGINES.some((engine) => engine.id === prefs.searchEngine) ? (prefs.searchEngine as string) : DEFAULT_PREFS.searchEngine,
      customSearchUrl: str(prefs.customSearchUrl, 1000),
      homePage: normalizeUrl(str(prefs.homePage, 2000)) ?? "",
    },
  };
}

/** Keep only the tabs still open, so closed tabs don't pile up in storage. */
export function serializeBrowserData(data: BrowserData, openTabs: Iterable<string>): string {
  const open = new Set(openTabs);
  const tabs: Record<string, BrowserTabState> = {};
  for (const [id, tab] of Object.entries(data.tabs)) if (open.has(id)) tabs[id] = tab;
  return JSON.stringify({ ...data, tabs });
}

// ── frames ─────────────────────────────────────────────────────────────────

/** Where the app serves web pages for browser tabs (see internal/web/frame.go). */
export const FRAME_PATH = "/__browse";

/**
 * Sites that only work as themselves: their pages need scripts and cookies
 * that can't run through the app, and they allow being framed directly.
 * These load straight from the site; links opened inside them stay there.
 */
const DIRECT_SITES: { root: string; param?: [string, string] }[] = [
  { root: "google.com", param: ["igu", "1"] },
  { root: "bing.com" },
];

function directSite(location: string) {
  const host = hostOf(location);
  return host ? DIRECT_SITES.find((site) => onHost(host, site.root)) : undefined;
}

export function isDirectFrame(location: string): boolean {
  return Boolean(directSite(location));
}

/** The address the page frame loads for a location. */
export function frameSource(location: string): string {
  if (!isWebLocation(location)) return "";
  const site = directSite(location);
  if (site) {
    if (!site.param) return location;
    const url = new URL(location);
    url.searchParams.set(site.param[0], site.param[1]);
    return url.toString();
  }
  // The page's <base> points at the site, so the frame handler needs the
  // app's own origin to write addresses that load through it.
  const app = typeof window === "undefined" ? "" : window.location.origin;
  const appParam = app && app !== "null" ? `&app=${encodeURIComponent(app)}` : "";
  return `${FRAME_PATH}?url=${encodeURIComponent(location)}${appParam}`;
}

/** Drops parameters frameSource added, so the address bar shows the real address. */
export function cleanLocation(location: string): string {
  const site = directSite(location);
  if (!site?.param) return location;
  try {
    const url = new URL(location);
    if (url.searchParams.get(site.param[0]) !== site.param[1]) return location;
    url.searchParams.delete(site.param[0]);
    return url.toString();
  } catch {
    return location;
  }
}

/**
 * Search engines send result clicks through their own redirect pages, which
 * only bounce with scripts that can't run inside the app frame. Go to the
 * result itself instead.
 */
export function unwrapRedirect(location: string): string {
  if (!isWebLocation(location)) return location;
  let url: URL;
  try {
    url = new URL(location);
  } catch {
    return location;
  }
  const host = url.hostname.replace(/^www\./, "");
  let target: string | null = null;
  if (onHost(host, "duckduckgo.com") && url.pathname === "/l/") target = url.searchParams.get("uddg");
  else if (onHost(host, "google.com") && url.pathname === "/url") target = url.searchParams.get("q") ?? url.searchParams.get("url");
  if (!target) return location;
  return normalizeUrl(target) ?? location;
}

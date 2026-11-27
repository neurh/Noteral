import { create } from "zustand";
import { api, errorMessage, type BrowsePage } from "../lib/api";
import { isWebTab, useAppStore } from "../store";
import {
  currentLocation,
  emptyBrowserData,
  go,
  isWebLocation,
  navigate as navigateTab,
  unwrapRedirect,
  newTabState,
  normalizeUrl,
  parseBrowserData,
  recordVisit,
  replaceLocation,
  serializeBrowserData,
  titleForLocation,
  toggleBookmark as toggleBookmarkIn,
  type BrowserData,
  type BrowserMode,
  tidyArticle,
  tidyTitle,
  type BrowserPrefs,
  type BrowserTabState,
} from "./model";

/** The Reader copy of a page, fetched and cleaned by the app. */
export interface ReaderState {
  location: string;
  status: "loading" | "ready" | "error";
  page?: BrowsePage;
  error?: string;
}

/** What a tab is showing right now. Never persisted. */
export interface BrowserView {
  /** The history entry on screen. */
  location: string;
  /** The address the page frame was told to load. Pages that move on their own
   * (redirects, single-page apps) update `location` but not this, so the frame
   * isn't reloaded under them. */
  frameSrc: string;
  /** Bumped by reload so the frame reloads even at the same address. */
  frameKey: number;
  loading: boolean;
  /** HTTP status and error the page frame reported. */
  status?: number;
  error?: string;
  icon?: string;
  reader?: ReaderState;
}

/** A message from the bridge script inside a page frame (internal/web/frame_bridge.js). */
export type FrameMessage =
  | { type: "location"; url: string; status?: number; error?: string; soft?: "push" | "replace" }
  | { type: "page"; url: string; status?: number; error?: string; title?: string; icon?: string }
  | { type: "title"; title?: string };

interface BrowserStore {
  workspaceId: string;
  loaded: boolean;
  data: BrowserData;
  views: Record<string, BrowserView>;
  /** The browser tab state for `tabId`, or a fresh home page. */
  tab: (tabId: string) => BrowserTabState;
  /** Open `location` in a new browser tab (or the given one) and show it. */
  open: (location?: string, options?: { tabId?: string; paneId?: string; background?: boolean }) => string;
  navigate: (tabId: string, location: string, options?: { replace?: boolean }) => void;
  back: (tabId: string) => void;
  forward: (tabId: string) => void;
  reload: (tabId: string) => void;
  /** Go to the home page set in Settings. */
  home: (tabId: string) => void;
  setMode: (tabId: string, mode: BrowserMode) => void;
  /** Handle a bridge message from the tab's page frame. */
  frameMessage: (tabId: string, message: FrameMessage) => void;
  /** The page frame fired load (covers sites loaded directly, which have no bridge). */
  frameLoaded: (tabId: string) => void;
  /** The Reader copy of the tab's page, fetching it if needed. */
  readerPage: (tabId: string) => Promise<BrowsePage | undefined>;
  toggleBookmark: (url: string, title: string) => void;
  removeBookmark: (url: string) => void;
  renameBookmark: (url: string, title: string) => void;
  removeVisit: (url: string) => void;
  clearHistory: () => void;
  setPrefs: (patch: Partial<BrowserPrefs>) => void;
  /** Show the tab's current entry, unless it is already on screen. */
  ensureLoaded: (tabId: string) => void;
}

const CACHE_TTL = 5 * 60_000;
const CACHE_MAX = 40;
const cache = new Map<string, { at: number; page: BrowsePage }>();
const pending = new Map<string, Promise<BrowsePage>>();
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function cached(location: string) {
  const hit = cache.get(location);
  if (!hit) return undefined;
  if (Date.now() - hit.at > CACHE_TTL) {
    cache.delete(location);
    return undefined;
  }
  return hit.page;
}

function remember(location: string, page: BrowsePage) {
  cache.delete(location);
  cache.set(location, { at: Date.now(), page });
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
}

/** Forget cached copies, e.g. in tests. */
export function clearBrowserCache() {
  cache.clear();
  pending.clear();
}

/** Fetch the Reader copy of an address, sharing requests already in flight. */
function fetchReader(location: string, force = false): Promise<BrowsePage> {
  if (!force) {
    const hit = cached(location);
    if (hit) return Promise.resolve(hit);
    const inFlight = pending.get(location);
    if (inFlight) return inFlight;
  }
  const request = api
    .browserLoad(location)
    .then((loaded) => {
      const page = { ...loaded, title: tidyTitle(loaded.title, loaded.finalUrl || location), text: tidyArticle(loaded.text) } as BrowsePage;
      if (!page.error) remember(location, page);
      return page;
    })
    .finally(() => pending.delete(location));
  pending.set(location, request);
  return request;
}

function openWebTabIds(): string[] {
  return useAppStore.getState().tabs.filter(isWebTab);
}

export const useBrowserStore = create<BrowserStore>((set, get) => {
  const scheduleSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = undefined;
      const { workspaceId, data, loaded } = get();
      if (!workspaceId || !loaded) return;
      void api.saveBrowserState(workspaceId, serializeBrowserData(data, openWebTabIds())).catch(() => undefined);
    }, 500);
  };

  const updateData = (update: (data: BrowserData) => BrowserData) => {
    set((state) => ({ data: update(state.data) }));
    scheduleSave();
  };

  const updateTab = (tabId: string, update: (tab: BrowserTabState) => BrowserTabState) => {
    updateData((data) => ({ ...data, tabs: { ...data.tabs, [tabId]: update(data.tabs[tabId] ?? newTabState("", data.prefs.defaultMode)) } }));
  };

  const patchView = (tabId: string, patch: Partial<BrowserView>) =>
    set((state) => {
      const view = state.views[tabId];
      if (!view) return state;
      return { views: { ...state.views, [tabId]: { ...view, ...patch } } };
    });

  /** Put the tab's current entry on screen: point the frame at it, and fetch the Reader copy when Reader is on. */
  const show = (tabId: string, force = false) => {
    const tab = get().tab(tabId);
    const location = currentLocation(tab);
    const previous = get().views[tabId];
    const frameKey = (previous?.frameKey ?? 0) + (force ? 1 : 0);
    set((state) => ({
      views: {
        ...state.views,
        [tabId]: { location, frameSrc: location, frameKey, loading: isWebLocation(location), icon: previous?.location === location ? previous.icon : undefined },
      },
    }));
    if (tab.mode === "reader") void loadReader(tabId, force);
  };

  const loadReader = async (tabId: string, force = false): Promise<BrowsePage | undefined> => {
    const location = currentLocation(get().tab(tabId));
    if (!isWebLocation(location)) return undefined;
    const existing = get().views[tabId]?.reader;
    if (!force && existing?.location === location && existing.status === "ready") return existing.page;
    patchView(tabId, { reader: { location, status: "loading" } });
    try {
      const page = await fetchReader(location, force);
      if (get().views[tabId]?.reader?.location === location) patchView(tabId, { reader: { location, status: "ready", page } });
      if (get().tab(tabId).mode === "reader") finishReader(tabId, location, page);
      return page;
    } catch (error) {
      if (get().views[tabId]?.reader?.location === location) patchView(tabId, { reader: { location, status: "error", error: errorMessage(error) } });
      return undefined;
    }
  };

  /** In Reader, the fetched copy is what's on screen: follow its redirect, title the tab, remember the visit. */
  const finishReader = (tabId: string, location: string, page: BrowsePage) => {
    const final = normalizeUrl(page.finalUrl || "") ?? location;
    const title = titleForLocation(final, page.title);
    updateTab(tabId, (tab) => {
      if (currentLocation(tab) !== location) return tab;
      const moved = final !== location ? replaceLocation(tab, final) : tab;
      return moved.title === title ? moved : { ...moved, title };
    });
    if (final !== location) {
      remember(final, page);
      const view = get().views[tabId];
      if (view?.location === location) patchView(tabId, { location: final, reader: { location: final, status: "ready", page } });
    }
    if (!page.error && isWebLocation(final)) updateData((data) => recordVisit(data, final, page.title));
  };

  const setTitle = (tabId: string, location: string, raw: string) => {
    const title = titleForLocation(location, tidyTitle(raw, location));
    updateTab(tabId, (tab) => (currentLocation(tab) !== location || tab.title === title ? tab : { ...tab, title }));
    return title;
  };

  return {
    workspaceId: "",
    loaded: false,
    data: emptyBrowserData(),
    views: {},

    tab: (tabId) => get().data.tabs[tabId] ?? newTabState("", get().data.prefs.defaultMode),

    open: (location, options = {}) => {
      const target = unwrapRedirect(location ?? get().data.prefs.homePage);
      const app = useAppStore.getState();
      const previous = app.activeTabId;
      const tabId = options.tabId && isWebTab(options.tabId) ? options.tabId : app.openWebTab(options.paneId);
      updateTab(tabId, (tab) => (options.tabId ? navigateTab(tab, target) : { ...newTabState(target, get().data.prefs.defaultMode) }));
      if (options.background && previous && previous !== tabId) useAppStore.getState().selectTab(previous);
      show(tabId);
      return tabId;
    },

    navigate: (tabId, target, options = {}) => {
      const location = unwrapRedirect(target);
      updateTab(tabId, (tab) => (options.replace ? { ...replaceLocation(tab, location), title: titleForLocation(location) } : navigateTab(tab, location)));
      show(tabId);
    },

    back: (tabId) => {
      updateTab(tabId, (tab) => go(tab, -1));
      show(tabId);
    },

    forward: (tabId) => {
      updateTab(tabId, (tab) => go(tab, 1));
      show(tabId);
    },

    reload: (tabId) => show(tabId, true),

    home: (tabId) => get().navigate(tabId, get().data.prefs.homePage),

    setMode: (tabId, mode) => {
      updateTab(tabId, (tab) => ({ ...tab, mode }));
      if (mode === "reader") void loadReader(tabId);
    },

    frameMessage: (tabId, message) => {
      const view = get().views[tabId];
      if (!view) return;
      if (message.type === "title") {
        if (get().tab(tabId).mode !== "reader") setTitle(tabId, view.location, message.title ?? "");
        return;
      }
      const url = normalizeUrl(message.url) ?? "";
      if (!url) return;
      if (message.type === "location") {
        if (url !== view.location) {
          // A redirect, or a single-page site changing its address.
          updateTab(tabId, (tab) => (message.soft === "push" ? navigateTab(tab, url) : replaceLocation(tab, url)));
          patchView(tabId, { location: url });
        }
        if (!message.soft) patchView(tabId, { status: message.status, error: message.error || undefined });
        return;
      }
      // "page": the document is ready.
      if (url !== view.location) {
        updateTab(tabId, (tab) => replaceLocation(tab, url));
        patchView(tabId, { location: url });
      }
      patchView(tabId, { loading: false, status: message.status, error: message.error || undefined, icon: message.icon || undefined });
      if (get().tab(tabId).mode === "reader") return;
      const title = setTitle(tabId, url, message.title ?? "");
      const failed = Boolean(message.error) || (message.status ?? 200) >= 400;
      if (!failed) updateData((data) => recordVisit(data, url, title === titleForLocation(url) ? message.title?.trim() ?? "" : title));
    },

    frameLoaded: (tabId) => {
      const view = get().views[tabId];
      if (view?.loading) patchView(tabId, { loading: false });
    },

    readerPage: (tabId) => loadReader(tabId),

    toggleBookmark: (url, title) => updateData((data) => toggleBookmarkIn(data, url, title)),

    removeBookmark: (url) => updateData((data) => ({ ...data, bookmarks: data.bookmarks.filter((item) => item.url !== url) })),

    renameBookmark: (url, title) =>
      updateData((data) => ({ ...data, bookmarks: data.bookmarks.map((item) => (item.url === url ? { ...item, title: title.trim() || item.title } : item)) })),

    removeVisit: (url) => updateData((data) => ({ ...data, history: data.history.filter((item) => item.url !== url) })),

    clearHistory: () => updateData((data) => ({ ...data, history: [] })),

    setPrefs: (patch) => updateData((data) => ({ ...data, prefs: { ...data.prefs, ...patch } })),

    ensureLoaded: (tabId) => {
      const view = get().views[tabId];
      const location = currentLocation(get().tab(tabId));
      if (view && view.location === location) return;
      show(tabId);
    },
  };
});

/**
 * Load the workspace's browser document whenever the workspace changes.
 * Tabs opened before it arrives are kept.
 */
async function loadWorkspace(workspaceId: string) {
  useBrowserStore.setState({ workspaceId, loaded: false, views: {} });
  let data: BrowserData;
  try {
    data = parseBrowserData(await api.getBrowserState(workspaceId));
  } catch {
    data = emptyBrowserData();
  }
  if (useBrowserStore.getState().workspaceId !== workspaceId) return;
  useBrowserStore.setState((state) => ({ loaded: true, data: { ...data, tabs: { ...data.tabs, ...state.data.tabs } } }));
}

let watching = false;

/** Start following the app's workspace. Safe to call more than once. */
export function startBrowser() {
  if (watching) return;
  watching = true;
  let current = useAppStore.getState().workspace?.id ?? "";
  if (current) void loadWorkspace(current);
  useAppStore.subscribe((state) => {
    const next = state.workspace?.id ?? "";
    if (next === current) return;
    current = next;
    useBrowserStore.setState({ data: emptyBrowserData(), views: {} });
    if (next) void loadWorkspace(next);
  });
}

/** Open a web address in a browser tab: reuses the focused browser tab when asked. */
export function openInBrowser(location: string, options: { reuse?: boolean } = {}) {
  const app = useAppStore.getState();
  const browser = useBrowserStore.getState();
  if (options.reuse && isWebTab(app.activeTabId)) {
    browser.navigate(app.activeTabId, location);
    return app.activeTabId;
  }
  return browser.open(location);
}

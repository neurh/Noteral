import { create } from "zustand";
import { api, errorMessage, list } from "./lib/api";
import type { AppSettings, Bootstrap, Info, PageDocument, PageMeta, Workspace, WorkspaceSnapshot } from "./lib/api";
import { editorBridge, type OutlineItem } from "./lib/editorBridge";
import { applyTheme, resolveTheme, type ResolvedTheme } from "./lib/theme";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type Overlay = "palette" | "library" | "plugins" | "settings" | "workspaces" | null;
export type LeftTab = "tree" | "favorites" | "recent";
export type RightTab = "outline" | "backlinks" | "info";

export interface LoadedDocument {
  id: string;
  workspaceId: string;
  parentId: string;
  title: string;
  icon: string;
  docJson: string;
  loadVersion: number;
  revision: number;
  createdAt: string;
  updatedAt: string;
  saveState: SaveState;
  error?: string;
  wordCount: number;
  blockCount: number;
}

export interface Toast {
  id: number;
  message: string;
  kind: "info" | "success" | "error";
}

export const defaultSettings: AppSettings = {
  theme: "system",
  leftWidth: 272,
  rightWidth: 296,
  leftOpen: true,
  rightOpen: true,
  railOpen: true,
  editorFont: "serif",
  fontSize: 17,
  lineHeight: 1.68,
  pageWidth: 780,
  autosaveDelay: 700,
  spellcheck: true,
  reduceMotion: false,
  showStats: true,
};

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function normalizeSettings(input: Partial<AppSettings> | null | undefined): AppSettings {
  const merged = { ...defaultSettings, ...(input ?? {}) };
  return {
    ...merged,
    editorFont: merged.editorFont === "sans" ? "sans" : "serif",
    fontSize: Math.round(clamp(merged.fontSize, 15, 20, 17)),
    lineHeight: Math.round(clamp(merged.lineHeight, 1.45, 1.9, 1.68) * 100) / 100,
    pageWidth: Math.round(clamp(merged.pageWidth, 640, 900, 780)),
    autosaveDelay: Math.round(clamp(merged.autosaveDelay, 300, 2000, 700)),
  };
}

interface AppState {
  status: "loading" | "ready" | "error";
  bootError: string;
  bootstrap: Bootstrap | null;
  workspaces: Workspace[];
  workspace: Workspace | null;
  pages: PageMeta[];
  favorites: string[];
  recent: PageMeta[];
  tabs: string[];
  activePageId: string;
  documents: Record<string, LoadedDocument>;
  settings: AppSettings;
  resolvedTheme: ResolvedTheme;
  outline: OutlineItem[];
  backlinks: PageMeta[];
  liveWordCount: number;
  liveBlockCount: number;
  leftTab: LeftTab;
  rightTab: RightTab;
  overlay: Overlay;
  plugins: Info[];
  pluginRevision: number;
  toasts: Toast[];
  busy: boolean;

  bootstrapApp: () => Promise<void>;
  openWorkspace: (id: string) => Promise<void>;
  createWorkspace: (name: string) => Promise<void>;
  renameWorkspace: (id: string, name: string) => Promise<void>;
  refreshWorkspaces: () => Promise<void>;
  selectPage: (pageId: string) => Promise<void>;
  ensurePageLoaded: (pageId: string) => Promise<LoadedDocument | null>;
  reloadPage: (pageId: string) => Promise<void>;
  createPage: (parentId?: string) => Promise<void>;
  closeTab: (pageId: string) => Promise<void>;
  renamePage: (pageId: string, title: string) => Promise<void>;
  deletePage: (pageId: string) => Promise<void>;
  movePage: (pageId: string, newParentId: string, beforeId: string) => Promise<void>;
  toggleFavorite: (pageId: string) => Promise<void>;
  reorderTabs: (from: number, to: number) => void;
  markDirty: (pageId: string, stats: { wordCount: number; blockCount: number; outline: OutlineItem[] }) => void;
  saveNow: (pageId: string) => Promise<boolean>;
  saveDocument: (pageId: string) => Promise<boolean>;
  saveAll: () => Promise<boolean>;
  persistTabsNow: () => Promise<void>;
  persistSettingsNow: () => Promise<void>;
  refreshBacklinks: () => Promise<void>;
  setOutline: (pageId: string, outline: OutlineItem[]) => void;
  setLiveStats: (pageId: string, wordCount: number, blockCount: number) => void;
  updateSettings: (patch: Partial<AppSettings>, persist?: boolean) => void;
  setTheme: (theme: string) => void;
  setLeftTab: (tab: LeftTab) => void;
  setRightTab: (tab: RightTab) => void;
  setOverlay: (overlay: Overlay) => void;
  loadPlugins: () => Promise<void>;
  bumpPlugins: () => void;
  notify: (message: string, kind?: Toast["kind"]) => void;
  dismissToast: (id: number) => void;
}

let tabTimer: ReturnType<typeof setTimeout> | null = null;
let settingsTimer: ReturnType<typeof setTimeout> | null = null;
const saveTimers = new Map<string, ReturnType<typeof setTimeout>>();
const saveChains = new Map<string, Promise<boolean>>();
const editVersions = new Map<string, number>();
const savedVersions = new Map<string, number>();
const pageLoads = new Map<string, Promise<LoadedDocument | null>>();
let toastSequence = 0;

function normalizeSnapshot(snapshot: WorkspaceSnapshot, previous?: AppState): { pages: PageMeta[]; tabs: string[]; active: string; favorites: string[]; recent: PageMeta[] } {
  const pages = list(snapshot.pages);
  const known = new Set(pages.map((page) => page.id));
  let tabs = list(snapshot.tabs).filter((id) => known.has(id));
  let active = snapshot.activePageId;
  if (!tabs.includes(active)) active = tabs[0] ?? "";
  if (!active && pages.length > 0) {
    const preferred = previous?.activePageId && known.has(previous.activePageId) ? previous.activePageId : pages[0].id;
    tabs = [preferred];
    active = preferred;
  }
  return { pages, tabs, active, favorites: list(snapshot.favorites).filter((id) => known.has(id)), recent: list(snapshot.recent) };
}

function parseDocument(doc: PageDocument, workspaceId: string): LoadedDocument {
  return {
    id: doc.id,
    workspaceId,
    parentId: doc.parentId ?? "",
    title: doc.title,
    icon: doc.icon ?? "",
    docJson: doc.docJson,
    loadVersion: 0,
    revision: doc.revision ?? 0,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    saveState: "saved",
    wordCount: 0,
    blockCount: 0,
  };
}

function scheduleTabs(get: () => AppState) {
  if (tabTimer) clearTimeout(tabTimer);
  tabTimer = setTimeout(() => {
    tabTimer = null;
    void get().persistTabsNow();
  }, 450);
}

function scheduleSettings(get: () => AppState) {
  if (settingsTimer) clearTimeout(settingsTimer);
  settingsTimer = setTimeout(() => {
    settingsTimer = null;
    void get().persistSettingsNow();
  }, 500);
}

function scheduleSave(get: () => AppState, pageId: string, delay = 700) {
  const existing = saveTimers.get(pageId);
  if (existing) clearTimeout(existing);
  saveTimers.set(
    pageId,
    setTimeout(() => {
      saveTimers.delete(pageId);
      void get().saveNow(pageId);
    }, delay),
  );
}

function clearTimersFor(pageId: string) {
  const timer = saveTimers.get(pageId);
  if (timer) clearTimeout(timer);
  saveTimers.delete(pageId);
}

export const useAppStore = create<AppState>((set, get) => ({
  status: "loading",
  bootError: "",
  bootstrap: null,
  workspaces: [],
  workspace: null,
  pages: [],
  favorites: [],
  recent: [],
  tabs: [],
  activePageId: "",
  documents: {},
  settings: defaultSettings,
  resolvedTheme: "light",
  outline: [],
  backlinks: [],
  liveWordCount: 0,
  liveBlockCount: 0,
  leftTab: "tree",
  rightTab: "outline",
  overlay: null,
  plugins: [],
  pluginRevision: 0,
  toasts: [],
  busy: false,

  bootstrapApp: async () => {
    try {
      applyTheme("light");
      const boot = await api.bootstrap();
      const settings = normalizeSettings(boot.settings);
      const resolved = resolveTheme(settings.theme);
      applyTheme(resolved);
      const workspaces = list(boot.workspaces);
      set({ bootstrap: boot, settings, resolvedTheme: resolved, workspaces });
      let target = workspaces.find((item) => item.id === boot.lastWorkspaceId) ?? workspaces[0];
      if (!target) {
        const snapshot = await api.createWorkspace("Default Workspace");
        target = snapshot.workspace;
        set({ workspaces: [target] });
        await get().openWorkspace(target.id);
      } else {
        await get().openWorkspace(target.id);
      }
      set({ status: "ready", busy: false });
      void get().loadPlugins();
    } catch (error) {
      set({ status: "error", bootError: errorMessage(error), busy: false });
      console.error("Noteral failed to start", error);
    }
  },

  openWorkspace: async (id) => {
    if (get().busy) return;
    const current = get().workspace;
    if (current?.id === id && get().status === "ready" && get().pages.length > 0) return;
    set({ busy: true });
    try {
      const saved = await get().saveAll();
      if (!saved && get().workspace) {
        get().notify("Could not save the current note; workspace switch cancelled.", "error");
        set({ busy: false });
        return;
      }
      if (tabTimer) {
        clearTimeout(tabTimer);
        tabTimer = null;
      }
      const snapshot = await api.openWorkspace(id);
      const workspaces = list(await api.listWorkspaces());
      const normalized = normalizeSnapshot(snapshot, get());
      pageLoads.clear();
      saveChains.clear();
      editVersions.clear();
      savedVersions.clear();
      set({
        workspace: snapshot.workspace,
        workspaces,
        pages: normalized.pages,
        favorites: normalized.favorites,
        recent: normalized.recent,
        tabs: normalized.tabs,
        activePageId: normalized.active,
        documents: {},
        outline: [],
        backlinks: [],
        liveWordCount: 0,
        liveBlockCount: 0,
      });
      const loaded = await Promise.all(normalized.tabs.map((pageId) => get().ensurePageLoaded(pageId)));
      if (normalized.active) {
        await get().ensurePageLoaded(normalized.active);
        void get().refreshBacklinks();
      }
      if (loaded.some((item) => !item) && normalized.tabs.length > 0) {
        get().notify("Some tabs could not be restored.", "error");
      }
      scheduleTabs(get);
      set({ busy: false });
    } catch (error) {
      set({ busy: false });
      get().notify(errorMessage(error), "error");
    }
  },

  createWorkspace: async (name) => {
    try {
      const saved = await get().saveAll();
      if (!saved && get().workspace) {
        get().notify("Could not save the current note; workspace creation cancelled.", "error");
        return;
      }
      if (tabTimer) {
        clearTimeout(tabTimer);
        tabTimer = null;
      }
      const snapshot = await api.createWorkspace(name);
      const workspaces = list(await api.listWorkspaces());
      set({ workspaces, workspace: snapshot.workspace });
      for (const timer of saveTimers.values()) clearTimeout(timer);
      saveTimers.clear();
      saveChains.clear();
      pageLoads.clear();
      editVersions.clear();
      savedVersions.clear();
      const normalized = normalizeSnapshot(snapshot, get());
      set({
        pages: normalized.pages,
        favorites: normalized.favorites,
        recent: normalized.recent,
        tabs: normalized.tabs,
        activePageId: normalized.active,
        documents: {},
        outline: [],
        backlinks: [],
        liveWordCount: 0,
        liveBlockCount: 0,
      });
      await Promise.all(normalized.tabs.map((pageId) => get().ensurePageLoaded(pageId)));
      if (normalized.active) void get().refreshBacklinks();
      scheduleTabs(get);
      get().notify(`Created ${snapshot.workspace.name}`, "success");
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  renameWorkspace: async (id, name) => {
    try {
      const workspace = await api.renameWorkspace(id, name);
      set({
        workspaces: get().workspaces.map((item) => (item.id === workspace.id ? workspace : item)),
        workspace: get().workspace?.id === workspace.id ? workspace : get().workspace,
      });
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  ensurePageLoaded: async (pageId) => {
    const existing = get().documents[pageId];
    if (existing) return existing;
    const pending = pageLoads.get(pageId);
    if (pending) return pending;
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return null;
    const promise = (async () => {
      try {
        const doc = await api.openPage(workspaceId, pageId);
        if (get().workspace?.id !== workspaceId) return null;
        const loaded = parseDocument(doc, workspaceId);
        editVersions.set(pageId, 0);
        savedVersions.set(pageId, 0);
        set((state) => ({ documents: { ...state.documents, [pageId]: loaded } }));
        return loaded;
      } catch (error) {
        get().notify(errorMessage(error), "error");
        return null;
      } finally {
        pageLoads.delete(pageId);
      }
    })();
    pageLoads.set(pageId, promise);
    return promise;
  },

  reloadPage: async (pageId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    clearTimersFor(pageId);
    const doc = await api.openPage(workspaceId, pageId);
    if (get().workspace?.id !== workspaceId) return;
    const loaded = parseDocument(doc, workspaceId);
    loaded.loadVersion = (get().documents[pageId]?.loadVersion ?? 0) + 1;
    editVersions.set(pageId, 0);
    savedVersions.set(pageId, 0);
    set((state) => ({ documents: { ...state.documents, [pageId]: loaded }, outline: [] }));
  },

  selectPage: async (pageId) => {
    const page = get().pages.find((item) => item.id === pageId);
    if (!page) return;
    let tabs = get().tabs;
    if (!tabs.includes(pageId)) {
      tabs = [...tabs, pageId];
      set({ tabs });
    }
    set({
      activePageId: pageId,
      outline: [],
      backlinks: [],
      liveWordCount: 0,
      liveBlockCount: 0,
      recent: [page, ...get().recent.filter((item) => item.id !== pageId)].slice(0, 12),
    });
    await get().ensurePageLoaded(pageId);
    void get().refreshBacklinks();
    scheduleTabs(get);
  },

  createPage: async (parentId = "") => {
    try {
      const active = get().activePageId;
      if (active) await get().saveNow(active);
      const workspaceId = get().workspace?.id;
      if (!workspaceId) return;
      const doc = await api.createPage(workspaceId, parentId);
      const loaded = parseDocument(doc, workspaceId);
      editVersions.set(loaded.id, 0);
      savedVersions.set(loaded.id, 0);
      set((state) => {
        const meta: PageMeta = {
          id: loaded.id,
          parentId: loaded.parentId,
          title: loaded.title,
          icon: loaded.icon,
          position: Math.max(0, ...state.pages.map((page) => page.position)) + 1024,
          updatedAt: loaded.updatedAt,
        };
        return {
          pages: [...state.pages, meta],
          documents: { ...state.documents, [loaded.id]: loaded },
          tabs: state.tabs.includes(loaded.id) ? state.tabs : [...state.tabs, loaded.id],
          activePageId: loaded.id,
          outline: [],
          backlinks: [],
          recent: [meta, ...state.recent.filter((item) => item.id !== loaded.id)].slice(0, 12),
        };
      });
      scheduleTabs(get);
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  closeTab: async (pageId) => {
    clearTimersFor(pageId);
    const ok = await get().saveNow(pageId);
    if (!ok) return;
    const tabs = get().tabs;
    const index = tabs.indexOf(pageId);
    if (index < 0) return;
    const nextTabs = tabs.filter((id) => id !== pageId);
    let active = get().activePageId;
    if (active === pageId) {
      active = nextTabs[Math.max(0, index - 1)] ?? nextTabs[0] ?? "";
    }
    set({ tabs: nextTabs, activePageId: active, outline: [], backlinks: [] });
    if (active) {
      await get().ensurePageLoaded(active);
      void get().refreshBacklinks();
    }
    scheduleTabs(get);
  },

  renamePage: async (pageId, title) => {
    const clean = title.trim().slice(0, 300) || "Untitled";
    const current = get().pages.find((item) => item.id === pageId);
    if (current && current.title === clean) return;
    set((state) => ({
      pages: state.pages.map((item) => (item.id === pageId ? { ...item, title: clean } : item)),
      documents: state.documents[pageId]
        ? { ...state.documents, [pageId]: { ...state.documents[pageId], title: clean } }
        : state.documents,
    }));
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      const meta = await api.renamePage(workspaceId, pageId, clean);
      if (get().workspace?.id !== workspaceId) return;
      set((state) => ({
        pages: state.pages.map((item) => (item.id === pageId ? meta : item)),
        documents: state.documents[pageId]
          ? { ...state.documents, [pageId]: { ...state.documents[pageId], title: meta.title } }
          : state.documents,
        recent: state.recent.map((item) => (item.id === pageId ? { ...item, title: meta.title } : item)),
      }));
      if (get().activePageId === pageId) void get().refreshBacklinks();
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  deletePage: async (pageId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      await get().saveNow(pageId);
      const snapshot = await api.deletePage(workspaceId, pageId);
      if (get().workspace?.id !== workspaceId) return;
      clearTimersFor(pageId);
      pageLoads.delete(pageId);
      editVersions.delete(pageId);
      savedVersions.delete(pageId);
      const normalized = normalizeSnapshot(snapshot, get());
      const documents = { ...get().documents };
      delete documents[pageId];
      set({
        pages: normalized.pages,
        favorites: normalized.favorites,
        recent: normalized.recent,
        tabs: normalized.tabs,
        activePageId: normalized.active,
        documents,
        outline: [],
        backlinks: [],
      });
      if (normalized.active) {
        await get().ensurePageLoaded(normalized.active);
        void get().refreshBacklinks();
      }
      scheduleTabs(get);
      get().notify("Page moved to trash.", "info");
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  movePage: async (pageId, newParentId, beforeId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      const pages = await api.movePage(workspaceId, pageId, newParentId, beforeId);
      if (get().workspace?.id !== workspaceId) return;
      set({ pages: list(pages) });
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  toggleFavorite: async (pageId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      const favorite = await api.toggleFavorite(workspaceId, pageId);
      set((state) => ({
        favorites: favorite ? [...state.favorites, pageId] : state.favorites.filter((id) => id !== pageId),
      }));
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  reorderTabs: (from, to) => {
    if (from === to || from < 0 || to < 0) return;
    const tabs = [...get().tabs];
    if (from >= tabs.length || to >= tabs.length) return;
    const [moved] = tabs.splice(from, 1);
    tabs.splice(to, 0, moved);
    set({ tabs });
    scheduleTabs(get);
  },

  markDirty: (pageId, stats) => {
    const doc = get().documents[pageId];
    if (!doc) return;
    const nextVersion = (editVersions.get(pageId) ?? 0) + 1;
    editVersions.set(pageId, nextVersion);
    const active = get().activePageId === pageId;
    if (active) {
      set({ liveWordCount: stats.wordCount, liveBlockCount: stats.blockCount, outline: stats.outline });
    }
    if (doc.error) {
      set((state) => ({ documents: { ...state.documents, [pageId]: { ...doc, saveState: "error" } } }));
      return;
    }
    set((state) => ({
      documents: {
        ...state.documents,
        [pageId]: { ...state.documents[pageId], saveState: "dirty", wordCount: stats.wordCount, blockCount: stats.blockCount },
      },
    }));
    scheduleSave(get, pageId, get().settings.autosaveDelay);
  },

  saveNow: (pageId) => {
    const previous = saveChains.get(pageId) ?? Promise.resolve(true);
    const next = previous.catch(() => false).then(() => get().saveDocument(pageId));
    saveChains.set(pageId, next);
    void next.finally(() => {
      if (saveChains.get(pageId) === next) saveChains.delete(pageId);
    });
    return next;
  },

  saveDocument: async (pageId) => {
    const state = get();
    const doc = state.documents[pageId];
    if (!doc) return true;
    const workspaceId = state.workspace?.id;
    if (!workspaceId || doc.workspaceId !== workspaceId) return true;
    const handle = editorBridge.get(pageId);
    if (!handle) return true;
    const version = editVersions.get(pageId) ?? 0;
    if (version <= (savedVersions.get(pageId) ?? -1) && doc.saveState !== "dirty") return true;
    let json: string;
    try {
      json = handle.getJSON();
    } catch (error) {
      get().notify(errorMessage(error), "error");
      return false;
    }
    set((current) => ({
      documents: {
        ...current.documents,
        [pageId]: { ...current.documents[pageId], saveState: "saving", error: undefined },
      },
    }));
    try {
      const result = await api.savePage(workspaceId, pageId, json, doc.revision);
      if (get().workspace?.id !== workspaceId) return true;
      savedVersions.set(pageId, version);
      const hasNewerEdits = (editVersions.get(pageId) ?? 0) > version;
      set((current) => {
        const live = current.documents[pageId];
        if (!live) return current;
        return {
          documents: {
            ...current.documents,
            [pageId]: {
              ...live,
              revision: result.revision,
              updatedAt: result.updatedAt,
              // A fast typist may have edited while the request was in flight.
              saveState: hasNewerEdits ? "dirty" : "saved",
              error: undefined,
              wordCount: hasNewerEdits ? live.wordCount : result.wordCount,
              blockCount: hasNewerEdits ? live.blockCount : result.blockCount,
            },
          },
          pages: current.pages.map((page) =>
            page.id === pageId ? { ...page, updatedAt: result.updatedAt, title: live.title } : page,
          ),
        };
      });
      if (!hasNewerEdits && get().activePageId === pageId) {
        set({ liveWordCount: result.wordCount, liveBlockCount: result.blockCount });
        void get().refreshBacklinks();
      }
      if (hasNewerEdits) scheduleSave(get, pageId);
      return true;
    } catch (error) {
      const message = errorMessage(error);
      set((current) => {
        const live = current.documents[pageId];
        if (!live) return current;
        return {
          documents: { ...current.documents, [pageId]: { ...live, saveState: "error", error: message } },
        };
      });
      get().notify(`Save failed: ${message}`, "error");
      return false;
    }
  },

  saveAll: async () => {
    const state = get();
    const dirty = Object.keys(state.documents).filter((pageId) => {
      const version = editVersions.get(pageId) ?? 0;
      const saved = savedVersions.get(pageId) ?? -1;
      return version > saved || state.documents[pageId].saveState === "saving" || state.documents[pageId].saveState === "dirty";
    });
    const results = await Promise.all(dirty.map((pageId) => get().saveNow(pageId)));
    await get().persistTabsNow();
    await get().persistSettingsNow();
    return results.every(Boolean);
  },

  persistTabsNow: async () => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      await api.saveTabs(workspaceId, get().tabs, get().activePageId);
    } catch (error) {
      console.warn("Could not save tabs", error);
    }
  },

  persistSettingsNow: async () => {
    try {
      await api.saveSettings(get().settings);
    } catch (error) {
      console.warn("Could not save settings", error);
    }
  },

  refreshWorkspaces: async () => {
    try {
      set({ workspaces: list(await api.listWorkspaces()) });
    } catch (error) {
      console.warn("Could not refresh workspaces", error);
    }
  },

  refreshBacklinks: async () => {
    const workspaceId = get().workspace?.id;
    const pageId = get().activePageId;
    if (!workspaceId || !pageId) {
      set({ backlinks: [] });
      return;
    }
    try {
      const backlinks = list(await api.getBacklinks(workspaceId, pageId));
      if (get().workspace?.id === workspaceId && get().activePageId === pageId) set({ backlinks });
    } catch (error) {
      console.warn("Could not load backlinks", error);
    }
  },

  setOutline: (pageId, outline) => {
    if (get().activePageId === pageId) set({ outline });
  },

  setLiveStats: (pageId, wordCount, blockCount) => {
    if (get().activePageId === pageId) set({ liveWordCount: wordCount, liveBlockCount: blockCount });
  },

  updateSettings: (patch, persist = true) => {
    const settings = normalizeSettings({ ...get().settings, ...patch });
    const resolved = resolveTheme(settings.theme);
    set({ settings, resolvedTheme: resolved });
    applyTheme(resolved);
    if (persist) scheduleSettings(get);
  },

  setTheme: (theme) => {
    get().updateSettings({ theme });
  },

  setLeftTab: (leftTab) => set({ leftTab }),
  setRightTab: (rightTab) => set({ rightTab }),
  setOverlay: (overlay) => set({ overlay }),

  loadPlugins: async () => {
    try {
      const plugins = list(await api.listPlugins());
      set({ plugins, pluginRevision: get().pluginRevision + 1 });
    } catch (error) {
      console.warn("Could not load plugins", error);
    }
  },

  bumpPlugins: () => set({ pluginRevision: get().pluginRevision + 1 }),

  notify: (message, kind = "info") => {
    const id = ++toastSequence;
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }].slice(-4) }));
    setTimeout(() => get().dismissToast(id), 4600);
  },

  dismissToast: (id) => set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) })),
}));

export function activeDocument(state: AppState): LoadedDocument | null {
  return state.activePageId ? state.documents[state.activePageId] ?? null : null;
}

export function activePage(state: AppState): PageMeta | null {
  return state.activePageId ? state.pages.find((page) => page.id === state.activePageId) ?? null : null;
}

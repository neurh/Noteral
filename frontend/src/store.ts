import { create } from "zustand";
import { api, errorMessage, list } from "./lib/api";
import type { AppSettings, Bootstrap, Info, PageDocument, PageMeta, Workspace, WorkspaceSnapshot } from "./lib/api";
import { editorBridge, type OutlineItem } from "./lib/editorBridge";
import { applyTheme, resolveTheme, type ResolvedTheme } from "./lib/theme";
import { defaultHomeTabSettings, normalizeHomeTabSettings, type HomeTabSettings } from "./lib/home";
import {
  addTab as addTabToPane,
  applySplitDelta,
  createPane,
  findPane,
  firstPane,
  flatTabs,
  layoutFromTabs,
  moveTab as moveTabInLayout,
  paneList,
  paneOfTab,
  removeTab as removeTabFromLayout,
  removePane as removePaneFromLayout,
  resetSplit as resetSplitLayout,
  restoreLayout as restoreLayoutFromRaw,
  serializeLayout,
  splitPaneWith,
  splitWithTab,
  updatePane,
  type LayoutNode,
  type PaneDropZone,
  type SplitSide,
} from "./lib/panes";

export type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
export type Overlay = "palette" | "library" | "plugins" | "settings" | "workspaces" | null;
export type LeftTab = "tree" | "favorites" | "recent" | "trash";
export type RightTab = "outline" | "backlinks" | "info";

export interface LoadedDocument {
  id: string;
  workspaceId: string;
  parentId: string;
  title: string;
  icon: string;
  cover: string;
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
  fullWidth: false,
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
  homeTabs: Record<string, HomeTabSettings>;
  layout: LayoutNode;
  focusedPaneId: string;
  maximizedPaneId: string;
  trash: PageMeta[];
  activeTabId: string;
  activePageId: string;
  history: string[];
  historyIndex: number;
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
  selectPage: (pageId: string, options?: { recordHistory?: boolean }) => Promise<void>;
  selectTab: (tabId: string) => void;
  openHomeTab: (settings?: Partial<HomeTabSettings>, paneId?: string) => void;
  updateHomeTab: (tabId: string, patch: Partial<HomeTabSettings>) => void;
  focusPane: (paneId: string) => void;
  moveTab: (tabId: string, targetPaneId: string, beforeTabId: string | null) => void;
  dropTabInPane: (tabId: string, targetPaneId: string, zone: PaneDropZone) => void;
  splitPane: (paneId: string, side: SplitSide) => void;
  toggleMaximize: (paneId: string) => void;
  closePane: (paneId: string) => void;
  resizeSplit: (splitId: string, index: number, delta: number) => void;
  resetSplit: (splitId: string) => void;
  goBack: () => void;
  goForward: () => void;
  ensurePageLoaded: (pageId: string) => Promise<LoadedDocument | null>;
  reloadPage: (pageId: string) => Promise<void>;
  createPage: (parentId?: string) => Promise<void>;
  closeTab: (pageId: string) => Promise<void>;
  renamePage: (pageId: string, title: string) => Promise<void>;
  setPageAppearance: (pageId: string, icon: string, cover: string) => Promise<void>;
  trashPage: (pageId: string) => Promise<void>;
  restorePage: (pageId: string) => Promise<void>;
  deletePagePermanently: (pageId: string) => Promise<void>;
  emptyTrash: () => Promise<void>;
  duplicatePage: (pageId: string) => Promise<void>;
  movePage: (pageId: string, newParentId: string, beforeId: string) => Promise<void>;
  toggleFavorite: (pageId: string) => Promise<void>;
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
const HOME_TAB_PREFIX = "home:";
let homeTabSequence = 0;

export function isHomeTab(tabId: string): boolean {
  return tabId.startsWith(HOME_TAB_PREFIX);
}

function createHomeTabId(): string {
  homeTabSequence += 1;
  return `${HOME_TAB_PREFIX}${Date.now().toString(36)}-${homeTabSequence.toString(36)}`;
}

function pageIdForTab(tabId: string): string {
  return tabId && !isHomeTab(tabId) ? tabId : "";
}

function pageTabs(tabs: string[]): string[] {
  return tabs.filter((tabId) => !isHomeTab(tabId));
}

function withoutHomeTab(settings: Record<string, HomeTabSettings>, tabId: string): Record<string, HomeTabSettings> {
  if (!isHomeTab(tabId) || !(tabId in settings)) return settings;
  const next = { ...settings };
  delete next[tabId];
  return next;
}

/** Insert or reveal `pageId` in the pane the user is working in. */
function openTabInLayout(
  state: AppState,
  pageId: string,
): { layout: LayoutNode; focusedPaneId: string; replacedHomeTab: string } {
  const existing = paneOfTab(state.layout, pageId);
  if (existing) {
    return {
      layout: updatePane(state.layout, existing.id, (pane) => ({ ...pane, activeTabId: pageId })),
      focusedPaneId: existing.id,
      replacedHomeTab: "",
    };
  }
  const focused = findPane(state.layout, state.focusedPaneId) ?? firstPane(state.layout);
  if (focused && isHomeTab(focused.activeTabId) && focused.tabs.includes(focused.activeTabId)) {
    const replacedHomeTab = focused.activeTabId;
    return {
      layout: updatePane(state.layout, focused.id, (pane) => ({
        ...pane,
        tabs: pane.tabs.map((tabId) => (tabId === replacedHomeTab ? pageId : tabId)),
        activeTabId: pageId,
      })),
      focusedPaneId: focused.id,
      replacedHomeTab,
    };
  }
  const layout = addTabToPane(state.layout, focused?.id ?? "", pageId);
  const pane = paneOfTab(layout, pageId);
  return { layout, focusedPaneId: pane?.id ?? "", replacedHomeTab: "" };
}

/** Derive the flat tab list, focused pane and active tab from a layout. */
function layoutPatch(
  state: AppState,
  layout: LayoutNode,
  focusedPaneId?: string,
  maximizedPaneId?: string,
): Partial<AppState> {
  const panes = paneList(layout);
  if (panes.length === 0) return {};
  const requestedMax = maximizedPaneId ?? state.maximizedPaneId;
  const focused =
    panes.find((pane) => pane.id === focusedPaneId) ??
    panes.find((pane) => pane.id === state.focusedPaneId) ??
    panes[0];
  const tabs = flatTabs(layout);
  const activeTabId = focused.activeTabId && tabs.includes(focused.activeTabId) ? focused.activeTabId : tabs[0] ?? "";
  const activePageId = pageIdForTab(activeTabId);
  const patch: Partial<AppState> = {
    layout,
    tabs,
    focusedPaneId: focused.id,
    maximizedPaneId: panes.length > 1 && panes.some((pane) => pane.id === requestedMax) ? requestedMax : "",
    activeTabId,
    activePageId,
  };
  if (activePageId !== state.activePageId) {
    patch.outline = [];
    patch.backlinks = [];
    patch.liveWordCount = 0;
    patch.liveBlockCount = 0;
  }
  return patch;
}

function normalizeSnapshot(snapshot: WorkspaceSnapshot): { pages: PageMeta[]; tabs: string[]; homeTabs: Record<string, HomeTabSettings>; activeTabId: string; active: string; favorites: string[]; recent: PageMeta[]; trash: PageMeta[]; layout: LayoutNode; focusedPaneId: string; maximizedPaneId: string } {
  const pages = list(snapshot.pages);
  const known = new Set(pages.map((page) => page.id));
  const seen = new Set<string>();
  let tabs = list(snapshot.tabs).filter((id) => {
    if (seen.has(id)) return false;
    if (!isHomeTab(id) && !known.has(id)) return false;
    seen.add(id);
    return true;
  });
  let activeTabId = snapshot.activeTabId || snapshot.activePageId;
  if (!tabs.includes(activeTabId)) {
    activeTabId = tabs.includes(snapshot.activePageId) ? snapshot.activePageId : tabs[0] ?? "";
  }
  if (!activeTabId) {
    activeTabId = createHomeTabId();
    tabs = [activeTabId];
  }
  const homeTabs: Record<string, HomeTabSettings> = {};
  for (const tabId of tabs) {
    if (isHomeTab(tabId)) homeTabs[tabId] = normalizeHomeTabSettings(snapshot.homeTabs?.[tabId]);
  }
  const restored = restoreLayoutFromRaw(snapshot.layout, tabs, activeTabId);
  return {
    pages,
    tabs,
    homeTabs,
    activeTabId: restored.activeTabId,
    active: pageIdForTab(restored.activeTabId),
    layout: restored.layout,
    focusedPaneId: restored.focusedPaneId,
    maximizedPaneId: restored.maximizedPaneId,
    favorites: list(snapshot.favorites).filter((id) => known.has(id)),
    recent: list(snapshot.recent),
    trash: list(snapshot.trash),
  };
}

function snapshotPatch(snapshot: WorkspaceSnapshot, state: AppState): Partial<AppState> {
  const normalized = normalizeSnapshot(snapshot);
  const live = new Set(normalized.pages.map((page) => page.id));
  const documents: Record<string, LoadedDocument> = {};
  for (const [id, doc] of Object.entries(state.documents)) {
    if (live.has(id)) {
      documents[id] = doc;
      continue;
    }
    clearTimersFor(id);
    pageLoads.delete(id);
    editVersions.delete(id);
    savedVersions.delete(id);
  }
  const aligned = alignHistory(
    state.history.filter((id) => live.has(id)),
    normalized.active,
  );
  const patch: Partial<AppState> = {
    pages: normalized.pages,
    favorites: normalized.favorites,
    recent: normalized.recent,
    tabs: normalized.tabs,
    homeTabs: normalized.homeTabs,
    layout: normalized.layout,
    focusedPaneId: normalized.focusedPaneId,
    maximizedPaneId: normalized.maximizedPaneId,
    activeTabId: normalized.activeTabId,
    activePageId: normalized.active,
    history: aligned.history,
    historyIndex: aligned.historyIndex,
    trash: normalized.trash,
    documents,
  };
  if (normalized.active !== state.activePageId) {
    patch.outline = [];
    patch.backlinks = [];
    patch.liveWordCount = 0;
    patch.liveBlockCount = 0;
  }
  return patch;
}

function activatePagePatch(state: AppState, pageId: string): Partial<AppState> {
  const page = state.pages.find((item) => item.id === pageId);
  if (!page) return {};
  const pushed = pushHistory(state.history, state.historyIndex, pageId);
  const opened = openTabInLayout(state, pageId);
  return {
    ...layoutPatch(state, opened.layout, opened.focusedPaneId),
    homeTabs: opened.replacedHomeTab ? withoutHomeTab(state.homeTabs, opened.replacedHomeTab) : state.homeTabs,
    history: pushed.history,
    historyIndex: pushed.historyIndex,
    recent: [page, ...state.recent.filter((item) => item.id !== pageId)].slice(0, 12),
  };
}

function parseDocument(doc: PageDocument, workspaceId: string): LoadedDocument {
  return {
    id: doc.id,
    workspaceId,
    parentId: doc.parentId ?? "",
    title: doc.title,
    icon: doc.icon ?? "",
    cover: doc.cover ?? "",
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

function pushHistory(history: string[], index: number, pageId: string): { history: string[]; historyIndex: number } {
  if (history[index] === pageId) return { history, historyIndex: index };
  const next = [...history.slice(0, index + 1), pageId];
  return { history: next, historyIndex: next.length - 1 };
}

function alignHistory(history: string[], active: string): { history: string[]; historyIndex: number } {
  const index = history.lastIndexOf(active);
  if (index >= 0) return { history, historyIndex: index };
  if (!active) return { history, historyIndex: history.length - 1 };
  return { history: [...history, active], historyIndex: history.length };
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
  homeTabs: {},
  layout: createPane(),
  focusedPaneId: "",
  maximizedPaneId: "",
  trash: [],
  activeTabId: "",
  activePageId: "",
  history: [],
  historyIndex: -1,
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
      const normalized = normalizeSnapshot(snapshot);
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
        homeTabs: normalized.homeTabs,
        layout: normalized.layout,
        focusedPaneId: normalized.focusedPaneId,
        maximizedPaneId: normalized.maximizedPaneId,
        trash: normalized.trash,
        activeTabId: normalized.activeTabId,
        activePageId: normalized.active,
        history: normalized.active ? [normalized.active] : [],
        historyIndex: normalized.active ? 0 : -1,
        documents: {},
        outline: [],
        backlinks: [],
        liveWordCount: 0,
        liveBlockCount: 0,
      });
      const restored = pageTabs(normalized.tabs);
      const loaded = await Promise.all(restored.map((pageId) => get().ensurePageLoaded(pageId)));
      if (normalized.active) {
        await get().ensurePageLoaded(normalized.active);
        void get().refreshBacklinks();
      }
      if (loaded.some((item) => !item) && restored.length > 0) {
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
      const normalized = normalizeSnapshot(snapshot);
      set({
        pages: normalized.pages,
        favorites: normalized.favorites,
        recent: normalized.recent,
        tabs: normalized.tabs,
        homeTabs: normalized.homeTabs,
        layout: normalized.layout,
        focusedPaneId: normalized.focusedPaneId,
        maximizedPaneId: normalized.maximizedPaneId,
        trash: normalized.trash,
        activeTabId: normalized.activeTabId,
        activePageId: normalized.active,
        history: normalized.active ? [normalized.active] : [],
        historyIndex: normalized.active ? 0 : -1,
        documents: {},
        outline: [],
        backlinks: [],
        liveWordCount: 0,
        liveBlockCount: 0,
      });
      await Promise.all(pageTabs(normalized.tabs).map((pageId) => get().ensurePageLoaded(pageId)));
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

  selectPage: async (pageId, options) => {
    const page = get().pages.find((item) => item.id === pageId);
    if (!page) return;
    const opened = openTabInLayout(get(), pageId);
    set((state) => {
      const next: Partial<AppState> = {
        ...layoutPatch(state, opened.layout, opened.focusedPaneId),
        outline: [],
        backlinks: [],
        liveWordCount: 0,
        liveBlockCount: 0,
        recent: [page, ...state.recent.filter((item) => item.id !== pageId)].slice(0, 12),
      };
      if (opened.replacedHomeTab) next.homeTabs = withoutHomeTab(state.homeTabs, opened.replacedHomeTab);
      if (options?.recordHistory !== false) {
        const pushed = pushHistory(state.history, state.historyIndex, pageId);
        next.history = pushed.history;
        next.historyIndex = pushed.historyIndex;
      }
      return next;
    });
    await get().ensurePageLoaded(pageId);
    void get().refreshBacklinks();
    scheduleTabs(get);
  },

  selectTab: (tabId) => {
    const state = get();
    const pane = paneOfTab(state.layout, tabId);
    if (!pane) return;
    if (!isHomeTab(tabId)) {
      void get().selectPage(tabId);
      return;
    }
    set((current) => ({
      ...layoutPatch(current, updatePane(current.layout, pane.id, (item) => ({ ...item, activeTabId: tabId })), pane.id),
      outline: [],
      backlinks: [],
      liveWordCount: 0,
      liveBlockCount: 0,
    }));
    scheduleTabs(get);
  },

  openHomeTab: (settings, paneId) => {
    const tabId = createHomeTabId();
    const homeSettings = normalizeHomeTabSettings(settings ?? defaultHomeTabSettings);
    set((state) => {
      const layout = addTabToPane(state.layout, paneId ?? state.focusedPaneId, tabId);
      const pane = paneOfTab(layout, tabId);
      return {
        ...layoutPatch(state, layout, pane?.id),
        homeTabs: { ...state.homeTabs, [tabId]: homeSettings },
        outline: [],
        backlinks: [],
        liveWordCount: 0,
        liveBlockCount: 0,
      };
    });
    scheduleTabs(get);
  },

  updateHomeTab: (tabId, patch) => {
    if (!isHomeTab(tabId) || !paneOfTab(get().layout, tabId)) return;
    set((state) => ({
      homeTabs: {
        ...state.homeTabs,
        [tabId]: normalizeHomeTabSettings({ ...state.homeTabs[tabId], ...patch }),
      },
    }));
    scheduleTabs(get);
  },

  goBack: () => {
    const { history, historyIndex, pages } = get();
    let index = historyIndex - 1;
    while (index >= 0 && !pages.some((page) => page.id === history[index])) index -= 1;
    if (index < 0) return;
    set({ historyIndex: index });
    void get().selectPage(history[index], { recordHistory: false });
  },

  goForward: () => {
    const { history, historyIndex, pages } = get();
    let index = historyIndex + 1;
    while (index < history.length && !pages.some((page) => page.id === history[index])) index += 1;
    if (index >= history.length) return;
    set({ historyIndex: index });
    void get().selectPage(history[index], { recordHistory: false });
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
          cover: loaded.cover,
          position: Math.max(0, ...state.pages.map((page) => page.position)) + 1024,
          updatedAt: loaded.updatedAt,
        };
        const pushed = pushHistory(state.history, state.historyIndex, loaded.id);
        const opened = openTabInLayout(state, loaded.id);
        return {
          pages: [...state.pages, meta],
          documents: { ...state.documents, [loaded.id]: loaded },
          ...layoutPatch(state, opened.layout, opened.focusedPaneId),
          ...(opened.replacedHomeTab ? { homeTabs: withoutHomeTab(state.homeTabs, opened.replacedHomeTab) } : {}),
          history: pushed.history,
          historyIndex: pushed.historyIndex,
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

  closeTab: async (tabId) => {
    const initialPane = paneOfTab(get().layout, tabId);
    if (!initialPane) return;
    const closingHome = isHomeTab(tabId);
    if (!closingHome) {
      clearTimersFor(tabId);
      const ok = await get().saveNow(tabId);
      if (!ok) return;
    }
    // Layout can change while a page save is in flight.
    const state = get();
    const pane = paneOfTab(state.layout, tabId);
    if (!pane) return;
    const panes = paneList(state.layout);
    const paneIndex = panes.findIndex((item) => item.id === pane.id);
    const isLastPane = panes.length === 1;
    const isLastTabOfPane = pane.tabs.length === 1;
    const wasActive = state.activeTabId === tabId;

    if (isLastPane && isLastTabOfPane) {
      // Closing the final page leaves a fresh Home tab. A lone Home tab is the
      // resting state, so it stays put.
      if (closingHome) return;
      const home = createHomeTabId();
      set((current) => {
        const aligned = alignHistory(current.history.filter((id) => id !== tabId), "");
        return {
          ...layoutPatch(current, layoutFromTabs([home], home), "", ""),
          homeTabs: { ...withoutHomeTab(current.homeTabs, tabId), [home]: { ...defaultHomeTabSettings } },
          history: aligned.history,
          historyIndex: aligned.historyIndex,
          outline: [],
          backlinks: [],
          liveWordCount: 0,
          liveBlockCount: 0,
        };
      });
      scheduleTabs(get);
      return;
    }

    const next = removeTabFromLayout(state.layout, tabId);
    if (!next) return;
    const nextPanes = paneList(next);
    const nextPane =
      nextPanes.find((item) => item.id === pane.id) ??
      nextPanes[Math.max(0, Math.min(nextPanes.length - 1, paneIndex - 1))] ??
      nextPanes[0];
    const nextTab = nextPane.activeTabId;
    const nextPage = pageIdForTab(nextTab);
    const activeChanged = wasActive && nextTab !== state.activeTabId;
    set((current) => {
      const aligned = alignHistory(current.history.filter((id) => id !== tabId), nextPage);
      return {
        ...layoutPatch(current, next, nextPane.id),
        homeTabs: withoutHomeTab(current.homeTabs, tabId),
        history: aligned.history,
        historyIndex: aligned.historyIndex,
        ...(nextTab !== current.activeTabId ? { outline: [], backlinks: [], liveWordCount: 0, liveBlockCount: 0 } : {}),
      };
    });
    if (activeChanged && nextPage) {
      await get().ensurePageLoaded(nextPage);
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

  setPageAppearance: async (pageId, icon, cover) => {
    const workspaceId = get().workspace?.id;
    const previous = get().pages.find((item) => item.id === pageId);
    if (!workspaceId || !previous) return;
    if (previous.icon === icon && previous.cover === cover) return;
    const apply = (meta: PageMeta) => {
      set((state) => ({
        pages: state.pages.map((item) =>
          item.id === pageId ? { ...item, icon: meta.icon, cover: meta.cover, updatedAt: meta.updatedAt } : item,
        ),
        recent: state.recent.map((item) =>
          item.id === pageId ? { ...item, icon: meta.icon, cover: meta.cover, updatedAt: meta.updatedAt } : item,
        ),
        trash: state.trash.map((item) => (item.id === pageId ? { ...item, icon: meta.icon, cover: meta.cover } : item)),
        documents: state.documents[pageId]
          ? {
              ...state.documents,
              [pageId]: {
                ...state.documents[pageId],
                icon: meta.icon,
                cover: meta.cover,
                updatedAt: meta.updatedAt,
              },
            }
          : state.documents,
      }));
    };
    // The picker should feel immediate; the local database write is quick and
    // the previous value is restored if it fails.
    apply({ ...previous, icon, cover });
    try {
      const meta = await api.setPageAppearance(workspaceId, pageId, icon, cover);
      if (get().workspace?.id !== workspaceId) return;
      apply(meta);
    } catch (error) {
      apply(previous);
      get().notify(errorMessage(error), "error");
    }
  },

  trashPage: async (pageId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      await get().saveNow(pageId);
      const snapshot = await api.trashPage(workspaceId, pageId);
      if (get().workspace?.id !== workspaceId) return;
      set(snapshotPatch(snapshot, get()));
      if (get().activePageId) {
        await get().ensurePageLoaded(get().activePageId);
        void get().refreshBacklinks();
      }
      scheduleTabs(get);
      get().notify("Page moved to trash.", "info");
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  restorePage: async (pageId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      const snapshot = await api.restorePage(workspaceId, pageId);
      if (get().workspace?.id !== workspaceId) return;
      set(snapshotPatch(snapshot, get()));
      set(activatePagePatch(get(), pageId));
      await get().ensurePageLoaded(pageId);
      void get().refreshBacklinks();
      scheduleTabs(get);
      get().notify("Page restored.", "success");
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  deletePagePermanently: async (pageId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      const snapshot = await api.deletePagePermanently(workspaceId, pageId);
      if (get().workspace?.id !== workspaceId) return;
      set(snapshotPatch(snapshot, get()));
      if (get().activePageId) await get().ensurePageLoaded(get().activePageId);
      scheduleTabs(get);
      get().notify("Page deleted permanently.", "info");
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  emptyTrash: async () => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      const snapshot = await api.emptyTrash(workspaceId);
      if (get().workspace?.id !== workspaceId) return;
      set(snapshotPatch(snapshot, get()));
      scheduleTabs(get);
      get().notify("Trash emptied.", "info");
    } catch (error) {
      get().notify(errorMessage(error), "error");
    }
  },

  duplicatePage: async (pageId) => {
    const workspaceId = get().workspace?.id;
    if (!workspaceId) return;
    try {
      await get().saveNow(pageId);
      const result = await api.duplicatePage(workspaceId, pageId);
      if (get().workspace?.id !== workspaceId) return;
      set(snapshotPatch(result.snapshot, get()));
      set(activatePagePatch(get(), result.pageId));
      await get().ensurePageLoaded(result.pageId);
      void get().refreshBacklinks();
      scheduleTabs(get);
      get().notify("Page duplicated.", "success");
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

  focusPane: (paneId) => {
    if (get().focusedPaneId === paneId || !findPane(get().layout, paneId)) return;
    set((state) => layoutPatch(state, state.layout, paneId));
    scheduleTabs(get);
  },

  moveTab: (tabId, targetPaneId, beforeTabId) => {
    const state = get();
    if (!paneOfTab(state.layout, tabId)) return;
    const next = moveTabInLayout(state.layout, tabId, targetPaneId, beforeTabId);
    if (next === state.layout) return;
    set((current) => layoutPatch(current, next, targetPaneId));
    scheduleTabs(get);
  },

  dropTabInPane: (tabId, targetPaneId, zone) => {
    if (zone === "center") {
      get().moveTab(tabId, targetPaneId, null);
      return;
    }
    const state = get();
    if (!paneOfTab(state.layout, tabId)) return;
    const next = splitWithTab(state.layout, tabId, targetPaneId, zone);
    if (next === state.layout) return;
    // Splitting while maximized would put the new pane out of sight.
    set((current) => layoutPatch(current, next, paneOfTab(next, tabId)?.id, ""));
    scheduleTabs(get);
  },

  splitPane: (paneId, side) => {
    const state = get();
    if (!findPane(state.layout, paneId)) return;
    const tabId = createHomeTabId();
    const homeSettings = normalizeHomeTabSettings(defaultHomeTabSettings);
    const next = splitPaneWith(state.layout, paneId, side, createPane([tabId], tabId));
    if (next === state.layout) return;
    set((current) => ({
      ...layoutPatch(current, next, paneOfTab(next, tabId)?.id, ""),
      homeTabs: { ...current.homeTabs, [tabId]: homeSettings },
      outline: [],
      backlinks: [],
      liveWordCount: 0,
      liveBlockCount: 0,
    }));
    scheduleTabs(get);
  },

  toggleMaximize: (paneId) => {
    const state = get();
    if (paneList(state.layout).length < 2 || !findPane(state.layout, paneId)) return;
    set((current) => ({
      ...layoutPatch(current, current.layout, paneId),
      maximizedPaneId: current.maximizedPaneId === paneId ? "" : paneId,
    }));
    scheduleTabs(get);
  },

  closePane: (paneId) => {
    const state = get();
    const panes = paneList(state.layout);
    const pane = panes.find((item) => item.id === paneId);
    if (!pane) return;
    const paneIndex = panes.findIndex((item) => item.id === paneId);
    const closedHomeTabs = pane.tabs.filter((tabId) => isHomeTab(tabId));
    const closedPageTabs = pane.tabs.filter((tabId) => !isHomeTab(tabId));
    const stripHomeTabs = (settings: Record<string, HomeTabSettings>) =>
      closedHomeTabs.reduce((current, tabId) => withoutHomeTab(current, tabId), settings);

    if (panes.length === 1) {
      // The last pane cannot disappear; it resets to the resting Home tab.
      if (pane.tabs.length === 1 && isHomeTab(pane.tabs[0])) return;
      const home = createHomeTabId();
      const fresh = layoutFromTabs([home], home);
      set((current) => {
        const aligned = alignHistory(current.history.filter((id) => !closedPageTabs.includes(id)), "");
        return {
          ...layoutPatch(current, fresh, firstPane(fresh)?.id, ""),
          homeTabs: { ...stripHomeTabs(current.homeTabs), [home]: { ...defaultHomeTabSettings } },
          history: aligned.history,
          historyIndex: aligned.historyIndex,
          outline: [],
          backlinks: [],
          liveWordCount: 0,
          liveBlockCount: 0,
        };
      });
      scheduleTabs(get);
      return;
    }

    const next = removePaneFromLayout(state.layout, paneId);
    if (!next) return;
    const nextPanes = paneList(next);
    const fallback = nextPanes[Math.max(0, Math.min(nextPanes.length - 1, paneIndex - 1))] ?? nextPanes[0];
    const focused = state.focusedPaneId === paneId ? fallback.id : state.focusedPaneId;
    const maximized = state.maximizedPaneId === paneId ? "" : state.maximizedPaneId;
    const focusedPane = nextPanes.find((item) => item.id === focused) ?? nextPanes[0];
    const nextPage = pageIdForTab(focusedPane.activeTabId);
    const activeChanged = state.activePageId !== nextPage;
    set((current) => {
      const aligned = alignHistory(current.history.filter((id) => !closedPageTabs.includes(id)), nextPage);
      return {
        ...layoutPatch(current, next, focused, maximized),
        homeTabs: stripHomeTabs(current.homeTabs),
        history: aligned.history,
        historyIndex: aligned.historyIndex,
      };
    });
    if (activeChanged && nextPage) {
      void get().ensurePageLoaded(nextPage);
      void get().refreshBacklinks();
    }
    scheduleTabs(get);
  },

  resizeSplit: (splitId, index, delta) => {
    if (!delta) return;
    set((current) => ({ layout: applySplitDelta(current.layout, splitId, index, delta) }));
    scheduleTabs(get);
  },

  resetSplit: (splitId) => {
    set((current) => ({ layout: resetSplitLayout(current.layout, splitId) }));
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
      await api.saveTabs(
        workspaceId,
        get().tabs,
        get().activeTabId,
        get().homeTabs,
        serializeLayout(get().layout, get().focusedPaneId, get().maximizedPaneId),
      );
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

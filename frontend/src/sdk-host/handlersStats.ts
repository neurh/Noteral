/**
 * Facts about pages, the workspace and the app window for plugins, widgets and the
 * assistant: pages.stats, workspaces.stats and app.state.
 */
import type { PageMeta } from "../lib/api";
import { parseSchema, rowsOf } from "../lib/database";
import { editorBridge } from "../lib/editorBridge";
import { paneList } from "../lib/panes";
import { getPageBackground, normalizePageBackground, setPageBackground } from "../lib/pageBackground";
import { pageContentStats, parseBlocks } from "../lib/pageStats";
import { isHomeTab } from "../store";
import { activePageId, displayTitle, findMeta, kindOfMeta, requireMeta, store } from "./handlers";
import type { CallContext } from "./handlers";
import type { AppState, PageStats, WorkspaceStats } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Params = Record<string, any>;
type Handler = (params: Params, ctx: CallContext) => unknown;

/** The page's blocks: from the open editor when there is one (unsaved edits included). */
async function blocksOf(pageId: string): Promise<{ blocks: unknown[]; open: boolean }> {
  const handle = editorBridge.get(pageId);
  if (handle) {
    try {
      return { blocks: parseBlocks(handle.getJSON()), open: true };
    } catch {
      // fall back to the stored copy
    }
  }
  const doc = await store().ensurePageLoaded(pageId);
  if (!doc) throw new Error(`Could not load "${displayTitle(pageId)}".`);
  return { blocks: parseBlocks(doc.docJson), open: false };
}

function liveChildren(pageId: string): PageMeta[] {
  return store().pages.filter((page) => page.parentId === pageId && !page.deletedAt);
}

function depthOf(meta: PageMeta, byId: Map<string, PageMeta>): number {
  let depth = 0;
  let parent = meta.parentId ? byId.get(meta.parentId) : undefined;
  while (parent && depth < 64) {
    depth += 1;
    parent = parent.parentId ? byId.get(parent.parentId) : undefined;
  }
  return depth;
}

async function pageStats(pageId: string): Promise<PageStats> {
  const meta = requireMeta(pageId);
  const kind = kindOfMeta(meta);
  const byId = new Map(store().pages.map((page) => [page.id, page] as const));
  const base = {
    pageId,
    title: displayTitle(pageId),
    kind,
    icon: meta.icon ?? "",
    parentId: meta.parentId ?? "",
    createdAt: meta.createdAt ?? "",
    updatedAt: meta.updatedAt ?? "",
    depth: depthOf(meta, byId),
    childPages: liveChildren(pageId).filter((child) => kindOfMeta(child) !== "row").length,
    favorite: store().favorites.includes(pageId),
    active: activePageId() === pageId,
  };
  if (kind === "database") {
    const schema = parseSchema(meta.data);
    const rows = rowsOf(store().pages, pageId);
    const views = (schema as { views?: { type?: string }[] }).views ?? [];
    return {
      ...base,
      open: false,
      ...pageContentStats([]),
      database: {
        rows: rows.length,
        properties: schema.properties.map((property) => ({ id: property.id, name: property.name, type: property.type })),
        views: views.length,
        viewTypes: [...new Set(views.map((view) => String(view.type ?? "table")))],
      },
    };
  }
  const { blocks, open } = await blocksOf(pageId);
  return { ...base, open, ...pageContentStats(blocks, displayTitle) };
}

function pageIdOf(p: Record<string, unknown>): string {
  const id = typeof p.pageId === "string" && p.pageId ? p.pageId : activePageId();
  if (!id) throw new Error("No page is open. Pass a pageId.");
  requireMeta(id);
  return id;
}

export const STATS_HANDLERS: Record<string, Handler> = {
  "pages.getBackground": (p) => getPageBackground(pageIdOf(p)),
  "pages.setBackground": async (p) => {
    const pageId = pageIdOf(p);
    if (p.background === null || p.background === undefined || p.background === "") {
      await setPageBackground(pageId, null);
      return null;
    }
    const background = normalizePageBackground(p.background);
    if (!background) {
      throw new Error("Invalid page background. Use { kind: \"color\"|\"gradient\"|\"image\", value } or { kind: \"ascii\", ascii: { scene: \"moon\" } } (scenes: moon, sunset, galaxy, rain, dunes, topo).");
    }
    await setPageBackground(pageId, background);
    return getPageBackground(pageId);
  },
  "pages.stats": async (p) => {
    const pageId = typeof p.pageId === "string" && p.pageId ? p.pageId : activePageId();
    if (!pageId) throw new Error("No page is open; pass pageId.");
    return pageStats(pageId);
  },
  "workspaces.stats": async (p): Promise<WorkspaceStats> => {
    const state = store();
    const pages = state.pages.filter((page) => !page.deletedAt);
    const byId = new Map(pages.map((page) => [page.id, page] as const));
    const counts = { page: 0, database: 0, row: 0, folder: 0, custom: 0 };
    let maxDepth = 0;
    let lastEdited: { pageId: string; title: string; updatedAt: string } | null = null;
    for (const meta of pages) {
      counts[kindOfMeta(meta)] += 1;
      maxDepth = Math.max(maxDepth, depthOf(meta, byId));
      if (meta.updatedAt && (!lastEdited || meta.updatedAt > lastEdited.updatedAt)) lastEdited = { pageId: meta.id, title: displayTitle(meta.id), updatedAt: meta.updatedAt };
    }
    const result: WorkspaceStats = {
      workspaceId: state.workspace?.id ?? null,
      workspaceName: state.workspace?.name ?? "",
      total: pages.length,
      pages: counts.page,
      databases: counts.database,
      rows: counts.row,
      folders: counts.folder,
      custom: counts.custom,
      topLevel: pages.filter((page) => !page.parentId).length,
      favorites: state.favorites.length,
      trashed: state.trash.length,
      maxDepth,
      lastEdited,
    };
    if (p.content === true) {
      // Reads every page; capped so a huge workspace can't stall the app.
      const limit = Math.max(1, Math.min(2000, Number(p.limit) || 500));
      const targets = pages.filter((page) => page.kind !== "database" && page.kind !== "folder").slice(0, limit);
      let words = 0;
      let characters = 0;
      let todos = 0;
      let todosDone = 0;
      let blocks = 0;
      const top: { pageId: string; title: string; words: number }[] = [];
      for (const meta of targets) {
        try {
          const { blocks: list } = await blocksOf(meta.id);
          const stats = pageContentStats(list);
          words += stats.words;
          characters += stats.characters;
          todos += stats.todos.total;
          todosDone += stats.todos.done;
          blocks += stats.blocks;
          top.push({ pageId: meta.id, title: displayTitle(meta.id), words: stats.words });
        } catch {
          // unreadable page: skip it
        }
      }
      top.sort((a, b) => b.words - a.words);
      result.content = { scanned: targets.length, words, characters, blocks, todos: { total: todos, done: todosDone, open: todos - todosDone }, longest: top.slice(0, 10), readingMinutes: words ? Math.ceil(words / 230) : 0 };
    }
    return result;
  },
  "app.state": (): AppState => {
    const state = store();
    const panes = paneList(state.layout).map((pane) => ({
      id: pane.id,
      focused: pane.id === state.focusedPaneId,
      maximized: pane.id === state.maximizedPaneId,
      activeTab: pane.activeTabId,
      tabs: pane.tabs.map((tab) => {
        const home = isHomeTab(tab);
        const meta = home ? undefined : findMeta(tab);
        return { id: tab, pageId: home ? "" : tab, title: home ? "Home" : displayTitle(tab), kind: home ? ("home" as const) : meta ? kindOfMeta(meta) : ("page" as const), active: tab === pane.activeTabId };
      }),
    }));
    const settings = state.settings as unknown as Record<string, unknown>;
    return {
      activePageId: activePageId(),
      activeTitle: activePageId() ? displayTitle(activePageId()) : "",
      focusedPaneId: state.focusedPaneId,
      panes,
      openTabs: panes.reduce((sum, pane) => sum + pane.tabs.length, 0),
      leftSidebar: { open: settings.leftOpen !== false, tab: String(state.leftTab ?? "") },
      rightSidebar: { open: settings.rightOpen !== false, tab: String(state.rightTab ?? "") },
      assistantOpen: settings.rightOpen !== false && state.rightTab === "assistant",
      overlay: state.overlay ? String(state.overlay) : "",
      theme: state.resolvedTheme,
      online: typeof navigator === "undefined" ? true : navigator.onLine,
      window: { width: window.innerWidth, height: window.innerHeight },
      workspaceId: state.workspace?.id ?? null,
      history: { canGoBack: state.historyIndex > 0, canGoForward: state.historyIndex < state.history.length - 1 },
    };
  },
};

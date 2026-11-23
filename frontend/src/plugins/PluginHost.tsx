import { useEffect, useRef } from "react";
import { api } from "../lib/api";
import { editorBridge } from "../lib/editorBridge";
import { isHomeTab, useAppStore } from "../store";
import { pluginRuntime } from "./runtime";

export function PluginHost() {
  const container = useRef<HTMLDivElement>(null);
  const plugins = useAppStore((state) => state.plugins);
  const pluginRevision = useAppStore((state) => state.pluginRevision);
  const theme = useAppStore((state) => state.resolvedTheme);
  const activePageId = useAppStore((state) => state.activePageId);
  const liveWordCount = useAppStore((state) => state.liveWordCount);
  const liveBlockCount = useAppStore((state) => state.liveBlockCount);
  const activeTitle = useAppStore((state) => state.documents[state.activePageId]?.title ?? "");

  useEffect(() => {
    pluginRuntime.attach(container.current);
    pluginRuntime.setCapabilities({
      getSnapshot: () => {
        const state = useAppStore.getState();
        if (!state.activePageId) return null;
        const handle = editorBridge.get(state.activePageId);
        const stats = handle?.getStats();
        return {
          pageId: state.activePageId,
          title: state.documents[state.activePageId]?.title ?? "Untitled",
          wordCount: stats?.wordCount ?? state.liveWordCount,
          blockCount: stats?.blockCount ?? state.liveBlockCount,
          text: stats?.text ?? "",
        };
      },
      insertBlocks: async (blocks) => {
        const pageId = useAppStore.getState().activePageId;
        const handle = pageId ? editorBridge.get(pageId) : undefined;
        if (!handle) throw new Error("No page is open");
        await handle.insertBlocks(blocks);
      },
      listPages: () =>
        useAppStore.getState().pages.map((page) => ({
          id: page.id,
          title: page.title,
          parentId: page.parentId,
          updatedAt: page.updatedAt,
        })),
      getPage: (pageId) => {
        const page = useAppStore.getState().pages.find((item) => item.id === pageId);
        return page ? { id: page.id, title: page.title, parentId: page.parentId, updatedAt: page.updatedAt } : null;
      },
      listWorkspaces: () => useAppStore.getState().workspaces.map((workspace) => ({ id: workspace.id, name: workspace.name })),
      currentWorkspace: () => {
        const workspace = useAppStore.getState().workspace;
        return workspace ? { id: workspace.id, name: workspace.name } : null;
      },
      listTabs: () => {
        const state = useAppStore.getState();
        const titles = new Map(state.pages.map((page) => [page.id, page.title]));
        return state.tabs.flatMap((pageId) => {
          if (isHomeTab(pageId)) return [];
          return [{ pageId, title: titles.get(pageId) ?? "Untitled", active: pageId === state.activeTabId }];
        });
      },
      openPage: async (pageId) => {
        await useAppStore.getState().selectPage(pageId);
      },
      search: async (query) => {
        const workspace = useAppStore.getState().workspace;
        if (!workspace) return [];
        const hits = await api.search(workspace.id, query, 20);
        return (hits ?? []).map((hit) => ({ pageId: hit.pageId, title: hit.title, snippet: hit.snippet, updatedAt: hit.updatedAt }));
      },
      pickAsset: async (imagesOnly) => {
        const state = useAppStore.getState();
        if (!state.workspace || !state.activePageId) throw new Error("Open a page before attaching a file");
        const asset = await api.importAsset(state.workspace.id, state.activePageId, imagesOnly);
        return asset?.url ?? null;
      },
      getSettings: async (pluginId) => {
        const value = await api.getPluginSettings(pluginId);
        return (value ?? {}) as Record<string, unknown>;
      },
      saveSettings: async (pluginId, patch) => {
        const value = await api.savePluginSettings(pluginId, patch);
        return (value ?? {}) as Record<string, unknown>;
      },
      notify: (message) => useAppStore.getState().notify(message, "info"),
      getTheme: () => useAppStore.getState().resolvedTheme,
    });
    return () => pluginRuntime.dispose();
  }, []);

  useEffect(() => {
    void pluginRuntime.sync(plugins);
  }, [plugins, pluginRevision]);

  useEffect(() => {
    // Building a snapshot reads the whole page, so wait until typing pauses
    // and skip it entirely when no plugin is listening.
    if (!pluginRuntime.hasReadyFrames()) return;
    const timer = setTimeout(() => pluginRuntime.publishDocument(pluginRuntime.snapshotForEditor()), 400);
    return () => clearTimeout(timer);
  }, [activePageId, liveWordCount, liveBlockCount, activeTitle]);

  useEffect(() => {
    pluginRuntime.publishTheme(theme);
  }, [theme]);

  return <div ref={container} id="plugin-runtimes" className="plugin-runtimes" aria-hidden="true" />;
}

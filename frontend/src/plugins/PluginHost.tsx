import { useEffect, useRef } from "react";
import { commandRegistry } from "../lib/commands";
import { editorBridge } from "../lib/editorBridge";
import { handlerFor } from "../sdk-host/registry";
import type { CallContext } from "../sdk-host/handlers";
import { useAppStore } from "../store";
import { pluginRuntime } from "./runtime";

const HOST: CallContext = { caller: "assistant" };

/** Computes an event payload with the same handler plugins would call. */
async function payload(method: string): Promise<unknown> {
  try {
    return await handlerFor(method)?.({}, HOST);
  } catch {
    return null;
  }
}

async function emitFrom(event: string, method: string) {
  if (!pluginRuntime.wants(event)) return;
  pluginRuntime.emit(event, await payload(method));
}

/**
 * Hosts the hidden plugin frames and forwards app events to them. Events are
 * only computed when a running plugin listens, so an idle install costs nothing.
 */
export function PluginHost() {
  const container = useRef<HTMLDivElement>(null);
  const plugins = useAppStore((state) => state.plugins);
  const pluginRevision = useAppStore((state) => state.pluginRevision);
  const theme = useAppStore((state) => state.resolvedTheme);
  const activePageId = useAppStore((state) => state.activePageId);
  const workspaceId = useAppStore((state) => state.workspace?.id ?? "");
  const pageCount = useAppStore((state) => state.pages.length);
  const pagesRef = useAppStore((state) => state.pages);
  const liveWordCount = useAppStore((state) => state.liveWordCount);
  const liveBlockCount = useAppStore((state) => state.liveBlockCount);
  const layout = useAppStore((state) => state.layout);
  const maximizedPaneId = useAppStore((state) => state.maximizedPaneId);
  const leftOpen = useAppStore((state) => state.settings.leftOpen);
  const rightOpen = useAppStore((state) => state.settings.rightOpen);
  const railOpen = useAppStore((state) => state.settings.railOpen);
  const leftTab = useAppStore((state) => state.leftTab);
  const rightTab = useAppStore((state) => state.rightTab);

  useEffect(() => {
    pluginRuntime.attach(container.current);
    return () => pluginRuntime.dispose();
  }, []);

  // Key bindings of plugin commands. Capture phase, so a binding wins over the
  // editor; the app's and the editor's own keys are reserved (lib/shortcuts.ts).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing) return;
      const command = commandRegistry.forKeyEvent(event);
      if (!command) return;
      event.preventDefault();
      event.stopPropagation();
      void Promise.resolve(command.run()).catch(() => undefined);
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  useEffect(() => {
    pluginRuntime.sync(plugins);
  }, [plugins, pluginRevision]);

  useEffect(() => {
    pluginRuntime.emit("theme:changed", { theme });
  }, [theme]);

  useEffect(() => {
    void emitFrom("page:opened", "editor.getActive");
  }, [activePageId]);

  useEffect(() => {
    if (workspaceId) void emitFrom("workspace:opened", "workspaces.current");
  }, [workspaceId]);

  useEffect(() => {
    if (!pluginRuntime.wants("pages:changed")) return;
    const timer = window.setTimeout(() => pluginRuntime.emit("pages:changed", { count: pageCount }), 250);
    return () => window.clearTimeout(timer);
  }, [pagesRef, pageCount]);

  useEffect(() => {
    let timer = 0;
    const stop = editorBridge.onSelectionChange((pageId) => {
      if (!pluginRuntime.wants("selection:changed")) return;
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const selection = editorBridge.get(pageId)?.getSelection?.();
        if (selection) pluginRuntime.emit("selection:changed", { pageId, ...selection });
      }, 150);
    });
    return () => {
      stop();
      window.clearTimeout(timer);
    };
  }, []);

  useEffect(() => {
    if (!pluginRuntime.wants("layout:changed")) return;
    const timer = window.setTimeout(() => void emitFrom("layout:changed", "layout.get"), 200);
    return () => window.clearTimeout(timer);
  }, [layout, maximizedPaneId, leftOpen, rightOpen, railOpen, leftTab, rightTab]);

  // The editor snapshot includes the page text, so debounce and skip it
  // entirely when no plugin is listening.
  useEffect(() => {
    if (!activePageId || !pluginRuntime.wants("document:changed")) return;
    const timer = window.setTimeout(() => void emitFrom("document:changed", "editor.snapshot"), 400);
    return () => window.clearTimeout(timer);
  }, [activePageId, liveWordCount, liveBlockCount]);

  return <div ref={container} className="plugin-runtimes" aria-hidden="true" />;
}

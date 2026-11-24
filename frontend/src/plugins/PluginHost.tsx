import { useEffect, useRef } from "react";
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

  useEffect(() => {
    pluginRuntime.attach(container.current);
    return () => pluginRuntime.dispose();
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

  // The editor snapshot includes the page text, so debounce and skip it
  // entirely when no plugin is listening.
  useEffect(() => {
    if (!activePageId || !pluginRuntime.wants("document:changed")) return;
    const timer = window.setTimeout(() => void emitFrom("document:changed", "editor.snapshot"), 400);
    return () => window.clearTimeout(timer);
  }, [activePageId, liveWordCount, liveBlockCount]);

  return <div ref={container} className="plugin-runtimes" aria-hidden="true" />;
}

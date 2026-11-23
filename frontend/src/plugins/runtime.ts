import { useSyncExternalStore } from "react";
import type { Info, Manifest } from "../lib/api";
import { api } from "../lib/api";
import { commandRegistry } from "../lib/commands";
import { editorBridge } from "../lib/editorBridge";
import { SDK_SOURCE } from "./generated/sdkSource";

export interface PluginSnapshot {
  pageId: string;
  title: string;
  wordCount: number;
  blockCount: number;
  text: string;
}

export interface PluginStatus {
  pluginId: string;
  pluginName: string;
  itemId: string;
  label: string;
  text: string;
  title: string;
}

export interface PluginPanel {
  pluginId: string;
  pluginName: string;
  panelId: string;
  title: string;
  text: string;
}

export interface PluginTabs {
  pageId: string;
  title: string;
  active: boolean;
}

export interface PluginCapabilities {
  getSnapshot: () => PluginSnapshot | null;
  insertBlocks: (blocks: unknown[]) => Promise<void>;
  listPages: () => Array<{ id: string; title: string; parentId: string; updatedAt?: string }>;
  getPage: (pageId: string) => { id: string; title: string; parentId: string; updatedAt?: string } | null;
  listWorkspaces: () => Array<{ id: string; name: string }>;
  currentWorkspace: () => { id: string; name: string } | null;
  listTabs: () => PluginTabs[];
  openPage: (pageId: string) => Promise<void>;
  search: (query: string) => Promise<Array<{ pageId: string; title: string; snippet: string; updatedAt: string }>>;
  pickAsset: (imagesOnly: boolean) => Promise<string | null>;
  getSettings: (pluginId: string) => Promise<Record<string, unknown>>;
  saveSettings: (pluginId: string, patch: Record<string, unknown>) => Promise<Record<string, unknown>>;
  notify: (message: string) => void;
  getTheme: () => string;
}

interface FrameRecord {
  info: Info;
  manifest: Manifest;
  iframe: HTMLIFrameElement;
  ready: boolean;
  statuses: Map<string, { text: string; title: string }>;
  panels: Map<string, string>;
  commandIds: string[];
  commandPending: Map<string, { resolve: () => void; reject: (error: Error) => void; timer: number }>;
  startTimer: number;
}

const PROTOCOL = 1;
const REQUEST_LIMIT = 512 * 1024;

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

function srcdoc(sdk: string, code: string, pluginId: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;">
<style>html,body{margin:0;background:transparent;color-scheme:light dark;font:13px system-ui}</style></head>
<body data-plugin="${pluginId}">
<script>${escapeScript(sdk)}</script>
<script>${escapeScript(code)}</script>
</body></html>`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

class PluginRuntimeManager {
  private frames = new Map<string, FrameRecord>();
  private starting = new Set<string>();
  private capabilities: PluginCapabilities | null = null;
  private container: HTMLElement | null = null;
  private listenerAttached = false;
  private statusSnapshot: PluginStatus[] = [];
  private panelSnapshot: PluginPanel[] = [];
  private listeners = new Set<() => void>();
  private disposed = false;
  private readonly onMessage = (event: MessageEvent) => this.handleMessage(event);

  attach(container: HTMLElement | null) {
    this.container = container;
    if (!this.listenerAttached && typeof window !== "undefined") {
      window.addEventListener("message", this.onMessage);
      this.listenerAttached = true;
    }
  }

  setCapabilities(capabilities: PluginCapabilities) {
    this.capabilities = capabilities;
  }

  async sync(plugins: Info[]) {
    if (!this.container) return;
    const enabled = new Map(
      plugins
        .filter((plugin) => plugin.enabled && !plugin.problem)
        .map((plugin) => [plugin.manifest.id, plugin]),
    );
    for (const [id, frame] of [...this.frames]) {
      const next = enabled.get(id);
      if (!next || next.manifest.version !== frame.manifest.version) this.removeFrame(id);
    }
    for (const plugin of enabled.values()) {
      const existing = this.frames.get(plugin.manifest.id);
      if (!existing) void this.start(plugin);
    }
  }

  private async start(info: Info) {
    const id = info.manifest.id;
    if (this.starting.has(id) || this.frames.has(id) || this.disposed) return;
    this.starting.add(id);
    try {
      const runtime = await api.getPluginRuntime(id);
      if (this.disposed || !this.container) return;
      const iframe = document.createElement("iframe");
      iframe.className = "plugin-runtime-frame";
      iframe.title = `Plugin runtime: ${runtime.manifest.name}`;
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.srcdoc = srcdoc(SDK_SOURCE, runtime.code, id);
      this.container.appendChild(iframe);
      const frame: FrameRecord = {
        info,
        manifest: runtime.manifest,
        iframe,
        ready: false,
        statuses: new Map(),
        panels: new Map(),
        commandIds: [],
        commandPending: new Map(),
        startTimer: 0,
      };
      this.frames.set(id, frame);
      this.registerCommands(frame);
      iframe.addEventListener("load", () => this.postInit(frame), { once: true });
      frame.startTimer = window.setTimeout(() => {
        if (!frame.ready && this.frames.get(id) === frame) {
          this.capabilities?.notify(`Plugin “${frame.manifest.name}” did not start.`);
        }
      }, 6000);
    } catch (error) {
      this.capabilities?.notify(`Could not start plugin ${id}: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.starting.delete(id);
    }
  }

  private postInit(frame: FrameRecord) {
    frame.iframe.contentWindow?.postMessage(
      { __noteral: PROTOCOL, type: "init", manifest: frame.manifest },
      "*",
    );
  }

  private registerCommands(frame: FrameRecord) {
    const commands = frame.manifest.contributes.commands ?? [];
    for (const command of commands) {
      const fullId = `plugin:${frame.manifest.id}:${command.id}`;
      frame.commandIds.push(fullId);
      commandRegistry.register({
        id: fullId,
        title: command.title,
        category: "Plugins",
        description: command.description ?? `${frame.manifest.name} plugin`,
        keywords: command.keywords,
        run: () => this.runCommand(frame, command.id),
      });
    }
  }

  private removeFrame(id: string) {
    const frame = this.frames.get(id);
    if (!frame) return;
    window.clearTimeout(frame.startTimer);
    frame.iframe.contentWindow?.postMessage({ __noteral: PROTOCOL, type: "shutdown" }, "*");
    frame.iframe.remove();
    for (const fullId of frame.commandIds) commandRegistry.unregister(fullId);
    for (const pending of frame.commandPending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("Plugin stopped"));
    }
    this.frames.delete(id);
    this.rebuildStatuses();
    this.rebuildPanels();
  }

  private async runCommand(frame: FrameRecord, commandId: string) {
    if (!frame.ready) {
      this.capabilities?.notify(`Plugin “${frame.manifest.name}” is still starting.`);
      return;
    }
    const requestId = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    frame.iframe.contentWindow?.postMessage(
      { __noteral: PROTOCOL, type: "command", commandId, requestId },
      "*",
    );
    this.capabilities?.notify; // keep host capability intentionally unused for commands
  }

  hasReadyFrames(): boolean {
    for (const frame of this.frames.values()) if (frame.ready) return true;
    return false;
  }

  publishDocument(snapshot: PluginSnapshot | null) {
    if (!snapshot) return;
    for (const frame of this.frames.values()) {
      if (frame.ready) {
        frame.iframe.contentWindow?.postMessage(
          { __noteral: PROTOCOL, type: "event", event: "document:changed", data: snapshot },
          "*",
        );
      }
    }
  }

  publishTheme(theme: string) {
    for (const frame of this.frames.values()) {
      if (frame.ready) {
        frame.iframe.contentWindow?.postMessage(
          { __noteral: PROTOCOL, type: "event", event: "theme:changed", data: { theme } },
          "*",
        );
      }
    }
  }

  private async handleMessage(event: MessageEvent) {
    if (event.source === null) return;
    let frame: FrameRecord | undefined;
    for (const candidate of this.frames.values()) {
      if (candidate.iframe.contentWindow === event.source) {
        frame = candidate;
        break;
      }
    }
    if (!frame) return;
    const message = event.data as Record<string, unknown> | null;
    if (!isObject(message) || message.__noteral !== PROTOCOL) return;
    const type = String(message.type ?? "");
    if (type === "ready") {
      frame.ready = true;
      window.clearTimeout(frame.startTimer);
      const snapshot = this.capabilities?.getSnapshot() ?? null;
      if (snapshot) this.publishDocument(snapshot);
      this.publishTheme(this.capabilities?.getTheme() ?? "light");
      return;
    }
    if (type === "status") {
      if (!this.hasPermission(frame, "ui.status")) return;
      const itemId = String(message.itemId ?? "");
      const declared = (frame.manifest.contributes.statusItems ?? []).some((item) => item.id === itemId);
      if (!declared) return;
      const text = typeof message.text === "string" ? message.text.slice(0, 160) : "";
      const title = typeof message.title === "string" ? message.title.slice(0, 200) : "";
      if (text) frame.statuses.set(itemId, { text, title });
      else frame.statuses.delete(itemId);
      this.rebuildStatuses();
      return;
    }
    if (type === "panel") {
      if (!this.hasPermission(frame, "ui.panel")) return;
      const panelId = String(message.panelId ?? "");
      const declared = (frame.manifest.contributes.panels ?? []).some((panel) => panel.id === panelId);
      if (!declared) return;
      const text = typeof message.text === "string" ? message.text.slice(0, 4000) : "";
      if (text) frame.panels.set(panelId, text);
      else frame.panels.delete(panelId);
      this.rebuildPanels();
      return;
    }
    if (type === "request") {
      await this.handleRequest(frame, message);
      return;
    }
    if (type === "commandResult") {
      const requestId = String(message.requestId ?? "");
      const pending = frame.commandPending.get(requestId);
      if (pending) {
        window.clearTimeout(pending.timer);
        frame.commandPending.delete(requestId);
        if (message.ok) pending.resolve();
        else pending.reject(new Error(String(message.error ?? "Plugin command failed")));
      }
      return;
    }
    if (type === "error") {
      const text = String(message.message ?? "Plugin error").slice(0, 500);
      this.capabilities?.notify(`${frame.manifest.name}: ${text}`);
    }
  }

  private hasPermission(frame: FrameRecord, permission: string): boolean {
    return (frame.manifest.permissions ?? []).includes(permission);
  }

  private hasAnyPermission(frame: FrameRecord, permissions: string[]): boolean {
    const granted = frame.manifest.permissions ?? [];
    return permissions.some((permission) => granted.includes(permission));
  }

  private respond(frame: FrameRecord, requestId: string, ok: boolean, result?: unknown, error?: string) {
    frame.iframe.contentWindow?.postMessage(
      { __noteral: PROTOCOL, type: "response", requestId, ok, result, error },
      "*",
    );
  }

  private async handleRequest(frame: FrameRecord, message: Record<string, unknown>) {
    const requestId = String(message.requestId ?? "");
    const method = String(message.method ?? "");
    const params = isObject(message.params) ? message.params : {};
    const caps = this.capabilities;
    if (!caps) {
      this.respond(frame, requestId, false, undefined, "Noteral is not ready");
      return;
    }
    try {
      if (JSON.stringify(params).length > REQUEST_LIMIT) throw new Error("Request is too large");
      switch (method) {
        case "editor.snapshot": {
          if (!this.hasPermission(frame, "editor.read")) throw new Error("Missing permission editor.read");
          const snapshot = caps.getSnapshot();
          if (!snapshot) throw new Error("No page is open");
          this.respond(frame, requestId, true, snapshot);
          return;
        }
        case "editor.insertBlocks": {
          if (!this.hasPermission(frame, "editor.write")) throw new Error("Missing permission editor.write");
          const blocks = params.blocks;
          if (!Array.isArray(blocks) || blocks.length > 100) throw new Error("Invalid blocks payload");
          await caps.insertBlocks(blocks);
          this.respond(frame, requestId, true, null);
          return;
        }
        case "pages.list": {
          if (!this.hasPermission(frame, "pages.read")) throw new Error("Missing permission pages.read");
          this.respond(frame, requestId, true, caps.listPages());
          return;
        }
        case "pages.get": {
          if (!this.hasPermission(frame, "pages.read")) throw new Error("Missing permission pages.read");
          this.respond(frame, requestId, true, caps.getPage(String(params.pageId ?? "")));
          return;
        }
        case "workspaces.list": {
          if (!this.hasAnyPermission(frame, ["workspaces.read", "pages.read"])) throw new Error("Missing workspaces permission");
          this.respond(frame, requestId, true, caps.listWorkspaces());
          return;
        }
        case "workspaces.current": {
          if (!this.hasAnyPermission(frame, ["workspaces.read", "pages.read"])) throw new Error("Missing workspaces permission");
          this.respond(frame, requestId, true, caps.currentWorkspace());
          return;
        }
        case "tabs.list": {
          if (!this.hasPermission(frame, "pages.read")) throw new Error("Missing permission pages.read");
          this.respond(frame, requestId, true, caps.listTabs());
          return;
        }
        case "navigation.openPage": {
          if (!this.hasPermission(frame, "navigation")) throw new Error("Missing permission navigation");
          const pageId = String(params.pageId ?? "");
          if (!pageId) throw new Error("Missing pageId");
          await caps.openPage(pageId);
          this.respond(frame, requestId, true, null);
          return;
        }
        case "search.query": {
          if (!this.hasPermission(frame, "search.read")) throw new Error("Missing permission search.read");
          const query = String(params.query ?? "").slice(0, 200);
          this.respond(frame, requestId, true, query ? await caps.search(query) : []);
          return;
        }
        case "assets.pickImage":
        case "assets.pickFile": {
          if (!this.hasPermission(frame, "assets.write")) throw new Error("Missing permission assets.write");
          this.respond(frame, requestId, true, await caps.pickAsset(method === "assets.pickImage"));
          return;
        }
        case "settings.get": {
          if (!this.hasPermission(frame, "settings.read")) throw new Error("Missing permission settings.read");
          this.respond(frame, requestId, true, await caps.getSettings(frame.manifest.id));
          return;
        }
        case "settings.set": {
          if (!this.hasPermission(frame, "settings.write")) throw new Error("Missing permission settings.write");
          if (!isObject(params.patch)) throw new Error("Invalid settings patch");
          this.respond(frame, requestId, true, await caps.saveSettings(frame.manifest.id, params.patch));
          return;
        }
        case "ui.notify": {
          if (!this.hasPermission(frame, "ui.notify")) throw new Error("Missing permission ui.notify");
          const messageText = String(params.message ?? "").slice(0, 200);
          if (messageText) caps.notify(messageText);
          this.respond(frame, requestId, true, null);
          return;
        }
        default:
          throw new Error(`Unknown plugin method ${method}`);
      }
    } catch (error) {
      this.respond(frame, requestId, false, undefined, error instanceof Error ? error.message : String(error));
    }
  }

  private rebuildStatuses() {
    const next: PluginStatus[] = [];
    for (const frame of this.frames.values()) {
      for (const item of frame.manifest.contributes.statusItems ?? []) {
        const value = frame.statuses.get(item.id);
        if (!value?.text) continue;
        next.push({
          pluginId: frame.manifest.id,
          pluginName: frame.manifest.name,
          itemId: item.id,
          label: item.label,
          text: value.text,
          title: value.title || item.description || item.label,
        });
      }
    }
    next.sort((a, b) => a.pluginName.localeCompare(b.pluginName) || a.label.localeCompare(b.label));
    this.statusSnapshot = next;
    for (const listener of this.listeners) listener();
  }

  private rebuildPanels() {
    const next: PluginPanel[] = [];
    for (const frame of this.frames.values()) {
      for (const panel of frame.manifest.contributes.panels ?? []) {
        const text = frame.panels.get(panel.id);
        if (!text) continue;
        next.push({
          pluginId: frame.manifest.id,
          pluginName: frame.manifest.name,
          panelId: panel.id,
          title: panel.title,
          text,
        });
      }
    }
    next.sort((a, b) => a.pluginName.localeCompare(b.pluginName) || a.title.localeCompare(b.title));
    this.panelSnapshot = next;
    for (const listener of this.listeners) listener();
  }

  getStatuses = (): PluginStatus[] => this.statusSnapshot;
  getPanels = (): PluginPanel[] => this.panelSnapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  snapshotForEditor(): PluginSnapshot | null {
    const caps = this.capabilities;
    return caps ? caps.getSnapshot() : null;
  }

  dispose() {
    this.disposed = true;
    for (const id of [...this.frames.keys()]) this.removeFrame(id);
    if (this.listenerAttached) {
      window.removeEventListener("message", this.onMessage);
      this.listenerAttached = false;
    }
    this.listeners.clear();
  }
}

export const pluginRuntime = new PluginRuntimeManager();

export function usePluginStatuses(): PluginStatus[] {
  return useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getStatuses, pluginRuntime.getStatuses);
}

export function usePluginPanels(): PluginPanel[] {
  return useSyncExternalStore(pluginRuntime.subscribe, pluginRuntime.getPanels, pluginRuntime.getPanels);
}

export function pluginEditorSnapshot(): PluginSnapshot | null {
  const state = useAppSnapshot();
  if (!state) return null;
  const handle = editorBridge.get(state.pageId);
  const stats = handle?.getStats();
  return {
    pageId: state.pageId,
    title: state.title,
    wordCount: stats?.wordCount ?? state.wordCount,
    blockCount: stats?.blockCount ?? state.blockCount,
    text: stats?.text ?? "",
  };
}

// This indirection keeps the runtime independent from React store imports in tests.
let snapshotProvider: (() => PluginSnapshot | null) | null = null;
export function setPluginSnapshotProvider(provider: () => PluginSnapshot | null) {
  snapshotProvider = provider;
}

function useAppSnapshot(): PluginSnapshot | null {
  return snapshotProvider ? snapshotProvider() : null;
}

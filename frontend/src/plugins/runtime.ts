/**
 * Runs each enabled plugin in its own sandboxed iframe and bridges it to the
 * App API (../sdk-host). A plugin that throws, hangs or spams messages only
 * hurts itself: every message is size-checked, every request goes through
 * `callMethod` (callers, permissions, schema validation, confirmations), and a
 * frame that never says "ready" is reported and left alone.
 *
 * Wire protocol: `{ __noteral: 1 | 2, type, ... }` in both directions. Frames
 * built against SDK 1.x speak protocol 1 and keep working unchanged.
 */
import { useSyncExternalStore } from "react";
import { api, errorMessage } from "../lib/api";
import type { Info, Manifest } from "../lib/api";
import { commandRegistry } from "../lib/commands";
import { contributions, emptySet } from "../lib/contributions";
import { customizations } from "../lib/customizations";
import type { ContributionSet } from "../lib/contributions";
import { devlog } from "../lib/devlog";
import { viewHub } from "../lib/viewFrame";
import { ApiError, callMethod, hasPermission } from "../sdk-host/host";
import type { PluginSurface } from "../sdk-host/host";
import { EVENTS, METHOD_MAP } from "../sdk-host/spec";
import type { PanelAction } from "../sdk-host/types";
import { useAppStore } from "../store";
import { SDK_SOURCE } from "./generated/sdkSource";

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
  markdown: string;
  actions: PanelAction[];
}

export interface PluginRuntimeState {
  pluginId: string;
  status: "starting" | "ready" | "failed";
  error?: string;
}

type Protocol = 1 | 2;

interface Pending {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: number;
}

interface FrameRecord {
  /** Key in the frames map: the plugin id, or "trial:<id>" for a test run. */
  key: string;
  /** A test run (plugins.test): nothing it registers is shown, writes are skipped. */
  trial?: TrialLog;
  info: Info;
  manifest: Manifest;
  iframe: HTMLIFrameElement;
  protocol: Protocol;
  ready: boolean;
  failed?: string;
  statuses: Map<string, { text: string; title: string }>;
  panels: Map<string, { title: string; markdown: string; actions: PanelAction[] }>;
  /** Commands from manifest.contributes (full ids). */
  staticCommands: Set<string>;
  /** Commands registered at runtime with Noteral.commands.register (local ids). */
  dynamicCommands: Set<string>;
  subscriptions: Set<string>;
  style: HTMLStyleElement | null;
  pending: Map<string, Pending>;
  startTimer: number;
  lastErrorAt: number;
  inflight: number;
  /** Sidebar tabs, status widgets, block and node types registered through the SDK. */
  contrib: ContributionSet;
}

interface TrialLog {
  skipped: string[];
  calls: string[];
}

export interface TrialResult {
  ok: boolean;
  status: "ready" | "failed" | "timeout";
  error?: string;
  /** Errors and console output from the plugin while it ran. */
  logs: { level: string; message: string }[];
  commands: string[];
  contributions: { sidebarTabs: string[]; statusWidgets: string[]; blockTypes: string[]; nodeTypes: string[]; panels: string[]; statusItems: string[] };
  /** App API calls the plugin made while loading. */
  calls: string[];
  /** Write calls that were not run during the test. */
  skipped: string[];
}

/** During a test run these change only the throwaway frame, so they are allowed. */
const TRIAL_SAFE = /^(ui\.(setStatus|setPanel|addStyles)|sidebar\.(setTab|removeTab|list)|statusBar\.(setWidget|removeWidget|list)|blocks\.(registerType|unregisterType|listTypes)|nodes\.(registerType|unregisterType|listTypes)|views\.post)$/;

const MESSAGE_LIMIT = 512 * 1024;
const COMMAND_TIMEOUT = 30_000;
const START_TIMEOUT = 6_000;
const MAX_DYNAMIC_COMMANDS = 50;
const MAX_INFLIGHT = 32;
const MAX_STYLE_BYTES = 512 * 1024; // matches maxStylesBytes in internal/plugins
const EVENT_NAMES = new Set(EVENTS.map((event) => event.name));
const ALWAYS_SENT_TO_V1 = new Set(["document:changed", "theme:changed"]);

function escapeScript(source: string): string {
  return source.replace(/<\/script/gi, "<\\/script").replace(/<!--/g, "<\\!--");
}

function escapeAttr(value: string): string {
  return value.replace(/[&"<>]/g, (char) => `&#${char.charCodeAt(0)};`);
}

function srcdoc(code: string, pluginId: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:;">
<style>html,body{margin:0;background:transparent;color-scheme:light dark;font:13px system-ui}</style></head>
<body data-plugin="${escapeAttr(pluginId)}">
<script>${escapeScript(SDK_SOURCE)}</script>
<script>${escapeScript(code)}</script>
</body></html>`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function protocolFor(manifest: Manifest): Protocol {
  const major = Number.parseInt(String(manifest.sdkVersion ?? "1").split(".")[0] ?? "1", 10);
  return major >= 2 ? 2 : 1;
}

function text(value: unknown, max: number): string {
  return String(value ?? "").slice(0, max);
}

function messageSize(data: unknown): number {
  try {
    return JSON.stringify(data)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function cleanActions(value: unknown): PanelAction[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter(isObject)
    .slice(0, 6)
    .map((action) => ({ id: text(action.id, 64), label: text(action.label, 40) }))
    .filter((action) => action.id && action.label);
}

function notify(message: string, kind: "info" | "error" | "success" = "info") {
  useAppStore.getState().notify(message, kind);
}

class PluginRuntimeManager {
  private frames = new Map<string, FrameRecord>();
  private starting = new Set<string>();
  private container: HTMLElement | null = null;
  private listenerAttached = false;
  private statusSnapshot: PluginStatus[] = [];
  private panelSnapshot: PluginPanel[] = [];
  private stateSnapshot: PluginRuntimeState[] = [];
  private listeners = new Set<() => void>();
  private disposed = false;
  private readonly onMessage = (event: MessageEvent) => this.handleMessage(event);

  attach(container: HTMLElement | null) {
    this.container = container;
    this.disposed = false;
    if (!this.listenerAttached && typeof window !== "undefined") {
      window.addEventListener("message", this.onMessage);
      this.listenerAttached = true;
    }
  }

  dispose() {
    this.disposed = true;
    for (const id of Array.from(this.frames.keys())) this.removeFrame(id);
    if (this.listenerAttached) {
      window.removeEventListener("message", this.onMessage);
      this.listenerAttached = false;
    }
  }

  /** Starts, restarts and stops frames to match the installed plugin list. */
  sync(plugins: Info[]) {
    const wanted = new Map<string, Info>();
    for (const info of plugins) {
      if (info.enabled && !info.problem) wanted.set(info.manifest.id, info);
    }
    for (const [id, frame] of this.frames) {
      const next = wanted.get(id);
      if (!next || next.manifest.version !== frame.manifest.version || next.installedAt !== frame.info.installedAt) this.removeFrame(id);
    }
    for (const [id, info] of wanted) {
      if (!this.frames.has(id) && !this.starting.has(id)) void this.start(info);
    }
  }

  /** Stops and starts one plugin again (used after its settings change). */
  async restart(pluginId: string) {
    const frame = this.frames.get(pluginId);
    if (!frame) return;
    const info = frame.info;
    this.removeFrame(pluginId);
    await this.start(info);
  }

  hasReadyFrames(): boolean {
    for (const frame of this.frames.values()) if (frame.ready) return true;
    return false;
  }

  /** True when at least one ready frame will receive this event. */
  wants(event: string): boolean {
    for (const frame of this.frames.values()) if (frame.ready && this.frameWants(frame, event)) return true;
    return viewHub.wants(event, (view) => this.viewMay(view.permissions, event));
  }

  private viewMay(permissions: readonly string[], event: string) {
    const spec = EVENTS.find((item) => item.name === event);
    return hasPermission(permissions, spec?.permission ?? null);
  }

  /** Sends an app event to every frame that subscribed (and may see it). */
  emit(event: string, payload: unknown | (() => unknown)) {
    let resolved: unknown;
    let computed = false;
    for (const frame of this.frames.values()) {
      if (!frame.ready || !this.frameWants(frame, event)) continue;
      if (!computed) {
        resolved = typeof payload === "function" ? (payload as () => unknown)() : payload;
        computed = true;
      }
      this.post(frame, { type: "event", event, data: resolved });
    }
    if (viewHub.wants(event, (view) => this.viewMay(view.permissions, event))) {
      if (!computed) resolved = typeof payload === "function" ? (payload as () => unknown)() : payload;
      viewHub.emit(event, resolved, (view) => this.viewMay(view.permissions, event));
    }
  }

  /** Sent from a plugin panel button. */
  panelAction(pluginId: string, panelId: string, actionId: string) {
    const frame = this.frames.get(pluginId);
    if (!frame?.ready) return;
    if (frame.subscriptions.has("panel:action")) this.post(frame, { type: "event", event: "panel:action", data: { panelId, actionId } });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  getStatuses = () => this.statusSnapshot;
  getPanels = () => this.panelSnapshot;
  getStates = () => this.stateSnapshot;

  // ── frame lifecycle ──────────────────────────────────────────────────────

  private async start(info: Info) {
    const id = info.manifest.id;
    if (!this.container || this.disposed) return;
    this.starting.add(id);
    try {
      const runtime = await api.getPluginRuntime(id);
      if (this.disposed || !this.container || this.frames.has(id)) return;
      this.launch(id, info, runtime.manifest ?? info.manifest, runtime.code, runtime.styles);
    } catch (error) {
      devlog.add(`plugin:${id}`, "error", `could not start: ${errorMessage(error)}`);
      notify(`Plugin “${info.manifest.name}” could not start: ${errorMessage(error)}`, "error");
    } finally {
      this.starting.delete(id);
    }
  }

  private launch(key: string, info: Info, manifest: Manifest, code: string, styles: string | undefined, trial?: TrialLog): FrameRecord | undefined {
    {
      if (!this.container) return undefined;
      const id = key;
      const iframe = document.createElement("iframe");
      iframe.className = "plugin-runtime-frame";
      iframe.setAttribute("sandbox", "allow-scripts");
      iframe.setAttribute("aria-hidden", "true");
      iframe.tabIndex = -1;
      iframe.title = `${manifest.name} plugin`;
      const frame: FrameRecord = {
        key,
        trial,
        contrib: emptySet(),
        info,
        manifest,
        iframe,
        protocol: protocolFor(manifest),
        ready: false,
        statuses: new Map(),
        panels: new Map(),
        staticCommands: new Set(),
        dynamicCommands: new Set(),
        subscriptions: new Set(),
        style: null,
        pending: new Map(),
        startTimer: 0,
        lastErrorAt: 0,
        inflight: 0,
      };
      this.frames.set(id, frame);
      if (styles) this.setStyles(frame, styles);
      iframe.addEventListener("load", () => this.postInit(frame));
      iframe.srcdoc = srcdoc(code, manifest.id);
      this.container.appendChild(iframe);
      if (!trial) this.registerStaticCommands(frame);
      frame.startTimer = window.setTimeout(() => {
        if (frame.ready || this.frames.get(id) !== frame) return;
        this.fail(frame, "did not start within 6 seconds");
      }, START_TIMEOUT);
      this.rebuild();
      return frame;
    }
  }

  private fail(frame: FrameRecord, reason: string) {
    frame.failed = reason;
    devlog.add(this.logSource(frame), "error", reason);
    if (!frame.trial) notify(`Plugin “${frame.manifest.name}” ${reason}.`, "error");
    this.rebuild();
  }

  private logSource(frame: FrameRecord) {
    return frame.trial ? `trial:${frame.manifest.id}` : `plugin:${frame.manifest.id}`;
  }

  // ── tests and health checks ──────────────────────────────────────────────

  /**
   * Loads a plugin in a throwaway frame without installing it: runs onload, records errors,
   * console output, the commands and UI it registers, then tears it down. Read calls run for
   * real; write calls are skipped and listed.
   */
  async trial(manifest: Manifest, code: string, styles = "", waitMs = 1500): Promise<TrialResult> {
    if (!this.container) throw new ApiError("The plugin runtime is not ready.", "failed");
    const key = `trial:${manifest.id}`;
    this.removeFrame(key);
    devlog.clear(key);
    const log: TrialLog = { skipped: [], calls: [] };
    const info = { manifest, enabled: true, source: "trial", installedAt: Date.now() } as unknown as Info;
    let frame: FrameRecord | undefined;
    try {
      frame = this.launch(key, info, manifest, code, styles, log);
    } catch (error) {
      return {
        ok: false, status: "failed", error: errorMessage(error), logs: [], commands: [], calls: [], skipped: [],
        contributions: { sidebarTabs: [], statusWidgets: [], blockTypes: [], nodeTypes: [], panels: [], statusItems: [] },
      };
    }
    if (!frame) throw new ApiError("Could not start the test frame.", "failed");
    const started = Date.now();
    while (!frame.ready && !frame.failed && Date.now() - started < START_TIMEOUT) await sleep(50);
    // Let async work in onload settle and surface late errors.
    if (frame.ready) await sleep(waitMs);
    const logs = devlog.read(key).map((entry) => ({ level: entry.level, message: entry.message }));
    const result: TrialResult = {
      ok: frame.ready && !frame.failed && !logs.some((entry) => entry.level === "error"),
      status: frame.failed ? "failed" : frame.ready ? "ready" : "timeout",
      error: frame.failed ?? logs.find((entry) => entry.level === "error")?.message,
      logs,
      commands: [...(frame.manifest.contributes?.commands ?? []).map((command) => command.id), ...frame.dynamicCommands],
      contributions: {
        sidebarTabs: frame.contrib.sidebarTabs.map((tab) => tab.id),
        statusWidgets: frame.contrib.statusWidgets.map((widget) => widget.id),
        blockTypes: frame.contrib.blockTypes.map((block) => block.type),
        nodeTypes: frame.contrib.nodeTypes.map((node) => node.type),
        panels: [...frame.panels.keys()],
        statusItems: [...frame.statuses.keys()],
      },
      calls: log.calls.slice(0, 60),
      skipped: log.skipped.slice(0, 60),
    };
    this.removeFrame(key);
    return result;
  }

  /** Waits for an installed plugin to start (or fail) and returns what happened. */
  async health(pluginId: string, waitMs = 6500): Promise<{ status: "ready" | "failed" | "starting" | "stopped"; error?: string; logs: { level: string; message: string }[] }> {
    const since = Date.now() - 50;
    const started = Date.now();
    for (;;) {
      const frame = this.frames.get(pluginId);
      if (frame && (frame.ready || frame.failed)) break;
      if (!frame && !this.starting.has(pluginId) && Date.now() - started > 1500) break;
      if (Date.now() - started > waitMs) break;
      await sleep(60);
    }
    await sleep(400);
    const frame = this.frames.get(pluginId);
    const logs = devlog.read(`plugin:${pluginId}`, since).map((entry) => ({ level: entry.level, message: entry.message }));
    const status = !frame ? "stopped" : frame.failed ? "failed" : frame.ready ? "ready" : "starting";
    return { status, error: frame?.failed ?? logs.find((entry) => entry.level === "error")?.message, logs };
  }

  /** Change the UI contributions of a running plugin (or test frame). */
  editContributions(frameKey: string, change: (current: ContributionSet) => ContributionSet): ContributionSet {
    const frame = this.frames.get(frameKey);
    if (!frame) throw new ApiError("The plugin is not running.", "failed");
    frame.contrib = change(frame.contrib);
    this.publishContributions(frame);
    return frame.contrib;
  }

  contributionsOf(frameKey: string): ContributionSet | undefined {
    return this.frames.get(frameKey)?.contrib;
  }

  private publishContributions(frame: FrameRecord) {
    if (frame.trial) return;
    const declaredPanels = new Map((frame.manifest.contributes?.panels ?? []).map((panel) => [panel.id, panel.title]));
    // Markdown panels (ui.setPanel) are sidebar tabs too.
    const panelTabs = [...frame.panels].map(([panelId, panel]) => ({
      id: panelId,
      title: panel.title || declaredPanels.get(panelId) || frame.manifest.name,
      view: { markdown: panel.markdown, actions: panel.actions },
    }));
    const tabs = [...frame.contrib.sidebarTabs, ...panelTabs.filter((tab) => !frame.contrib.sidebarTabs.some((other) => other.id === tab.id))];
    contributions.set({
      owner: { kind: "plugin", id: frame.manifest.id, name: frame.manifest.name },
      permissions: frame.manifest.permissions ?? [],
      ...frame.contrib,
      sidebarTabs: tabs,
    });
  }

  /** A plugin's HTML view called noteral.post(name, payload). */
  viewMessage(pluginId: string, data: { view: string; name: string; payload: unknown }) {
    const frame = this.frames.get(pluginId);
    if (!frame?.ready || !frame.subscriptions.has("view:message")) return;
    this.post(frame, { type: "event", event: "view:message", data });
  }

  private postInit(frame: FrameRecord) {
    const theme = useAppStore.getState().resolvedTheme;
    this.post(frame, { type: "init", manifest: frame.manifest, theme, sdkVersion: "2.0.0" });
  }

  private post(frame: FrameRecord, message: Record<string, unknown>) {
    frame.iframe.contentWindow?.postMessage({ __noteral: frame.protocol, ...message }, "*");
  }

  private removeFrame(id: string) {
    const frame = this.frames.get(id);
    if (!frame) return;
    window.clearTimeout(frame.startTimer);
    try {
      this.post(frame, { type: "shutdown" });
    } catch {
      // The frame may already be gone.
    }
    // Give onunload a moment to run before the frame disappears.
    const iframe = frame.iframe;
    window.setTimeout(() => iframe.remove(), frame.ready ? 150 : 0);
    for (const fullId of frame.staticCommands) commandRegistry.unregister(fullId);
    for (const localId of frame.dynamicCommands) commandRegistry.unregister(this.commandId(frame, localId));
    for (const pending of frame.pending.values()) {
      window.clearTimeout(pending.timer);
      pending.reject(new Error("The plugin stopped."));
    }
    frame.style?.remove();
    this.frames.delete(id);
    if (!frame.trial) contributions.remove({ kind: "plugin", id: frame.manifest.id });
    this.rebuild();
  }

  // ── commands ─────────────────────────────────────────────────────────────

  private commandId(frame: FrameRecord, localId: string) {
    return `plugin:${frame.manifest.id}:${localId}`;
  }

  private registerStaticCommands(frame: FrameRecord) {
    for (const command of frame.manifest.contributes?.commands ?? []) {
      const fullId = this.commandId(frame, command.id);
      frame.staticCommands.add(fullId);
      commandRegistry.register({
        id: fullId,
        title: command.title,
        category: frame.manifest.name || "Plugins",
        description: command.description ?? `${frame.manifest.name} plugin`,
        keywords: command.keywords,
        run: () => this.runCommand(frame, command.id),
      });
    }
  }

  private registerDynamicCommand(frame: FrameRecord, params: Record<string, unknown>) {
    const localId = text(params.id, 64).trim();
    const title = text(params.title, 120).trim();
    if (!/^[a-zA-Z0-9][\w.-]*$/.test(localId)) throw new ApiError("Command id must be letters, digits, dots, dashes or underscores.", "invalid_params");
    if (!title) throw new ApiError("Command title is required.", "invalid_params");
    const fullId = this.commandId(frame, localId);
    if (frame.staticCommands.has(fullId)) throw new ApiError(`"${localId}" is already declared in manifest.json.`, "invalid_params");
    if (!frame.dynamicCommands.has(localId) && frame.dynamicCommands.size >= MAX_DYNAMIC_COMMANDS) {
      throw new ApiError(`A plugin can register at most ${MAX_DYNAMIC_COMMANDS} commands.`, "invalid_params");
    }
    frame.dynamicCommands.add(localId);
    commandRegistry.register({
      id: fullId,
      title,
      category: frame.manifest.name || "Plugins",
      description: text(params.description, 200) || `${frame.manifest.name} plugin`,
      keywords: text(params.keywords, 200) || undefined,
      run: () => this.runCommand(frame, localId),
    });
  }

  private unregisterDynamicCommand(frame: FrameRecord, localId: string) {
    if (!frame.dynamicCommands.delete(localId)) return;
    commandRegistry.unregister(this.commandId(frame, localId));
  }

  private runCommand(frame: FrameRecord, commandId: string): Promise<void> {
    if (this.frames.get(frame.key) !== frame) return Promise.resolve();
    if (!frame.ready) {
      notify(`Plugin “${frame.manifest.name}” is ${frame.failed ? "not running" : "still starting"}.`);
      return Promise.resolve();
    }
    const requestId = `cmd_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    return new Promise<void>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        frame.pending.delete(requestId);
        reject(new Error(`“${frame.manifest.name}” did not finish the command in time.`));
      }, COMMAND_TIMEOUT);
      frame.pending.set(requestId, { resolve, reject, timer });
      this.post(frame, { type: "command", commandId, requestId });
    }).catch((error) => {
      notify(`${frame.manifest.name}: ${errorMessage(error)}`, "error");
    });
  }

  // ── surface (status items, panels, styles) ──────────────────────────────

  private surface(frame: FrameRecord): PluginSurface {
    return {
      setStatus: (itemId, value, title) => {
        const id = text(itemId, 64);
        if (!value) frame.statuses.delete(id);
        else frame.statuses.set(id, { text: text(value, 160), title: text(title, 200) });
        this.rebuild();
      },
      setPanel: (panelId, panel) => {
        const id = text(panelId, 64);
        if (!panel.markdown && !panel.actions.length) frame.panels.delete(id);
        else frame.panels.set(id, { title: text(panel.title, 80), markdown: text(panel.markdown, 20_000), actions: cleanActions(panel.actions) });
        this.publishContributions(frame);
        this.rebuild();
      },
      addStyles: (css) => this.setStyles(frame, css),
      contributions: () => frame.contrib,
      editContributions: (change) => {
        frame.contrib = change(frame.contrib);
        this.publishContributions(frame);
        return frame.contrib;
      },
      log: (level, message) => devlog.add(frame.trial ? `trial:${frame.manifest.id}` : `plugin:${frame.manifest.id}`, level, message),
    };
  }

  private setStyles(frame: FrameRecord, css: string) {
    if (css.length > MAX_STYLE_BYTES) throw new ApiError("Plugin styles are limited to 512 KB.", "invalid_params");
    if (frame.trial) return;
    if (!frame.style) {
      frame.style = document.createElement("style");
      frame.style.dataset.plugin = frame.manifest.id;
      document.head.appendChild(frame.style);
    }
    frame.style.textContent = css;
  }

  // ── events ───────────────────────────────────────────────────────────────

  private frameWants(frame: FrameRecord, event: string): boolean {
    const wanted = frame.protocol === 1 ? ALWAYS_SENT_TO_V1.has(event) : frame.subscriptions.has(event);
    if (!wanted) return false;
    const spec = EVENTS.find((item) => item.name === event);
    return hasPermission(frame.manifest.permissions ?? [], spec?.permission ?? null);
  }

  // ── messages ─────────────────────────────────────────────────────────────

  private frameFor(source: MessageEventSource | null): FrameRecord | undefined {
    if (!source) return undefined;
    for (const frame of this.frames.values()) if (frame.iframe.contentWindow === source) return frame;
    return undefined;
  }

  private handleMessage(event: MessageEvent) {
    const frame = this.frameFor(event.source);
    if (!frame) return;
    const data = event.data;
    if (!isObject(data) || (data.__noteral !== 1 && data.__noteral !== 2)) return;
    if (messageSize(data) > MESSAGE_LIMIT) {
      if (typeof data.requestId === "string") this.respond(frame, data.requestId, false, null, "Message is larger than 512 KB.");
      return;
    }
    switch (data.type) {
      case "ready":
        if (frame.ready) return;
        frame.ready = true;
        frame.failed = undefined;
        window.clearTimeout(frame.startTimer);
        this.rebuild();
        return;
      case "error":
        this.reportError(frame, text(data.message, 400));
        return;
      case "log": {
        const level = data.level === "error" ? "error" : data.level === "warn" ? "warn" : "info";
        devlog.add(this.logSource(frame), level, text(data.message, 1000));
        return;
      }
      case "status":
        // Protocol 1: Noteral status.set
        this.legacySurface(frame, () => this.surface(frame).setStatus(text(data.itemId, 64), text(data.text, 160), text(data.title, 200)), "ui.status");
        return;
      case "panel":
        // Protocol 1: panels.set with plain text
        this.legacySurface(frame, () => this.surface(frame).setPanel(text(data.panelId, 64), { title: "", markdown: text(data.text, 4000), actions: [] }), "ui.panel");
        return;
      case "commandResult": {
        const requestId = text(data.requestId, 80);
        const pending = frame.pending.get(requestId);
        if (!pending) return;
        frame.pending.delete(requestId);
        window.clearTimeout(pending.timer);
        if (data.ok) pending.resolve();
        else pending.reject(new Error(text(data.error, 400) || "The command failed."));
        return;
      }
      case "subscribe": {
        const name = text(data.event, 64);
        if (EVENT_NAMES.has(name)) frame.subscriptions.add(name);
        return;
      }
      case "unsubscribe":
        frame.subscriptions.delete(text(data.event, 64));
        return;
      case "request":
        void this.handleRequest(frame, data);
        return;
      default:
        return;
    }
  }

  private legacySurface(frame: FrameRecord, run: () => void, permission: string) {
    if (!hasPermission(frame.manifest.permissions ?? [], permission)) {
      this.reportError(frame, `needs the "${permission}" permission`);
      return;
    }
    run();
  }

  private reportError(frame: FrameRecord, message: string) {
    devlog.add(this.logSource(frame), "error", message || "an error occurred");
    if (frame.trial) return;
    console.warn(`[plugin ${frame.manifest.id}]`, message);
    const now = Date.now();
    if (now - frame.lastErrorAt < 10_000) return;
    frame.lastErrorAt = now;
    notify(`Plugin “${frame.manifest.name}”: ${message || "an error occurred"}`, "error");
  }

  private async handleRequest(frame: FrameRecord, data: Record<string, unknown>) {
    const requestId = text(data.requestId, 80);
    if (!requestId) return;
    const method = text(data.method, 80);
    const params = isObject(data.params) ? data.params : {};
    if (frame.inflight >= MAX_INFLIGHT) {
      this.respond(frame, requestId, false, null, "Too many requests in flight.", "failed");
      return;
    }
    frame.inflight += 1;
    try {
      const result = await this.dispatch(frame, method, params);
      if (this.frames.get(frame.key) === frame) this.respond(frame, requestId, true, result);
    } catch (error) {
      if (this.frames.get(frame.key) !== frame) return;
      const code = error instanceof ApiError ? error.code : "failed";
      this.respond(frame, requestId, false, null, errorMessage(error), code);
    } finally {
      frame.inflight -= 1;
    }
  }

  /** Runtime-only methods first, then the App API. */
  private async dispatch(frame: FrameRecord, method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "commands.register":
        if (frame.trial) {
          frame.dynamicCommands.add(text(params.id, 64));
          return null;
        }
        this.registerDynamicCommand(frame, params);
        return null;
      case "commands.unregister":
        this.unregisterDynamicCommand(frame, text(params.id, 64));
        return null;
      case "runtime.manifest":
        return frame.manifest;
    }
    if (frame.trial) {
      frame.trial.calls.push(method);
      const spec = METHOD_MAP.get(method);
      if (spec && spec.tier !== "read" && !TRIAL_SAFE.test(method)) {
        frame.trial.skipped.push(method);
        return null;
      }
    }
    const context = {
      caller: "plugin" as const,
      frameKey: frame.key,
      pluginId: frame.manifest.id,
      pluginName: frame.manifest.name,
      permissions: frame.manifest.permissions ?? [],
      surface: this.surface(frame),
    };
    if (frame.protocol === 1) return this.dispatchLegacy(method, params, context);
    return callMethod(method, params, context);
  }

  /** SDK 1.x expected slightly different shapes for a few results. */
  private async dispatchLegacy(method: string, params: Record<string, unknown>, context: Parameters<typeof callMethod>[2]) {
    if (method === "pages.get") {
      try {
        return await callMethod(method, params, context);
      } catch (error) {
        if (error instanceof ApiError && error.code === "failed") return null;
        throw error;
      }
    }
    if (method === "search.query" && typeof params.query === "string") params = { ...params, query: params.query.slice(0, 200) };
    const result = await callMethod(method, params, context);
    if (method === "tabs.list" && Array.isArray(result)) {
      return result.filter((tab) => tab.kind === "page").map((tab) => ({ pageId: tab.id, title: tab.title, active: tab.active }));
    }
    return result;
  }

  private respond(frame: FrameRecord, requestId: string, ok: boolean, result: unknown, error?: string, code?: string) {
    this.post(frame, { type: "response", requestId, ok, result: ok ? result : undefined, error, code });
  }

  // ── snapshots ────────────────────────────────────────────────────────────

  private rebuild() {
    customizations.setRunningPlugins([...this.frames.values()].filter((frame) => !frame.trial && !frame.failed).map((frame) => frame.manifest.id));
    const statuses: PluginStatus[] = [];
    const panels: PluginPanel[] = [];
    const states: PluginRuntimeState[] = [];
    for (const frame of this.frames.values()) {
      if (frame.trial) continue;
      const declaredStatus = new Map((frame.manifest.contributes?.statusItems ?? []).map((item) => [item.id, item.label]));
      for (const [itemId, status] of frame.statuses) {
        statuses.push({
          pluginId: frame.manifest.id,
          pluginName: frame.manifest.name,
          itemId,
          label: declaredStatus.get(itemId) ?? itemId,
          text: status.text,
          title: status.title || `${frame.manifest.name}`,
        });
      }
      const declaredPanels = new Map((frame.manifest.contributes?.panels ?? []).map((panel) => [panel.id, panel.title]));
      for (const [panelId, panel] of frame.panels) {
        panels.push({
          pluginId: frame.manifest.id,
          pluginName: frame.manifest.name,
          panelId,
          title: panel.title || declaredPanels.get(panelId) || frame.manifest.name,
          markdown: panel.markdown,
          actions: panel.actions,
        });
      }
      states.push({ pluginId: frame.manifest.id, status: frame.failed ? "failed" : frame.ready ? "ready" : "starting", error: frame.failed });
    }
    this.statusSnapshot = statuses;
    this.panelSnapshot = panels;
    this.stateSnapshot = states;
    for (const listener of this.listeners) listener();
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export const pluginRuntime = new PluginRuntimeManager();

const subscribe = (listener: () => void) => pluginRuntime.subscribe(listener);

export function usePluginStatuses(): PluginStatus[] {
  return useSyncExternalStore(subscribe, pluginRuntime.getStatuses, pluginRuntime.getStatuses);
}

export function usePluginPanels(): PluginPanel[] {
  return useSyncExternalStore(subscribe, pluginRuntime.getPanels, pluginRuntime.getPanels);
}

export function usePluginRuntimeStates(): PluginRuntimeState[] {
  return useSyncExternalStore(subscribe, pluginRuntime.getStates, pluginRuntime.getStates);
}

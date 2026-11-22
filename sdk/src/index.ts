/**
 * Noteral Plugin SDK 1.x
 *
 * Plugins run inside a sandboxed, opaque-origin iframe. This SDK is the only
 * bridge: every call is validated on the host for manifest permissions. There
 * is intentionally no access to Wails, the filesystem, Node, or the parent DOM.
 */

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  sdkVersion: string;
  description?: string;
  author?: string;
  entry: string;
  permissions: string[];
  contributes: {
    commands?: Array<{ id: string; title: string; description?: string; keywords?: string }>;
    statusItems?: Array<{ id: string; label: string; description?: string }>;
    panels?: Array<{ id: string; title: string; description?: string }>;
  };
}

export interface PageRef {
  id: string;
  title: string;
  parentId: string;
  updatedAt?: string;
}

export interface WorkspaceRef {
  id: string;
  name: string;
}

export interface TabRef {
  pageId: string;
  title: string;
  active: boolean;
}

export interface SearchHit {
  pageId: string;
  title: string;
  snippet: string;
  updatedAt: string;
}

export interface EditorSnapshot {
  pageId: string;
  title: string;
  wordCount: number;
  blockCount: number;
  text: string;
}

/** A small, portable block description accepted by editor.insertBlocks. */
export interface PluginBlock {
  type: string;
  text?: string;
  props?: Record<string, unknown>;
  children?: PluginBlock[];
}

export interface PluginContext {
  readonly manifest: PluginManifest;
  readonly commands: {
    /** Register the handler for a command declared in plugin.json. */
    on(commandId: string, handler: () => void | Promise<void>): () => void;
  };
  readonly status: {
    /** Update a status item declared in plugin.json (max 160 characters). */
    set(itemId: string, text: string, title?: string): void;
  };
  readonly panels: {
    /** Set plain text for an inspector panel declared in plugin.json. */
    set(panelId: string, text: string): void;
  };
  readonly editor: {
    snapshot(): Promise<EditorSnapshot>;
    insertBlocks(blocks: PluginBlock[]): Promise<void>;
  };
  readonly blocks: {
    insert(blocks: PluginBlock[]): Promise<void>;
  };
  readonly pages: {
    list(): Promise<PageRef[]>;
    get(pageId: string): Promise<PageRef | null>;
  };
  readonly workspaces: {
    list(): Promise<WorkspaceRef[]>;
    current(): Promise<WorkspaceRef | null>;
  };
  readonly tabs: {
    list(): Promise<TabRef[]>;
    open(pageId: string): Promise<void>;
  };
  readonly navigation: {
    openPage(pageId: string): Promise<void>;
  };
  readonly search: {
    query(text: string): Promise<SearchHit[]>;
  };
  readonly assets: {
    pickImage(): Promise<string | null>;
    pickFile(): Promise<string | null>;
  };
  readonly settings: {
    get(): Promise<Record<string, unknown>>;
    set(patch: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
  readonly events: {
    on(event: "document:changed" | "theme:changed", handler: (data: unknown) => void): () => void;
  };
  readonly ui: {
    notify(message: string): void;
  };
}

export interface NoteralGlobal {
  readonly version: string;
  definePlugin(setup: (context: PluginContext) => void | Promise<void>): void;
}

type Setup = (context: PluginContext) => void | Promise<void>;

const VERSION = "1.0.0";
const PROTOCOL = 1;
const REQUEST_TIMEOUT = 10_000;

let setup: Setup | null = null;
let context: PluginContext | null = null;
let initializing = false;
let initialized = false;
let sequence = 0;
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (err: Error) => void; timer: number }>();
const commandHandlers = new Map<string, () => void | Promise<void>>();
const eventHandlers = new Map<string, Set<(data: unknown) => void>>();
const statusItems = new Set<string>();
const commandItems = new Set<string>();
const panelItems = new Set<string>();

function post(message: Record<string, unknown>) {
  // Opaque-origin iframe: the parent origin is unknowable, so target "*".
  window.parent.postMessage({ __noteral: PROTOCOL, ...message }, "*");
}

function request<T>(method: string, params?: unknown): Promise<T> {
  if (!initialized) return Promise.reject(new Error("Plugin is not initialized"));
  const requestId = `req_${++sequence}`;
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      pending.delete(requestId);
      reject(new Error(`Noteral did not answer ${method} in time`));
    }, REQUEST_TIMEOUT);
    pending.set(requestId, {
      resolve: resolve as (value: unknown) => void,
      reject,
      timer,
    });
    post({ type: "request", requestId, method, params: params ?? {} });
  });
}

function makeContext(manifest: PluginManifest): PluginContext {
  for (const item of manifest.contributes?.statusItems ?? []) statusItems.add(item.id);
  for (const item of manifest.contributes?.commands ?? []) commandItems.add(item.id);
  for (const item of manifest.contributes?.panels ?? []) panelItems.add(item.id);
  return {
    manifest,
    commands: {
      on(commandId, handler) {
        if (!commandItems.has(commandId)) throw new Error(`Command ${commandId} is not declared in plugin.json`);
        commandHandlers.set(commandId, handler);
        return () => commandHandlers.delete(commandId);
      },
    },
    status: {
      set(itemId, text, title) {
        if (!statusItems.has(itemId)) throw new Error(`Status item ${itemId} is not declared in plugin.json`);
        if (typeof text !== "string") return;
        post({ type: "status", itemId, text: text.slice(0, 160), title: title ? String(title).slice(0, 200) : "" });
      },
    },
    panels: {
      set(panelId, text) {
        if (!panelItems.has(panelId)) throw new Error(`Panel ${panelId} is not declared in plugin.json`);
        if (typeof text !== "string") return;
        post({ type: "panel", panelId, text: text.slice(0, 4000) });
      },
    },
    editor: {
      snapshot: () => request<EditorSnapshot>("editor.snapshot"),
      insertBlocks: (blocks) => request<void>("editor.insertBlocks", { blocks }),
    },
    blocks: {
      insert: (blocks) => request<void>("editor.insertBlocks", { blocks }),
    },
    pages: {
      list: () => request<PageRef[]>("pages.list"),
      get: (pageId) => request<PageRef | null>("pages.get", { pageId }),
    },
    workspaces: {
      list: () => request<WorkspaceRef[]>("workspaces.list"),
      current: () => request<WorkspaceRef | null>("workspaces.current"),
    },
    tabs: {
      list: () => request<TabRef[]>("tabs.list"),
      open: (pageId) => request<void>("navigation.openPage", { pageId }),
    },
    navigation: {
      openPage: (pageId) => request<void>("navigation.openPage", { pageId }),
    },
    search: {
      query: (text) => request<SearchHit[]>("search.query", { query: text }),
    },
    assets: {
      pickImage: () => request<string | null>("assets.pickImage"),
      pickFile: () => request<string | null>("assets.pickFile"),
    },
    settings: {
      get: () => request<Record<string, unknown>>("settings.get"),
      set: (patch) => request<Record<string, unknown>>("settings.set", { patch }),
    },
    events: {
      on(event, handler) {
        if (event !== "document:changed" && event !== "theme:changed") {
          throw new Error(`Unknown plugin event ${event}`);
        }
        let set = eventHandlers.get(event);
        if (!set) {
          set = new Set();
          eventHandlers.set(event, set);
        }
        set.add(handler);
        return () => set!.delete(handler);
      },
    },
    ui: {
      notify(message) {
        post({ type: "request", requestId: `req_${++sequence}`, method: "ui.notify", params: { message } });
      },
    },
  };
}

async function begin(init: { manifest: PluginManifest }) {
  if (initialized || initializing) return;
  initializing = true;
  try {
    context = makeContext(init.manifest);
    // Requests are legal from inside setup(); the host has already sent init.
    initialized = true;
    if (setup) await setup(context);
    post({ type: "ready" });
  } catch (err) {
    post({ type: "error", message: err instanceof Error ? err.message : String(err) });
  } finally {
    initializing = false;
  }
}

function onMessage(event: MessageEvent) {
  // The host is the parent; messages from any other window are ignored.
  if (event.source !== window.parent) return;
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== "object" || message.__noteral !== PROTOCOL) return;
  switch (message.type) {
    case "init":
      void begin(message as unknown as { manifest: PluginManifest });
      break;
    case "command": {
      const commandId = String(message.commandId ?? "");
      const requestId = String(message.requestId ?? "");
      const handler = commandHandlers.get(commandId);
      if (!handler) {
        post({ type: "commandResult", requestId, ok: false, error: `No handler for ${commandId}` });
        return;
      }
      Promise.resolve()
        .then(handler)
        .then(() => post({ type: "commandResult", requestId, ok: true }))
        .catch((err) => post({ type: "commandResult", requestId, ok: false, error: err instanceof Error ? err.message : String(err) }));
      break;
    }
    case "event": {
      const name = String(message.event ?? "");
      const handlers = eventHandlers.get(name);
      if (handlers) for (const handler of handlers) handler(message.data);
      break;
    }
    case "response": {
      const requestId = String(message.requestId ?? "");
      const entry = pending.get(requestId);
      if (!entry) return;
      pending.delete(requestId);
      window.clearTimeout(entry.timer);
      if (message.ok) entry.resolve(message.result);
      else entry.reject(new Error(String(message.error ?? "Plugin request failed")));
      break;
    }
    case "shutdown":
      initialized = false;
      context = null;
      setup = null;
      for (const entry of pending.values()) {
        window.clearTimeout(entry.timer);
        entry.reject(new Error("Plugin stopped"));
      }
      pending.clear();
      break;
  }
}

/** Register a plugin entry point. Call once at module scope. */
export function definePlugin(fn: Setup): void {
  setup = fn;
  // If the host's init won the race, start immediately.
  const maybeInit = (window as unknown as { __noteralInit?: { manifest: PluginManifest } }).__noteralInit;
  if (maybeInit) void begin(maybeInit);
}

export const version = VERSION;

if (typeof window !== "undefined") {
  (window as unknown as { Noteral: NoteralGlobal }).Noteral = { version: VERSION, definePlugin };
  window.addEventListener("message", onMessage);
  window.addEventListener("error", (event) => {
    post({ type: "error", message: event.message || "Plugin script error" });
  });
  window.addEventListener("unhandledrejection", (event) => {
    post({ type: "error", message: String(event.reason ?? "Unhandled plugin rejection") });
  });
}

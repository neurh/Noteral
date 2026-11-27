/**
 * SDK 2.2 methods that belong to the calling plugin itself: private storage, files in
 * its bundle, editor suggesters and the APIs plugins expose to each other.
 */
import { api } from "../lib/api";
import { pluginExtensions } from "../lib/pluginExtensions";
import { pluginRuntime } from "../plugins/runtime";
import { ApiError } from "./host";
import { store } from "./handlers";
import type { CallContext } from "./handlers";
import type { PluginApiInfo, StorageEntryInfo, StorageUsageInfo } from "./types";

type Params = Record<string, unknown>;

/** Plugin id of the caller; layer-owned views and the assistant have no storage. */
function owner(ctx: CallContext): string {
  const id = ctx.pluginId ?? "";
  if (ctx.caller !== "plugin" || !id || id.includes(":")) throw new ApiError("Only installed plugins have private storage.", "not_allowed");
  return id;
}

function isTrial(ctx: CallContext) {
  return Boolean(ctx.frameKey?.startsWith("trial:"));
}

/** "" = global; otherwise the open workspace's id. */
function scopeOf(p: Params): string {
  if (p.scope === "global") return "";
  const workspace = store().workspace;
  if (!workspace) throw new ApiError("No workspace is open; use scope \"global\".", "failed");
  return workspace.id;
}

const str = (value: unknown) => (typeof value === "string" ? value : "");

export const PLUGIN_HANDLERS = {
  "storage.get": async (p: Params, ctx: CallContext): Promise<unknown> => {
    const id = owner(ctx);
    if (isTrial(ctx)) return null;
    const raw = await api.getPluginStorage(id, scopeOf(p), str(p.key));
    return raw ? JSON.parse(raw) : null;
  },
  "storage.set": async (p: Params, ctx: CallContext): Promise<void> => {
    const id = owner(ctx);
    if (isTrial(ctx)) return;
    const value = p.value === undefined || p.value === null ? "" : JSON.stringify(p.value);
    await api.setPluginStorage(id, scopeOf(p), str(p.key), value);
  },
  "storage.delete": async (p: Params, ctx: CallContext): Promise<void> => {
    const id = owner(ctx);
    if (isTrial(ctx)) return;
    await api.deletePluginStorage(id, scopeOf(p), str(p.key));
  },
  "storage.list": async (p: Params, ctx: CallContext): Promise<StorageEntryInfo[]> => {
    const id = owner(ctx);
    if (isTrial(ctx)) return [];
    const list = await api.listPluginStorage(id, scopeOf(p), str(p.prefix));
    return list.map((item) => ({ key: item.key, size: item.size, modified: item.modified }));
  },
  "storage.clear": async (p: Params, ctx: CallContext): Promise<number> => {
    const id = owner(ctx);
    if (isTrial(ctx)) return 0;
    return api.clearPluginStorage(id, scopeOf(p), str(p.prefix));
  },
  "storage.usage": async (_p: Params, ctx: CallContext): Promise<StorageUsageInfo> => {
    const id = owner(ctx);
    if (isTrial(ctx)) return { keys: 0, bytes: 0, maxBytes: 0 };
    const usage = await api.getPluginStorageUsage(id);
    return { keys: usage.keys, bytes: usage.bytes, maxBytes: usage.maxBytes };
  },

  "runtime.readFile": async (p: Params, ctx: CallContext): Promise<string> => {
    const id = owner(ctx);
    const encoding = p.encoding === "base64" ? "base64" : "text";
    return api.readPluginFile(id, str(p.path), encoding);
  },

  "editor.registerSuggester": (p: Params, ctx: CallContext): void => {
    const id = owner(ctx);
    if (isTrial(ctx)) return;
    try {
      pluginExtensions.addSuggester({
        pluginId: id,
        pluginName: ctx.pluginName ?? id,
        id: str(p.id),
        trigger: str(p.trigger),
        minChars: typeof p.minChars === "number" ? p.minChars : 0,
        maxItems: typeof p.maxItems === "number" ? p.maxItems : 12,
        onSelect: p.onSelect === true,
      });
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), "invalid_params");
    }
  },
  "editor.unregisterSuggester": (p: Params, ctx: CallContext): void => {
    pluginExtensions.removeSuggester(owner(ctx), str(p.id));
  },

  "plugins.expose": (p: Params, ctx: CallContext): void => {
    const id = owner(ctx);
    if (isTrial(ctx)) return;
    const methods = Array.isArray(p.methods) ? Array.from(new Set(p.methods.filter((item): item is string => typeof item === "string" && /^[A-Za-z_$][\w$.-]{0,63}$/.test(item)))) : [];
    const info = store().plugins.find((plugin) => plugin.manifest.id === id);
    try {
      pluginExtensions.expose({ pluginId: id, pluginName: ctx.pluginName ?? id, version: info?.manifest.version ?? "", methods });
    } catch (error) {
      throw new ApiError(error instanceof Error ? error.message : String(error), "invalid_params");
    }
  },
  "plugins.running": (_p: Params, _ctx: CallContext): PluginApiInfo[] => {
    return store()
      .plugins.map((plugin) => plugin.manifest)
      .filter((manifest) => pluginRuntime.isRunning(manifest.id))
      .map((manifest) => ({ id: manifest.id, name: manifest.name, version: manifest.version, methods: pluginExtensions.api(manifest.id)?.methods ?? [] }));
  },
  "plugins.call": async (p: Params, ctx: CallContext): Promise<unknown> => {
    const caller = owner(ctx);
    const target = str(p.plugin);
    const method = str(p.method);
    const exposed = pluginExtensions.api(target);
    if (!pluginRuntime.isRunning(target)) throw new ApiError(`Plugin "${target}" is not running.`, "failed");
    if (!exposed?.methods.includes(method)) throw new ApiError(`Plugin "${target}" does not expose "${method}".`, "unknown_method");
    const timeout = typeof p.timeoutMs === "number" ? p.timeoutMs : 10_000;
    return pluginRuntime.invoke(target, `__api:${method}`, { args: p.args ?? null, caller }, timeout);
  },
};

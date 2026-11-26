/**
 * The "Configure <plugin>" dialog: the plugin's option fields (manifest `contributes.settings`
 * and `settings.define`) plus, optionally, a custom HTML options page the plugin registered with
 * `settings.setPage`. Opened from Plugins → Installed, the command palette, a plugin widget's
 * right-click menu, or by the plugin itself with `settings.openOptions`.
 */
import { useSyncExternalStore } from "react";

export interface PluginOptionsPage {
  html: string;
  title?: string;
  /** Pixels; the dialog grows to fit up to this. */
  height?: number;
  width?: number;
  /** Show the plain option fields under the page too (default true). */
  showFields?: boolean;
}

type Listener = () => void;

let openId: string | null = null;
const pages = new Map<string, PluginOptionsPage>();
let version = 0;
const listeners = new Set<Listener>();

function emit() {
  version += 1;
  for (const listener of listeners) listener();
}

export const pluginConfigure = {
  open(pluginId: string) {
    openId = pluginId;
    emit();
  },
  close() {
    if (openId === null) return;
    openId = null;
    emit();
  },
  openId: () => openId,
  setPage(pluginId: string, page: PluginOptionsPage | null) {
    if (page) pages.set(pluginId, page);
    else pages.delete(pluginId);
    emit();
  },
  page: (pluginId: string) => pages.get(pluginId),
  hasPage: (pluginId: string) => pages.has(pluginId),
  /** Forget a stopped plugin's page and close its dialog. */
  forget(pluginId: string) {
    const had = pages.delete(pluginId);
    if (openId === pluginId) openId = null;
    if (had || openId === null) emit();
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

export function usePluginConfigure(): { openId: string | null; version: number } {
  const current = useSyncExternalStore(pluginConfigure.subscribe, () => version, () => version);
  return { openId, version: current };
}

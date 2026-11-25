import { api } from "./api";
import type { Manifest } from "./api";
import { contributions, normalizeSettingField, settingDefaults } from "./contributions";
import type { SettingFieldDef } from "./contributions";

/**
 * A plugin's user-editable options: fields declared in manifest.json `contributes.settings`
 * plus any the running plugin added with `settings.define`. Values live in the plugin's
 * saved settings (the same store as `settings.get/set`).
 */
export function optionFields(manifest: Manifest): SettingFieldDef[] {
  const live = contributions.get({ kind: "plugin", id: manifest.id })?.settings;
  if (live?.length) return live;
  const out: SettingFieldDef[] = [];
  for (const field of manifest.contributes?.settings ?? []) {
    const def = normalizeSettingField(field);
    if (def) out.push(def);
  }
  return out;
}

/** Saved values merged over each field's default. */
export async function loadOptions(pluginId: string, fields: readonly SettingFieldDef[]): Promise<Record<string, unknown>> {
  const saved = ((await api.getPluginSettings(pluginId)) ?? {}) as Record<string, unknown>;
  const out = settingDefaults(fields);
  for (const field of fields) if (saved[field.key] !== undefined) out[field.key] = saved[field.key];
  return out;
}

type ChangeListener = (pluginId: string, saved: Record<string, unknown>, changed: string[]) => void;
const listeners = new Set<ChangeListener>();

/** Saves a patch (null removes a key) and tells the plugin and its views. */
export async function saveOptions(pluginId: string, patch: Record<string, unknown>): Promise<Record<string, unknown>> {
  const saved = ((await api.savePluginSettings(pluginId, patch)) ?? {}) as Record<string, unknown>;
  const changed = Object.keys(patch);
  for (const listener of listeners) listener(pluginId, saved, changed);
  return saved;
}

/** The plugin runtime listens here to raise `settings:changed`. */
export function onOptionsSaved(listener: ChangeListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Clamp/convert a value to what a field accepts. */
export function coerceOption(field: SettingFieldDef, value: unknown): unknown {
  switch (field.type) {
    case "toggle":
      return Boolean(value);
    case "number":
    case "slider": {
      let n = typeof value === "number" ? value : Number(value);
      if (!Number.isFinite(n)) n = typeof field.default === "number" ? field.default : 0;
      if (field.min !== undefined) n = Math.max(field.min, n);
      if (field.max !== undefined) n = Math.min(field.max, n);
      return n;
    }
    case "select": {
      const text = String(value ?? "");
      return field.options?.some((option) => option.value === text) ? text : field.options?.[0]?.value ?? "";
    }
    default:
      return String(value ?? "");
  }
}

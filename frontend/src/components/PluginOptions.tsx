import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { LoaderCircle, RotateCcw } from "lucide-react";
import type { Manifest } from "../lib/api";
import { errorMessage } from "../lib/api";
import { useContributions } from "../lib/contributions";
import type { SettingFieldDef } from "../lib/contributions";
import { coerceOption, loadOptions, optionFields, saveOptions } from "../lib/pluginOptions";
import { useAppStore } from "../store";

/** Fields this plugin lets the user edit; re-reads when the running plugin defines more. */
export function usePluginOptionFields(manifest: Manifest): SettingFieldDef[] {
  // The snapshot changes whenever contributions change, e.g. a plugin calls settings.define.
  const snapshot = useContributions();
  return useMemo(() => optionFields(manifest), [manifest, snapshot]);
}

/**
 * The Options form for one plugin: fields from manifest.json `contributes.settings` and
 * `settings.define`. Each change saves right away (debounced for typing) and raises
 * `settings:changed` in the plugin.
 */
export function PluginOptions({ manifest }: { manifest: Manifest }) {
  const fields = usePluginOptionFields(manifest);
  const [values, setValues] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const fieldsKey = fields.map((field) => field.key).join("\n");
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  useEffect(() => {
    let live = true;
    loadOptions(manifest.id, fieldsRef.current)
      .then((next) => live && setValues(next))
      .catch(() => live && setValues({}));
    return () => {
      live = false;
    };
  }, [manifest.id, fieldsKey]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
    };
  }, []);

  const save = (patch: Record<string, unknown>) => {
    setSaving(true);
    saveOptions(manifest.id, patch)
      .catch((error) => useAppStore.getState().notify(`${manifest.name}: ${errorMessage(error)}`, "error"))
      .finally(() => setSaving(false));
  };

  const change = (field: SettingFieldDef, raw: unknown, delay = 0) => {
    const value = field.type === "text" || field.type === "textarea" || field.type === "color" ? String(raw ?? "") : coerceOption(field, raw);
    setValues((current) => ({ ...(current ?? {}), [field.key]: value }));
    const existing = timers.current.get(field.key);
    if (existing) clearTimeout(existing);
    if (!delay) {
      save({ [field.key]: value });
      return;
    }
    timers.current.set(
      field.key,
      setTimeout(() => {
        timers.current.delete(field.key);
        save({ [field.key]: field.type === "number" ? coerceOption(field, value) : value });
      }, delay),
    );
  };

  const reset = () => {
    const patch: Record<string, unknown> = {};
    for (const field of fields) patch[field.key] = null;
    const defaults: Record<string, unknown> = {};
    for (const field of fields) defaults[field.key] = field.default ?? coerceOption(field, undefined);
    setValues(defaults);
    save(patch);
  };

  if (!fields.length) return null;
  if (!values) {
    return (
      <div className="plugin-options is-loading">
        <LoaderCircle size={13} className="spin" /> Loading options…
      </div>
    );
  }

  const sections: { title: string; fields: SettingFieldDef[] }[] = [];
  for (const field of fields) {
    const title = field.section ?? "";
    let section = sections.find((item) => item.title === title);
    if (!section) sections.push((section = { title, fields: [] }));
    section.fields.push(field);
  }

  return (
    <div className="plugin-options">
      {sections.map((section) => (
        <section key={section.title || "_"} className="plugin-options-section">
          {section.title ? <h5>{section.title}</h5> : null}
          {section.fields.map((field) => (
            <OptionField key={field.key} id={`${manifest.id}-${field.key}`} field={field} value={values[field.key]} onChange={change} />
          ))}
        </section>
      ))}
      <div className="plugin-options-foot">
        <span className="plugin-options-status" aria-live="polite">
          {saving ? "Saving…" : "Changes save automatically"}
        </span>
        <button type="button" className="text-button" onClick={reset}>
          <RotateCcw size={12} /> Reset to defaults
        </button>
      </div>
    </div>
  );
}

export function OptionField({
  id,
  field,
  value,
  onChange,
}: {
  id: string;
  field: SettingFieldDef;
  value: unknown;
  onChange: (field: SettingFieldDef, value: unknown, delay?: number) => void;
}) {
  const help = field.description ? <p className="plugin-option-help">{field.description}</p> : null;

  if (field.type === "toggle") {
    return (
      <div className="plugin-option is-toggle">
        <div className="plugin-option-text">
          <label htmlFor={id}>{field.label}</label>
          {help}
        </div>
        <label className="switch">
          <input id={id} type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(field, event.target.checked)} />
          <span className="switch-track" aria-hidden="true">
            <span className="switch-thumb" />
          </span>
        </label>
      </div>
    );
  }

  let control: ReactNode;
  switch (field.type) {
    case "textarea":
      control = (
        <textarea id={id} rows={3} value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(field, event.target.value, 450)} />
      );
      break;
    case "number":
      control = (
        <input
          id={id}
          type="number"
          value={String(value ?? "")}
          min={field.min}
          max={field.max}
          step={field.step}
          onChange={(event) => onChange(field, event.target.value === "" ? field.default : Number(event.target.value), 450)}
        />
      );
      break;
    case "slider":
      control = (
        <div className="plugin-option-slider">
          <input
            id={id}
            type="range"
            value={Number(value ?? field.min ?? 0)}
            min={field.min ?? 0}
            max={field.max ?? 100}
            step={field.step ?? 1}
            onChange={(event) => onChange(field, Number(event.target.value), 200)}
          />
          <output htmlFor={id}>{String(value ?? "")}</output>
        </div>
      );
      break;
    case "select":
      control = (
        <select id={id} value={String(value ?? "")} onChange={(event) => onChange(field, event.target.value)}>
          {(field.options ?? []).map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      );
      break;
    case "color":
      control = (
        <div className="plugin-option-color">
          <input id={id} type="color" value={/^#[0-9a-f]{6}$/i.test(String(value)) ? String(value) : "#000000"} onChange={(event) => onChange(field, event.target.value, 200)} />
          <code>{String(value ?? "")}</code>
        </div>
      );
      break;
    default:
      control = <input id={id} type="text" value={String(value ?? "")} placeholder={field.placeholder} onChange={(event) => onChange(field, event.target.value, 450)} />;
  }

  return (
    <div className={`plugin-option is-${field.type}`}>
      <label htmlFor={id}>{field.label}</label>
      {help}
      {control}
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import { Brain, Check, EyeOff, Image, LoaderCircle, Pencil, Plus, RefreshCw, RotateCcw, Search } from "lucide-react";
import { DEFAULT_CONTEXT_WINDOW, THINKING_INFO, THINKING_LEVELS, defaultContextWindow, defaultThinkingLevels, displayModel, guessVision, modelKey, resolveModel } from "./models";
import type { ModelConfig, ThinkingLevel } from "./models";
import { useAssistant } from "./store";

/** 131072 → "131K", 1048576 → "1M". */
export function shortTokens(value: number): string {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(value % 1_000_000 ? 1 : 0))}M`;
  if (value >= 1000) return `${Math.round(value / 1000)}K`;
  return String(value);
}

function clamp(value: number, min: number, max: number): number | undefined {
  if (!Number.isFinite(value)) return undefined;
  return Math.min(max, Math.max(min, value));
}

/** Writes one model's overrides; removing every field drops the entry. */
export function useModelConfig(providerId: string, model: string) {
  const config = useAssistant((state) => state.settings.models[modelKey(providerId, model)]);
  const updateSettings = useAssistant((state) => state.updateSettings);
  const set = (patch: Partial<ModelConfig> | null) => {
    const key = modelKey(providerId, model);
    const models = { ...useAssistant.getState().settings.models };
    if (patch === null) delete models[key];
    else {
      const next: Record<string, unknown> = { ...models[key], ...patch };
      for (const [field, value] of Object.entries(next)) if (value === undefined || value === "") delete next[field];
      if (Object.keys(next).length) models[key] = next as ModelConfig;
      else delete models[key];
    }
    updateSettings({ models });
  };
  return { config, set };
}

/**
 * The models a provider offers, as a list: pick the default with a click, open a model's
 * options with its pencil. Used by the provider editor after "Load models".
 */
export function ModelList({
  providerId,
  kind,
  models,
  value,
  onChange,
  onAdd,
  onLoad,
  loading,
}: {
  providerId: string;
  kind: string;
  models: string[];
  value: string;
  onChange: (model: string) => void;
  onAdd: (model: string) => void;
  onLoad: () => void;
  loading: boolean;
}) {
  const configs = useAssistant((state) => state.settings.models);
  const discovered = useAssistant((state) => state.settings.discovered);
  const [filter, setFilter] = useState("");
  const [editing, setEditing] = useState("");
  const [adding, setAdding] = useState("");

  const all = useMemo(() => {
    const list = [...models];
    if (value && !list.includes(value)) list.unshift(value);
    return list;
  }, [models, value]);
  const needle = filter.trim().toLowerCase();
  const shown = needle
    ? all.filter((model) => model.toLowerCase().includes(needle) || (configs[modelKey(providerId, model)]?.label ?? "").toLowerCase().includes(needle))
    : all;
  const custom = adding.trim();
  const listRef = useRef<HTMLUListElement>(null);
  // Bring the chosen model into view when the list (re)loads; a long list is alphabetical.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>(".model-row.is-selected");
    if (list && row) list.scrollTop = Math.max(0, row.offsetTop - list.clientHeight / 2 + row.offsetHeight / 2);
  }, [all.length]);

  return (
    <div className="model-list-wrap">
      <div className="model-list-head">
        <span className="model-list-title">
          Models <small>{all.length ? `${all.length}` : ""}</small>
        </span>
        <button type="button" className="assistant-link" onClick={onLoad} disabled={loading}>
          {loading ? <LoaderCircle size={10} className="spin" /> : <RefreshCw size={10} />} {all.length ? "Reload" : "Load models"}
        </button>
      </div>
      {all.length > 6 ? (
        <label className="model-list-filter">
          <Search size={12} aria-hidden />
          <input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder={`Filter ${all.length} models…`} spellCheck={false} aria-label="Filter models" />
        </label>
      ) : null}
      {all.length ? (
        <ul ref={listRef} className="model-list" role="listbox" aria-label="Models">
          {shown.map((model) => {
            const key = modelKey(providerId, model);
            const config = configs[key];
            const resolved = resolveModel(configs, discovered, providerId, kind, model);
            const selected = model === value;
            const open = editing === model;
            return (
              <li key={model} className={`model-row${selected ? " is-selected" : ""}${open ? " is-open" : ""}${config?.hidden ? " is-hidden" : ""}`}>
                <div className="model-row-main">
                  <button type="button" role="option" aria-selected={selected} className="model-row-pick" onClick={() => onChange(model)} title={model}>
                    <span className="model-row-check" aria-hidden>
                      {selected ? <Check size={12} /> : null}
                    </span>
                    <span className="model-row-name">
                      <span className="model-row-label">{resolved.label}</span>
                      {resolved.label !== displayModel(model) || model !== displayModel(model) ? <span className="model-row-id">{model}</span> : null}
                    </span>
                    <span className="model-row-badges">
                      {config?.hidden ? (
                        <span title="Hidden from the picker">
                          <EyeOff size={11} />
                        </span>
                      ) : null}
                      {resolved.vision ? (
                        <span title="Reads images and PDFs">
                          <Image size={11} />
                        </span>
                      ) : null}
                      {resolved.thinking.length ? (
                        <span title="Thinking">
                          <Brain size={11} />
                        </span>
                      ) : null}
                      <span className={`model-row-window${resolved.knownWindow ? "" : " is-guess"}`} title={resolved.knownWindow ? "Context window" : "Context window (estimated)"}>
                        {shortTokens(resolved.contextWindow)}
                      </span>
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`icon-button model-row-edit${config ? " has-changes" : ""}`}
                    onClick={() => setEditing(open ? "" : model)}
                    aria-expanded={open}
                    aria-label={`Options for ${model}`}
                    title="Model options"
                  >
                    <Pencil size={12} />
                  </button>
                </div>
                {open ? <ModelOptions providerId={providerId} kind={kind} model={model} /> : null}
              </li>
            );
          })}
          {!shown.length ? <li className="model-list-empty">No model matches “{filter}”.</li> : null}
        </ul>
      ) : (
        <p className="assistant-section-note">Load the provider's models, or add a model id below.</p>
      )}
      <form
        className="assistant-model-add"
        onSubmit={(event) => {
          event.preventDefault();
          if (!custom) return;
          onAdd(custom);
          setAdding("");
          setEditing("");
        }}
      >
        <input className="inline-input" value={adding} onChange={(event) => setAdding(event.target.value)} placeholder="Add a model id…" spellCheck={false} aria-label="Model id" />
        <button type="submit" className="secondary-button" disabled={!custom}>
          <Plus size={12} /> Add
        </button>
      </form>
    </div>
  );
}

/** One model's overrides: name, context window, output limit, temperature, vision, thinking, visibility. */
export function ModelOptions({ providerId, kind, model }: { providerId: string; kind: string; model: string }) {
  const { config, set } = useModelConfig(providerId, model);
  const discovered = useAssistant((state) => state.settings.discovered[modelKey(providerId, model)]);
  const globalMax = useAssistant((state) => state.settings.maxTokens);
  const configs = useAssistant((state) => state.settings.models);
  const resolved = resolveModel(configs, discovered ? { [modelKey(providerId, model)]: discovered } : {}, providerId, kind, model);
  const guessWindow = discovered || defaultContextWindow(kind, model);
  const guessThinking = defaultThinkingLevels(kind, model);
  const visionGuess = guessVision(kind, model);

  const toggleLevel = (level: ThinkingLevel) => {
    const current = resolved.thinking;
    const next = current.includes(level) ? current.filter((item) => item !== level) : THINKING_LEVELS.filter((item) => item === level || current.includes(item));
    set({ thinking: next.join() === guessThinking.join() ? undefined : next });
  };

  return (
    <div className="model-options">
      <label className="model-option">
        <span>Name</span>
        <input className="inline-input" value={config?.label ?? ""} placeholder={displayModel(model)} onChange={(event) => set({ label: event.target.value || undefined })} aria-label="Display name" />
      </label>
      <label className="model-option">
        <span>Context window</span>
        <span className="model-option-control">
          <input
            className="inline-input"
            type="number"
            min={1000}
            max={10_000_000}
            step={1000}
            value={config?.contextWindow ?? ""}
            placeholder={`${guessWindow.toLocaleString()}${discovered ? "" : " (estimate)"}`}
            onChange={(event) => set({ contextWindow: event.target.value === "" ? undefined : clamp(Number(event.target.value), 1000, 10_000_000) ?? DEFAULT_CONTEXT_WINDOW })}
          />
          <small>tokens</small>
        </span>
      </label>
      <label className="model-option">
        <span>Max reply</span>
        <span className="model-option-control">
          <input
            className="inline-input"
            type="number"
            min={256}
            max={200_000}
            step={256}
            value={config?.maxOutput ?? ""}
            placeholder={`${globalMax.toLocaleString()} (default)`}
            onChange={(event) => set({ maxOutput: event.target.value === "" ? undefined : clamp(Number(event.target.value), 256, 200_000) })}
          />
          <small>tokens</small>
        </span>
      </label>
      <label className="model-option">
        <span>Temperature</span>
        <span className="model-option-control">
          <input
            className="inline-input"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={config?.temperature ?? ""}
            placeholder="Default"
            onChange={(event) => set({ temperature: event.target.value === "" ? undefined : clamp(Number(event.target.value), 0, 2) })}
          />
        </span>
      </label>
      <div className="model-option is-stacked">
        <span>Files</span>
        <div className="assistant-levels" role="radiogroup" aria-label="Images and PDFs">
          {([
            ["auto", `Auto (${visionGuess ? "yes" : "no"})`],
            ["on", "Images"],
            ["off", "Text only"],
          ] as const).map(([id, label]) => {
            const current = config?.vision === undefined ? "auto" : config.vision ? "on" : "off";
            return (
              <button key={id} type="button" role="radio" aria-checked={current === id} className={`assistant-level${current === id ? " on" : ""}`} onClick={() => set({ vision: id === "auto" ? undefined : id === "on" })}>
                {label}
              </button>
            );
          })}
        </div>
      </div>
      <div className="model-option is-stacked">
        <span>Thinking</span>
        <div className="assistant-levels" role="group" aria-label="Thinking levels">
          {THINKING_LEVELS.map((level) => (
            <button key={level} type="button" aria-pressed={resolved.thinking.includes(level)} className={`assistant-level${resolved.thinking.includes(level) ? " on" : ""}`} onClick={() => toggleLevel(level)} title={THINKING_INFO[level].hint}>
              {THINKING_INFO[level].label}
            </button>
          ))}
        </div>
      </div>
      <div className="model-options-foot">
        <label className="assistant-check">
          <input type="checkbox" checked={!config?.hidden} onChange={(event) => set({ hidden: event.target.checked ? undefined : true })} />
          <span>Show in the model picker</span>
        </label>
        {config ? (
          <button type="button" className="assistant-mini" onClick={() => set(null)} title="Use the detected defaults">
            <RotateCcw size={11} /> Reset
          </button>
        ) : null}
      </div>
    </div>
  );
}

import { useState } from "react";
import { Browser } from "@wailsio/runtime";
import { Check, ExternalLink, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { api, errorMessage, list } from "../lib/api";
import type { ProviderView } from "../lib/api";
import { dialogs } from "../lib/dialogs";
import { DEFAULT_CONTEXT_WINDOW, THINKING_INFO, THINKING_LEVELS, defaultContextWindow, defaultThinkingLevels, displayModel, modelKey, resolveModel } from "./models";
import type { ModelConfig, ThinkingLevel } from "./models";
import { PRESETS, presetFor } from "./providers";
import type { ProviderPreset } from "./providers";
import { useAssistant } from "./store";

type Editing = { provider?: ProviderView; preset: ProviderPreset } | null;

/** Providers list, provider editor and assistant behaviour settings. */
export function ProvidersView() {
  const providers = useAssistant((state) => state.providers);
  const [editing, setEditing] = useState<Editing>(null);
  const [picking, setPicking] = useState(providers.length === 0);

  if (editing) return <ProviderEditor editing={editing} onDone={() => setEditing(null)} />;

  return (
    <div className="assistant-scroll assistant-settings">
      <section className="assistant-section">
        <div className="assistant-section-head">
          <h4>Providers</h4>
          {!picking ? (
            <button type="button" className="text-button" onClick={() => setPicking(true)}>
              <Plus size={13} /> Add
            </button>
          ) : null}
        </div>
        {providers.length ? (
          <ul className="assistant-provider-list">
            {providers.map((provider) => (
              <ProviderRow key={provider.id} provider={provider} onEdit={() => setEditing({ provider, preset: presetFor(provider.preset) ?? presetFor("custom")! })} />
            ))}
          </ul>
        ) : null}
        {picking ? (
          <div className="assistant-presets">
            {providers.length ? <p className="assistant-hint">Pick a service to connect.</p> : <p className="assistant-hint">Pick a service to connect. Keys are stored only on this computer.</p>}
            <div className="assistant-preset-grid">
              {PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  className="assistant-preset"
                  onClick={() => {
                    setPicking(false);
                    setEditing({ preset });
                  }}
                >
                  <span className="assistant-preset-name">
                    {preset.name}
                    {preset.local ? <em>Local</em> : null}
                  </span>
                  <span className="assistant-preset-note">{preset.note}</span>
                </button>
              ))}
            </div>
            {providers.length ? (
              <button type="button" className="text-button" onClick={() => setPicking(false)}>
                Cancel
              </button>
            ) : null}
          </div>
        ) : null}
      </section>
      <ModelSettings />
      <BehaviourSettings />
    </div>
  );
}

function ProviderRow({ provider, onEdit }: { provider: ProviderView; onEdit: () => void }) {
  const saveProvider = useAssistant((state) => state.saveProvider);
  const deleteProvider = useAssistant((state) => state.deleteProvider);
  const selected = useAssistant((state) => state.settings.providerId === provider.id);
  const preset = presetFor(provider.preset);

  const toggle = () =>
    void saveProvider({ ...provider, apiKey: null, models: provider.models, headers: provider.headers, enabled: !provider.enabled }).catch(() => undefined);

  const remove = async () => {
    const ok = await dialogs.confirm({
      title: `Remove ${provider.name}?`,
      message: "Its saved key is deleted from this computer. Chats are kept.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (ok) await deleteProvider(provider.id);
  };

  return (
    <li className={`assistant-provider${provider.enabled ? "" : " disabled"}`}>
      <div className="assistant-provider-main">
        <span className="assistant-provider-name">
          {provider.name}
          {selected ? <em>In use</em> : null}
        </span>
        <span className="assistant-provider-meta">
          {provider.defaultModel || provider.models?.[0] || "No model chosen"}
          {" · "}
          {provider.hasKey ? (
            <>
              <KeyRound size={10} /> {provider.keyHint}
            </>
          ) : preset?.needsKey ? (
            <span className="warn">No key</span>
          ) : (
            "No key needed"
          )}
        </span>
      </div>
      <label className="switch" title={provider.enabled ? "Disable" : "Enable"}>
        <input type="checkbox" checked={provider.enabled} onChange={toggle} aria-label={`Enable ${provider.name}`} />
        <span className="switch-track"><span className="switch-thumb" /></span>
      </label>
      <button type="button" className="icon-button" onClick={onEdit} aria-label={`Edit ${provider.name}`} title="Edit">
        <Pencil size={13} />
      </button>
      <button type="button" className="icon-button" onClick={() => void remove()} aria-label={`Remove ${provider.name}`} title="Remove">
        <Trash2 size={13} />
      </button>
    </li>
  );
}

function slug(text: string) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "provider";
}

function ProviderEditor({ editing, onDone }: { editing: NonNullable<Editing>; onDone: () => void }) {
  const { provider, preset } = editing;
  const providers = useAssistant((state) => state.providers);
  const saveProvider = useAssistant((state) => state.saveProvider);
  const [name, setName] = useState(provider?.name ?? preset.name);
  const [baseUrl, setBaseUrl] = useState(provider?.baseUrl ?? preset.baseUrl);
  const [apiKey, setApiKey] = useState("");
  const [models, setModels] = useState<string[]>(provider?.models?.length ? provider.models : preset.models);
  const [defaultModel, setDefaultModel] = useState(provider?.defaultModel || preset.models[0] || "");
  const [savedId, setSavedId] = useState(provider?.id ?? "");
  const [busy, setBusy] = useState<"" | "save" | "models">("");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const isCustom = preset.id === "custom";
  const keyRequired = preset.needsKey && !provider?.hasKey;

  const idFor = () => {
    if (savedId) return savedId;
    const base = slug(isCustom ? name : preset.id);
    let id = base;
    for (let n = 2; providers.some((item) => item.id === id); n++) id = `${base}-${n}`;
    return id;
  };

  const persist = async () => {
    const saved = await saveProvider({
      id: idFor(),
      kind: preset.kind,
      name: name.trim() || preset.name,
      preset: preset.id,
      baseUrl: baseUrl.trim(),
      apiKey: apiKey.trim() ? apiKey.trim() : null,
      models,
      defaultModel: defaultModel.trim(),
      headers: provider?.headers ?? null,
      enabled: provider?.enabled ?? true,
    });
    setSavedId(saved.id);
    setApiKey("");
    return saved;
  };

  const save = async () => {
    if (keyRequired && !apiKey.trim()) {
      setError("Paste an API key to continue.");
      return;
    }
    setBusy("save");
    setError("");
    try {
      await persist();
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  };

  const loadModels = async () => {
    if (keyRequired && !apiKey.trim()) {
      setError("Paste an API key first — it's needed to list models.");
      return;
    }
    setBusy("models");
    setError("");
    setNote("");
    try {
      const saved = await persist();
      const found = list(await api.listAIModels(saved.id)).map((item) => item.id).sort();
      if (!found.length) {
        setNote("Connected, but the provider returned no models. Type a model id below.");
        return;
      }
      setModels(found);
      if (!found.includes(defaultModel)) setDefaultModel(found[0]);
      setNote(`Connected — ${found.length} models available.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy("");
    }
  };

  return (
    <form
      className="assistant-scroll assistant-settings"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section className="assistant-section">
        <div className="assistant-section-head">
          <h4>{provider ? `Edit ${provider.name}` : `Connect ${preset.name}`}</h4>
        </div>
        <p className="assistant-hint">{preset.note}</p>

        <label className="assistant-field">
          <span>Name</span>
          <input className="inline-input" value={name} onChange={(event) => setName(event.target.value)} />
        </label>

        {preset.needsKey || isCustom ? (
          <label className="assistant-field">
            <span>
              API key
              {preset.keyUrl ? (
                <button type="button" className="assistant-link" onClick={() => void Browser.OpenURL(preset.keyUrl!).catch(() => window.open(preset.keyUrl, "_blank"))}>
                  Get a key <ExternalLink size={10} />
                </button>
              ) : null}
            </span>
            <input
              className="inline-input"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={provider?.hasKey ? `Saved (${provider.keyHint}) — paste to replace` : isCustom ? "Optional" : "Paste your key"}
              autoComplete="off"
              spellCheck={false}
              autoFocus={!provider}
            />
          </label>
        ) : null}

        <label className="assistant-field">
          <span>Base URL</span>
          <input className="inline-input mono" value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} spellCheck={false} placeholder="https://…/v1" />
          {preset.local ? <small>Runs on this computer. Start {preset.name} first, then load models.</small> : null}
        </label>

        <div className="assistant-field">
          <span>
            Model
            <button type="button" className="assistant-link" onClick={() => void loadModels()} disabled={Boolean(busy)}>
              {busy === "models" ? <LoaderCircle size={10} className="spin" /> : <RefreshCw size={10} />} Load models
            </button>
          </span>
          <input className="inline-input mono" list="assistant-model-options" value={defaultModel} onChange={(event) => setDefaultModel(event.target.value)} spellCheck={false} placeholder="model id" />
          <datalist id="assistant-model-options">
            {models.map((model) => (
              <option key={model} value={model} />
            ))}
          </datalist>
        </div>

        {note ? (
          <p className="assistant-note ok">
            <Check size={12} /> {note}
          </p>
        ) : null}
        {error ? (
          <p className="assistant-note error" role="alert">
            {error}
          </p>
        ) : null}

        <div className="assistant-form-actions">
          <button type="button" className="secondary-button" onClick={onDone}>
            Cancel
          </button>
          <button type="submit" className="primary-button" disabled={Boolean(busy)}>
            {busy === "save" ? "Saving…" : provider ? "Save" : "Connect"}
          </button>
        </div>
      </section>
    </form>
  );
}

/** Per-model context window and thinking levels. */
function ModelSettings() {
  const settings = useAssistant((state) => state.settings);
  const providers = useAssistant((state) => state.providers);
  const updateSettings = useAssistant((state) => state.updateSettings);
  const discoverModels = useAssistant((state) => state.discoverModels);
  const [adding, setAdding] = useState("");
  const [busy, setBusy] = useState(false);

  const enabled = providers.filter((item) => item.enabled);
  // The selected model, any model with an override, then each provider's default.
  const rows: { providerId: string; model: string }[] = [];
  const seen = new Set<string>();
  const add = (providerId: string, model: string) => {
    const key = modelKey(providerId, model);
    if (!model || seen.has(key) || !providers.some((item) => item.id === providerId)) return;
    seen.add(key);
    rows.push({ providerId, model });
  };
  add(settings.providerId, settings.model);
  for (const key of Object.keys(settings.models)) {
    const at = key.indexOf("/");
    if (at > 0) add(key.slice(0, at), key.slice(at + 1));
  }
  for (const provider of enabled) add(provider.id, provider.defaultModel);

  const setConfig = (key: string, patch: Partial<ModelConfig> | null) => {
    const models = { ...settings.models };
    if (patch === null) delete models[key];
    else {
      const next = { ...models[key], ...patch };
      if (next.contextWindow === undefined) delete next.contextWindow;
      if (next.thinking === undefined) delete next.thinking;
      if (Object.keys(next).length) models[key] = next;
      else delete models[key];
    }
    updateSettings({ models });
  };

  const provider = providers.find((item) => item.id === settings.providerId);

  return (
    <section className="assistant-section">
      <div className="assistant-section-head">
        <h4>Models</h4>
        {provider ? (
          <button
            type="button"
            className="assistant-mini"
            disabled={busy}
            title={`Ask ${provider.name} for its models' context sizes`}
            onClick={async () => {
              setBusy(true);
              try {
                await discoverModels(provider.id);
              } finally {
                setBusy(false);
              }
            }}
          >
            {busy ? <LoaderCircle size={12} className="spin" /> : <RefreshCw size={12} />} Detect sizes
          </button>
        ) : null}
      </div>
      <p className="assistant-section-note">The context ring in the chat uses these sizes. Thinking levels decide what the composer offers; untick all to hide it.</p>
      {rows.length === 0 ? <p className="assistant-section-note">Choose a model in the chat first.</p> : null}
      <div className="assistant-model-configs">
        {rows.map(({ providerId, model }) => {
          const owner = providers.find((item) => item.id === providerId)!;
          const key = modelKey(providerId, model);
          const config = settings.models[key];
          const resolved = resolveModel(settings.models, settings.discovered, providerId, owner.kind, model);
          const guessWindow = settings.discovered[key] || defaultContextWindow(owner.kind, model);
          const guessThinking = defaultThinkingLevels(owner.kind, model);
          const toggleLevel = (level: ThinkingLevel) => {
            const current = resolved.thinking;
            const next = current.includes(level) ? current.filter((item) => item !== level) : THINKING_LEVELS.filter((item) => item === level || current.includes(item));
            setConfig(key, { thinking: next.join() === guessThinking.join() ? undefined : next });
          };
          return (
            <div key={key} className="assistant-model-config">
              <div className="assistant-model-config-head">
                <strong title={model}>{displayModel(model)}</strong>
                <small>{owner.name}</small>
                {config ? (
                  <button type="button" className="assistant-mini" onClick={() => setConfig(key, null)} title="Use the detected defaults">
                    Reset
                  </button>
                ) : null}
              </div>
              <label className="assistant-field assistant-field-inline">
                <span>Context window</span>
                <input
                  className="inline-input"
                  type="number"
                  min={1000}
                  max={10_000_000}
                  step={1000}
                  value={config?.contextWindow ?? ""}
                  placeholder={`${guessWindow.toLocaleString()}${settings.discovered[key] ? "" : " (guess)"}`}
                  onChange={(event) => {
                    const value = event.target.value === "" ? undefined : clamp(Number(event.target.value), 1000, 10_000_000, DEFAULT_CONTEXT_WINDOW);
                    setConfig(key, { contextWindow: value });
                  }}
                  aria-label={`Context window for ${model}`}
                />
                <small>tokens</small>
              </label>
              <div className="assistant-field assistant-field-inline">
                <span>Thinking</span>
                <div className="assistant-levels" role="group" aria-label={`Thinking levels for ${model}`}>
                  {THINKING_LEVELS.map((level) => (
                    <button
                      key={level}
                      type="button"
                      aria-pressed={resolved.thinking.includes(level)}
                      className={`assistant-level${resolved.thinking.includes(level) ? " on" : ""}`}
                      onClick={() => toggleLevel(level)}
                      title={THINKING_INFO[level].hint}
                    >
                      {THINKING_INFO[level].label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {provider ? (
        <form
          className="assistant-model-add"
          onSubmit={(event) => {
            event.preventDefault();
            const model = adding.trim();
            if (!model) return;
            setConfig(modelKey(provider.id, model), { contextWindow: defaultContextWindow(provider.kind, model) });
            setAdding("");
          }}
        >
          <input className="inline-input" value={adding} onChange={(event) => setAdding(event.target.value)} placeholder={`Another ${provider.name} model id…`} spellCheck={false} aria-label="Model id" />
          <button type="submit" className="secondary-button" disabled={!adding.trim()}>
            <Plus size={12} /> Add
          </button>
        </form>
      ) : null}
    </section>
  );
}

function BehaviourSettings() {
  const settings = useAssistant((state) => state.settings);
  const updateSettings = useAssistant((state) => state.updateSettings);
  return (
    <section className="assistant-section">
      <div className="assistant-section-head">
        <h4>Behaviour</h4>
      </div>
      <fieldset className="assistant-field">
        <legend>Ask before</legend>
        <label className="assistant-radio">
          <input type="radio" name="approval" checked={settings.approval === "destructive"} onChange={() => updateSettings({ approval: "destructive" })} />
          <span>
            Destructive actions only
            <small>Trash, switching workspaces, resets and new plugins.</small>
          </span>
        </label>
        <label className="assistant-radio">
          <input type="radio" name="approval" checked={settings.approval === "writes"} onChange={() => updateSettings({ approval: "writes" })} />
          <span>
            Every change
            <small>Approve each edit, page and setting change one by one.</small>
          </span>
        </label>
      </fieldset>
      <label className="assistant-check">
        <input type="checkbox" checked={settings.webAccess} onChange={(event) => updateSettings({ webAccess: event.target.checked })} />
        <span>Allow web search and reading pages (free, no key)</span>
      </label>
      <div className="assistant-field-row">
        <label className="assistant-field">
          <span>Max steps</span>
          <input className="inline-input" type="number" min={1} max={64} value={settings.maxSteps} onChange={(event) => updateSettings({ maxSteps: clamp(Number(event.target.value), 1, 64, 24) })} />
        </label>
        <label className="assistant-field">
          <span>Max reply tokens</span>
          <input className="inline-input" type="number" min={256} max={64000} step={256} value={settings.maxTokens} onChange={(event) => updateSettings({ maxTokens: clamp(Number(event.target.value), 256, 64000, 8192) })} />
        </label>
        <label className="assistant-field">
          <span>Temperature</span>
          <input
            className="inline-input"
            type="number"
            min={0}
            max={2}
            step={0.1}
            value={settings.temperature ?? ""}
            placeholder="Default"
            onChange={(event) => updateSettings({ temperature: event.target.value === "" ? null : clamp(Number(event.target.value), 0, 2, 1) })}
          />
        </label>
      </div>
      <label className="assistant-field">
        <span>Custom instructions</span>
        <textarea
          className="inline-input assistant-instructions"
          rows={4}
          value={settings.instructions}
          onChange={(event) => updateSettings({ instructions: event.target.value })}
          placeholder="e.g. Write in British English. Keep answers short."
        />
      </label>
    </section>
  );
}

function clamp(value: number, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

import { useState } from "react";
import { Browser } from "@wailsio/runtime";
import { Check, ExternalLink, KeyRound, Pencil, Plus, Trash2 } from "lucide-react";
import { errorMessage } from "../lib/api";
import type { ProviderView } from "../lib/api";
import { dialogs } from "../lib/dialogs";
import { ModelList } from "./ModelList";
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
  const discoverModels = useAssistant((state) => state.discoverModels);
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
      const found = await discoverModels(saved.id);
      if (!found.length) {
        setNote("Connected, but the provider returned no models. Add a model id below.");
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

        <ModelList
          providerId={idFor()}
          kind={preset.kind}
          models={models}
          value={defaultModel}
          onChange={setDefaultModel}
          onAdd={(model) => {
            setModels((current) => (current.includes(model) ? current : [...current, model].sort()));
            setDefaultModel(model);
          }}
          onLoad={() => void loadModels()}
          loading={busy === "models"}
        />

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
      <label className="assistant-check">
        <input type="checkbox" checked={settings.agents !== false} onChange={(event) => updateSettings({ agents: event.target.checked })} />
        <span>Let the assistant start sub-agents that research in parallel (read-only)</span>
      </label>
      <div className="assistant-field-row">
        <label className="assistant-field">
          <span>Run at once</span>
          <input className="inline-input" type="number" min={1} max={8} value={settings.parallel ?? 4} onChange={(event) => updateSettings({ parallel: clamp(Number(event.target.value), 1, 8, 4) })} />
        </label>
      </div>
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
      <div className="assistant-field">
        <div className="assistant-field-row">
          <label className="assistant-field">
            <span>Retry failed requests</span>
            <input className="inline-input" type="number" min={0} max={10} value={settings.retries ?? 3} onChange={(event) => updateSettings({ retries: clamp(Number(event.target.value), 0, 10, 3) })} aria-describedby="assistant-retry-hint" />
          </label>
          <label className="assistant-field">
            <span>Seconds between retries</span>
            <input
              className="inline-input"
              type="number"
              min={1}
              max={120}
              value={settings.retryDelay ?? 10}
              disabled={!settings.retries}
              onChange={(event) => updateSettings({ retryDelay: clamp(Number(event.target.value), 1, 120, 10) })}
            />
          </label>
        </div>
        <small id="assistant-retry-hint">When a request fails for a passing reason (connection lost, provider busy or rate-limited), wait and send it again. 0 turns it off; Stop cancels the wait.</small>
      </div>
      <div className="assistant-field">
        <span>
          Auto-compact at <strong className="assistant-value">{settings.autoCompact ? `${settings.autoCompact}%` : "Off"}</strong>
        </span>
        <div className="assistant-slider-row">
          <input
            type="range"
            min={50}
            max={95}
            step={5}
            value={settings.autoCompact || 80}
            disabled={!settings.autoCompact}
            onChange={(event) => updateSettings({ autoCompact: Number(event.target.value) })}
            aria-label="Auto-compact threshold"
          />
          <label className="switch" title={settings.autoCompact ? "Turn auto-compact off" : "Turn auto-compact on"}>
            <input type="checkbox" checked={Boolean(settings.autoCompact)} onChange={(event) => updateSettings({ autoCompact: event.target.checked ? 80 : 0 })} aria-label="Auto-compact" />
            <span className="switch-track"><span className="switch-thumb" /></span>
          </label>
        </div>
        <small>When a chat fills this much of the model's context window, older turns are summarized in place so the chat can keep going.</small>
      </div>
      <label className="assistant-check">
        <input type="checkbox" checked={settings.toolLoading !== "all"} onChange={(event) => updateSettings({ toolLoading: event.target.checked ? "auto" : "all" })} />
        <span>
          Load tools on demand
          <small>Sends a small core set and lets the assistant load more when it needs them. Uses far fewer tokens per message.</small>
        </span>
      </label>
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

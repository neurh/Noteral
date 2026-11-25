import { useState } from "react";
import { Bot, ChevronDown, Copy, Layers, Puzzle, Trash2, UserRound } from "lucide-react";
import { customizations, useCustomizations } from "../lib/customizations";
import type { Layer } from "../lib/customizations";
import { dialogs } from "../lib/dialogs";
import { useAppStore } from "../store";

function sourceOf(layer: Layer) {
  if (layer.source === "plugin") return { label: layer.pluginId ? `Plugin ${layer.pluginId}` : "Plugin", icon: <Puzzle size={11} /> };
  if (layer.source === "user") return { label: "Yours", icon: <UserRound size={11} /> };
  return { label: "Made by assistant", icon: <Bot size={11} /> };
}

function ago(at: number) {
  const minutes = Math.round((Date.now() - at) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

/** What a layer changes, as short counted phrases ("4 colors", "2 sidebar tabs"). */
export function layerSummary(layer: Layer): string[] {
  const tokens = new Set([...Object.keys(layer.tokens.light), ...Object.keys(layer.tokens.dark)]).size;
  const count = (n: number, one: string, many = `${one}s`) => (n ? `${n} ${n === 1 ? one : many}` : "");
  return [
    count(tokens, "token"),
    count(Object.keys(layer.components).length, "component style"),
    count(layer.css.length, "CSS snippet"),
    count(layer.sidebarTabs.length, "sidebar tab"),
    count(layer.statusWidgets.length, "status widget"),
    count(layer.blockTypes.length, "block type"),
    count(layer.nodeTypes.length, "page type"),
    count(layer.menuItems.length, "menu item"),
  ].filter(Boolean);
}

function edit(id: string, change: (layer: Layer) => void) {
  customizations.update((draft) => {
    const layer = draft.layers.find((item) => item.id === id);
    if (!layer) return;
    change(layer);
    layer.updatedAt = Date.now();
  });
}

function LayerDetails({ layer }: { layer: Layer }) {
  const tokens = [...new Set([...Object.keys(layer.tokens.light), ...Object.keys(layer.tokens.dark)])];
  const components = Object.entries(layer.components);
  const ui = [
    ...layer.sidebarTabs.map((item) => ({ kind: "Sidebar tab", id: item.id, title: item.title })),
    ...layer.statusWidgets.map((item) => ({ kind: "Status widget", id: item.id, title: item.text || item.tooltip || item.id })),
    ...layer.blockTypes.map((item) => ({ kind: "Block type", id: item.type, title: item.title })),
    ...layer.nodeTypes.map((item) => ({ kind: "Page type", id: item.type, title: item.title })),
    ...layer.menuItems.map((item) => ({ kind: `Menu item (${item.menu})`, id: item.id, title: item.title })),
  ];
  return (
    <div className="layer-details">
      {tokens.length ? (
        <div className="layer-detail">
          <h5>Tokens</h5>
          <div className="layer-tokens">
            {tokens.map((name) => (
              <span key={name} className="layer-token" title={`light: ${layer.tokens.light[name] ?? "—"} · dark: ${layer.tokens.dark[name] ?? "—"}`}>
                <span className="layer-swatch" style={{ background: layer.tokens.light[name] ?? layer.tokens.dark[name] }} aria-hidden="true" />
                --{name}
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {components.length ? (
        <div className="layer-detail">
          <h5>Component styles</h5>
          {components.map(([id, style]) => (
            <div key={id} className="layer-line">
              <code>{id}</code>
              <span>{style.hidden ? "hidden" : [style.css ? "styles" : "", style.rules ? "rules" : ""].filter(Boolean).join(" + ")}</span>
              <button type="button" className="text-button" onClick={() => edit(layer.id, (draft) => void delete draft.components[id])}>Remove</button>
            </div>
          ))}
        </div>
      ) : null}
      {layer.css.length ? (
        <div className="layer-detail">
          <h5>CSS snippets</h5>
          {layer.css.map((snippet) => (
            <details key={snippet.id} className="layer-snippet">
              <summary>
                <label className="switch is-small" onClick={(event) => event.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={snippet.enabled}
                    aria-label={`Apply ${snippet.label}`}
                    onChange={(event) => edit(layer.id, (draft) => {
                      const item = draft.css.find((entry) => entry.id === snippet.id);
                      if (item) item.enabled = event.target.checked;
                    })}
                  />
                  <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
                </label>
                <span className="layer-snippet-name">{snippet.label}</span>
                <span className="plugin-meta">{snippet.css.length.toLocaleString()} chars</span>
              </summary>
              <pre>{snippet.css}</pre>
            </details>
          ))}
        </div>
      ) : null}
      {ui.length ? (
        <div className="layer-detail">
          <h5>Interface</h5>
          {ui.map((item) => (
            <div key={`${item.kind}:${item.id}`} className="layer-line">
              <span className="layer-kind">{item.kind}</span>
              <span>{item.title}</span>
              <code>{item.id}</code>
            </div>
          ))}
        </div>
      ) : null}
      {!tokens.length && !components.length && !layer.css.length && !ui.length ? <p className="plugin-tab-note">This layer is empty.</p> : null}
    </div>
  );
}

function LayerRow({ layer }: { layer: Layer }) {
  const [open, setOpen] = useState(false);
  const notify = useAppStore((state) => state.notify);
  const source = sourceOf(layer);
  const summary = layerSummary(layer);
  const remove = async () => {
    const ok = await dialogs.confirm({
      title: `Remove “${layer.name}”?`,
      message: "Its colors, styles and interface additions go away. This can't be undone.",
      confirmLabel: "Remove",
      danger: true,
    });
    if (!ok) return;
    customizations.update((draft) => {
      draft.layers = draft.layers.filter((item) => item.id !== layer.id);
    });
    notify(`Removed ${layer.name}`, "success");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(layer, null, 2));
      notify("Layer JSON copied", "success");
    } catch {
      notify("Couldn't copy to the clipboard", "error");
    }
  };
  return (
    <article className={`plugin-row layer-row${layer.enabled ? " enabled" : ""}${open ? " is-open" : ""}`}>
      <div className="plugin-row-main">
        <div className="plugin-row-title">
          <h4>{layer.name}</h4>
          <span className="plugin-source">{source.icon} {source.label}</span>
        </div>
        {layer.description ? <p className="plugin-description">{layer.description}</p> : null}
        <div className="permission-list">
          {summary.length ? summary.map((item) => <span key={item} className="permission-chip">{item}</span>) : <span className="permission-chip">Empty</span>}
        </div>
        <div className="plugin-row-foot">
          <span>Changed {ago(layer.updatedAt)}</span>
          <button type="button" className="plugin-repo-link" aria-expanded={open} onClick={() => setOpen(!open)}>
            <ChevronDown size={11} className={open ? "is-flipped" : ""} /> {open ? "Hide details" : "Inspect"}
          </button>
        </div>
        {open ? <LayerDetails layer={layer} /> : null}
      </div>
      <div className="plugin-row-side">
        <label className="switch" title={layer.enabled ? "Turn off" : "Turn on"}>
          <input type="checkbox" checked={layer.enabled} onChange={(event) => edit(layer.id, (draft) => void (draft.enabled = event.target.checked))} aria-label={`Apply ${layer.name}`} />
          <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        </label>
        <button type="button" className="icon-button" onClick={() => void copy()} title="Copy as JSON" aria-label={`Copy ${layer.name} as JSON`}>
          <Copy size={14} />
        </button>
        <button type="button" className="icon-button" onClick={() => void remove()} title={`Remove ${layer.name}`} aria-label={`Remove ${layer.name}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

/** The layers part of Plugins → Created: every switchable bundle of customizations. */
export function CreatedLayers({ query }: { query: string }) {
  const doc = useCustomizations();
  const needle = query.trim().toLowerCase();
  const layers = doc.layers
    .filter((layer) => !needle || `${layer.name} ${layer.description ?? ""} ${layer.id}`.toLowerCase().includes(needle))
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt);
  const anyOn = doc.layers.some((layer) => layer.enabled);
  return (
    <>
      <div className="created-head">
        <h3><Layers size={13} /> Customization layers</h3>
        {doc.layers.length > 1 ? (
          <button
            type="button"
            className="text-button"
            onClick={() => customizations.update((draft) => {
              for (const layer of draft.layers) layer.enabled = !anyOn;
            })}
          >
            {anyOn ? "Turn all off" : "Turn all on"}
          </button>
        ) : null}
      </div>
      {layers.length ? (
        <div className="plugin-rows">{layers.map((layer) => <LayerRow key={layer.id} layer={layer} />)}</div>
      ) : (
        <p className="plugin-tab-note">
          {needle ? `No layer matches “${query}”.` : "When the assistant changes colors, styles or adds sidebar tabs and widgets, each chat's changes land here as one layer you can switch off or remove."}
        </p>
      )}
    </>
  );
}

import { useEffect, useState } from "react";
import { Download, Globe2, LoaderCircle, PackagePlus, ShieldCheck, Trash2 } from "lucide-react";
import { api, errorMessage, list, type CatalogEntry, type Info } from "../lib/api";
import { relativeTime } from "../lib/format";
import { useAppStore } from "../store";
import { Modal } from "./Modal";

export function PluginManager() {
  const open = useAppStore((state) => state.overlay === "plugins");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const plugins = useAppStore((state) => state.plugins);
  const loadPlugins = useAppStore((state) => state.loadPlugins);
  const notify = useAppStore((state) => state.notify);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [remote, setRemote] = useState<CatalogEntry[]>([]);
  const [remoteUrl, setRemoteUrl] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function refresh() {
    setLoading(true);
    setError("");
    try {
      setCatalog(list(await api.listPluginCatalog()));
      await loadPlugins();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    setRemote([]);
    setRemoteUrl("");
    void refresh();
  }, [open]);

  async function toggle(plugin: Info) {
    setBusy(plugin.manifest.id);
    try {
      await api.togglePlugin(plugin.manifest.id, !plugin.enabled);
      await refresh();
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function uninstall(plugin: Info) {
    if (!window.confirm(`Uninstall “${plugin.manifest.name}”? Its commands and status items will be removed.`)) return;
    setBusy(plugin.manifest.id);
    try {
      await api.uninstallPlugin(plugin.manifest.id);
      notify(`Uninstalled ${plugin.manifest.name}`, "info");
      await refresh();
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function installLocal() {
    setBusy("local");
    try {
      const info = await api.installPlugin();
      if (info) {
        notify(`Installed ${info.manifest.name}. Enable it when you are ready.`, "success");
        await refresh();
      }
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function installCatalog(entry: CatalogEntry) {
    setBusy(entry.manifest.id);
    try {
      const info = await api.installCatalogPlugin(entry.manifest.id);
      if (info) notify(`${info.manifest.name} installed and enabled.`, "success");
      await refresh();
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function fetchRemote() {
    if (!remoteUrl.trim()) return;
    setBusy("remote");
    try {
      const entries = list(await api.fetchPluginCatalog(remoteUrl.trim()));
      setRemote(entries.filter((entry) => !plugins.some((plugin) => plugin.manifest.id === entry.manifest.id)));
      notify(`${entries.length} plugin${entries.length === 1 ? "" : "s"} found in the remote catalog.`, "info");
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  const installedIds = new Set(plugins.map((plugin) => plugin.manifest.id));
  const discover = [...catalog, ...remote].filter((entry) => !installedIds.has(entry.manifest.id));

  function permissions(manifest: Info["manifest"] | CatalogEntry["manifest"]) {
    return manifest.permissions ?? [];
  }

  return (
    <Modal
      open={open}
      title="Plugins"
      subtitle="Small, sandboxed extensions. Each one runs in an isolated frame with only the permissions it declares."
      onClose={() => setOverlay(null)}
      width="large"
    >
      <div className="plugin-toolbar">
        <button type="button" className="primary-button" onClick={() => void installLocal()} disabled={busy === "local"}>
          {busy === "local" ? <LoaderCircle size={15} className="spin" /> : <PackagePlus size={15} />} Install from zip
        </button>
        {loading ? <span className="muted-inline"><LoaderCircle size={14} className="spin" /> Loading catalog…</span> : null}
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <section className="plugin-section">
        <div className="plugin-section-heading">
          <h3>Installed</h3>
          <span>{plugins.length}</span>
        </div>
        {plugins.length === 0 ? <div className="empty-hint"><p>No plugins installed yet.</p></div> : null}
        <div className="plugin-grid">
          {plugins.map((plugin) => (
            <article key={plugin.manifest.id} className={`plugin-card ${plugin.enabled ? "enabled" : ""}`}>
              <div className="plugin-card-head">
                <div>
                  <h4>{plugin.manifest.name}</h4>
                  <span className="plugin-meta">v{plugin.manifest.version} · SDK {plugin.manifest.sdkVersion}</span>
                </div>
                <label className="switch" title={plugin.enabled ? "Disable plugin" : "Enable plugin"}>
                  <input
                    type="checkbox"
                    checked={plugin.enabled}
                    disabled={Boolean(plugin.problem) || busy === plugin.manifest.id}
                    onChange={() => void toggle(plugin)}
                    aria-label={`Enable ${plugin.manifest.name}`}
                  />
                  <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
                </label>
              </div>
              <p className="plugin-description">{plugin.manifest.description || "No description provided."}</p>
              {plugin.problem ? <div className="plugin-problem">{plugin.problem}</div> : null}
              <div className="permission-list">
                {permissions(plugin.manifest).map((permission) => (
                  <span key={permission} className="permission-chip"><ShieldCheck size={11} /> {permission}</span>
                ))}
              </div>
              <div className="plugin-card-foot">
                <span>{plugin.manifest.author || "Unknown author"} · installed {relativeTime(plugin.installedAt)}</span>
                <button type="button" className="text-button danger" onClick={() => void uninstall(plugin)} disabled={busy === plugin.manifest.id}>
                  <Trash2 size={13} /> Uninstall
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      <section className="plugin-section">
        <div className="plugin-section-heading">
          <h3>Discover</h3>
          <span>Bundled catalog</span>
        </div>
        <div className="plugin-grid">
          {discover.map((entry) => (
            <article key={entry.manifest.id} className="plugin-card">
              <div className="plugin-card-head">
                <div>
                  <h4>{entry.manifest.name}</h4>
                  <span className="plugin-meta">v{entry.manifest.version} · {entry.remote ? "remote" : "bundled"}</span>
                </div>
                {entry.remote ? (
                  <span className="plugin-remote-note" title="Download the plugin zip yourself, then install it from a file.">remote · zip only</span>
                ) : (
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={busy === entry.manifest.id}
                    onClick={() => void installCatalog(entry)}
                  >
                    {busy === entry.manifest.id ? <LoaderCircle size={13} className="spin" /> : <Download size={13} />} Install
                  </button>
                )}
              </div>
              <p className="plugin-description">{entry.manifest.description || "No description provided."}</p>
              <div className="permission-list">
                {permissions(entry.manifest).map((permission) => (
                  <span key={permission} className="permission-chip">{permission}</span>
                ))}
              </div>
            </article>
          ))}
          {!loading && discover.length === 0 ? <div className="empty-hint"><p>Everything in the bundled catalog is installed.</p></div> : null}
        </div>
      </section>
      <section className="plugin-section remote-section">
        <div className="plugin-section-heading">
          <h3><Globe2 size={16} /> Remote catalog</h3>
          <span>Optional · explicit fetch only</span>
        </div>
        <p className="settings-copy">Noteral never contacts the network on its own. Paste a catalog URL to fetch it once; remote entries are shown here and still require an explicit install.</p>
        <div className="remote-catalog-row">
          <input
            className="inline-input grow"
            value={remoteUrl}
            onChange={(event) => setRemoteUrl(event.target.value)}
            placeholder="https://example.com/noteral-catalog.json"
            aria-label="Remote catalog URL"
            onKeyDown={(event) => {
              if (event.key === "Enter") void fetchRemote();
            }}
          />
          <button type="button" className="secondary-button" disabled={!remoteUrl.trim() || busy === "remote"} onClick={() => void fetchRemote()}>
            {busy === "remote" ? <LoaderCircle size={14} className="spin" /> : <Globe2 size={14} />} Fetch
          </button>
        </div>
      </section>
    </Modal>
  );
}

import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpCircle,
  SlidersHorizontal,
  Bot,
  Box,
  ExternalLink,
  FileArchive,
  Globe2,
  LoaderCircle,
  PackagePlus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { api, errorMessage, list } from "../lib/api";
import type { CatalogEntry, CommunityPlugin, Info, Manifest, PluginEnvironment, PluginUpdate, Release } from "../lib/api";
import { dialogs } from "../lib/dialogs";
import { relativeTime } from "../lib/format";
import { Markdown } from "../lib/markdownView";
import { openMarkdownLink } from "../lib/links";
import { pluginRuntime, usePluginRuntimeStates } from "../plugins/runtime";
import { PERMISSIONS } from "../sdk-host/spec";
import { useCustomizations } from "../lib/customizations";
import { useAppStore } from "../store";
import { CreatedLayers } from "./CreatedLayers";
import { PluginOptions, usePluginOptionFields } from "./PluginOptions";
import { pluginConfigure, usePluginConfigure } from "../lib/pluginConfigure";
import { Modal } from "./Modal";

type Tab = "installed" | "community" | "created" | "bundled";

/** What the review screen is about to install. */
interface Review {
  manifest: Manifest;
  origin: "community" | "bundled" | "file";
  installedVersion?: string;
  release?: Release;
  token?: string;
  repo?: string;
  problem?: string;
  /** Permissions the installed version did not have. */
  added?: string[];
}

const REGISTRY_KEY = "noteral.pluginRegistryUrl";
const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const;
const permissionInfo = new Map(PERMISSIONS.map((item) => [item.id as string, item]));

function readRegistryUrl() {
  try {
    return localStorage.getItem(REGISTRY_KEY) ?? "";
  } catch {
    return "";
  }
}

function permissionsOf(manifest: Manifest) {
  return (manifest.permissions ?? []).slice().sort((a, b) => {
    const ra = RISK_ORDER[permissionInfo.get(a)?.risk ?? "low"];
    const rb = RISK_ORDER[permissionInfo.get(b)?.risk ?? "low"];
    return ra - rb || a.localeCompare(b);
  });
}

function sourceLabel(source: string): { label: string; icon: ReactNode } {
  if (source.startsWith("github:")) return { label: "Community", icon: <Globe2 size={11} /> };
  if (source === "catalog") return { label: "Bundled", icon: <Box size={11} /> };
  if (source === "assistant") return { label: "Made by assistant", icon: <Bot size={11} /> };
  return { label: "From file", icon: <FileArchive size={11} /> };
}

function matches(query: string, ...fields: (string | undefined | null)[]) {
  const needle = query.trim().toLowerCase();
  return !needle || fields.some((field) => field?.toLowerCase().includes(needle));
}

export function PluginManager() {
  const open = useAppStore((state) => state.overlay === "plugins");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const plugins = useAppStore((state) => state.plugins);
  const loadPlugins = useAppStore((state) => state.loadPlugins);
  const notify = useAppStore((state) => state.notify);
  const runtimeStates = usePluginRuntimeStates();

  const [tab, setTab] = useState<Tab>("installed");
  const { layers } = useCustomizations();
  const [query, setQuery] = useState("");
  const [env, setEnv] = useState<PluginEnvironment | null>(null);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [registry, setRegistry] = useState<{ plugins: CommunityPlugin[]; fetchedAt: string; skipped: number } | null>(null);
  const [registryError, setRegistryError] = useState("");
  const [registryUrl, setRegistryUrl] = useState(readRegistryUrl);
  const [registryDraft, setRegistryDraft] = useState(registryUrl);
  const [updates, setUpdates] = useState<PluginUpdate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [review, setReview] = useState<Review | null>(null);

  const failed = useMemo(() => new Map(runtimeStates.filter((item) => item.status === "failed").map((item) => [item.pluginId, item.error ?? "Failed to start"])), [runtimeStates]);
  const updateFor = useMemo(() => new Map((updates ?? []).filter((item) => !item.problem).map((item) => [item.id, item])), [updates]);

  useEffect(() => {
    if (!open) return;
    setReview(null);
    setQuery("");
    void loadPlugins();
    void api.getPluginEnvironment().then(setEnv).catch(() => undefined);
    void api.listPluginCatalog().then((entries) => setCatalog(list(entries))).catch(() => undefined);
  }, [open, loadPlugins]);

  // The registry lives on GitHub; it's only fetched once you open the tab.
  useEffect(() => {
    if (open && tab === "community" && !registry && !registryError && busy !== "registry") void fetchRegistry();
  }, [open, tab]);

  async function run(key: string, task: () => Promise<void>) {
    setBusy(key);
    try {
      await task();
    } catch (err) {
      notify(errorMessage(err), "error");
    } finally {
      setBusy(null);
    }
  }

  async function fetchRegistry(url = registryUrl) {
    setBusy("registry");
    setRegistryError("");
    try {
      const result = await api.fetchCommunityRegistry(url);
      setRegistry({ plugins: list(result.plugins), fetchedAt: result.fetchedAt, skipped: result.skipped });
    } catch (err) {
      setRegistryError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  }

  async function refreshAll() {
    await loadPlugins();
    setCatalog(list(await api.listPluginCatalog()));
    if (registry) await fetchRegistry();
  }

  const checkUpdates = () =>
    run("updates", async () => {
      const found = list(await api.checkPluginUpdates());
      setUpdates(found);
      const ready = found.filter((item) => !item.problem).length;
      notify(ready ? `${ready} update${ready === 1 ? "" : "s"} available` : "All community plugins are up to date", "info");
    });

  const toggle = (plugin: Info) =>
    run(plugin.manifest.id, async () => {
      await api.togglePlugin(plugin.manifest.id, !plugin.enabled);
      await loadPlugins();
    });

  const uninstall = (plugin: Info) =>
    run(plugin.manifest.id, async () => {
      const ok = await dialogs.confirm({
        title: `Uninstall ${plugin.manifest.name}?`,
        message: "Its commands, status items, panels and saved settings are removed.",
        confirmLabel: "Uninstall",
        danger: true,
      });
      if (!ok) return;
      await api.uninstallPlugin(plugin.manifest.id);
      setUpdates((current) => current?.filter((item) => item.id !== plugin.manifest.id) ?? null);
      await refreshAll();
      notify(`Uninstalled ${plugin.manifest.name}`, "info");
    });

  const reviewCommunity = (repo: string, id: string) =>
    run(`review:${id}`, async () => {
      const release = await api.getCommunityRelease(repo, id);
      const installed = plugins.find((item) => item.manifest.id === id);
      setReview({
        manifest: release.manifest,
        origin: "community",
        release,
        repo,
        installedVersion: release.installedVersion || installed?.manifest.version,
        problem: release.problem || (release.compatible ? undefined : "This release is not compatible with your version of Noteral."),
        added: installed ? list(release.newPermissions) : undefined,
      });
    });

  const reviewBundled = (entry: CatalogEntry) => {
    const installed = plugins.find((item) => item.manifest.id === entry.manifest.id);
    setReview({
      manifest: entry.manifest,
      origin: "bundled",
      installedVersion: installed?.manifest.version,
      added: installed ? permissionsOf(entry.manifest).filter((item) => !(installed.manifest.permissions ?? []).includes(item)) : undefined,
    });
  };

  const reviewFile = () =>
    run("file", async () => {
      const picked = await api.pickPluginBundle();
      if (!picked.token) return;
      const installed = plugins.find((item) => item.manifest.id === picked.manifest.id);
      setReview({
        manifest: picked.manifest,
        origin: "file",
        token: picked.token,
        installedVersion: picked.installedVersion || undefined,
        problem: picked.problem || undefined,
        added: installed ? permissionsOf(picked.manifest).filter((item) => !(installed.manifest.permissions ?? []).includes(item)) : undefined,
      });
    });

  const approve = (current: Review) =>
    run("install", async () => {
      const approved = current.manifest.permissions ?? [];
      const info =
        current.origin === "community" && current.repo
          ? await api.installCommunityPlugin(current.repo, current.manifest.id, approved)
          : current.origin === "file" && current.token
            ? await api.installPluginBundle(current.token, approved)
            : await api.installCatalogPlugin(current.manifest.id, approved);
      setReview(null);
      setUpdates((items) => items?.filter((item) => item.id !== info.manifest.id) ?? null);
      await refreshAll();
      setTab("installed");
      const verb = current.installedVersion ? "Updated" : "Installed";
      notify(`${verb} ${info.manifest.name} ${info.manifest.version}${info.enabled ? "" : " — enable it in Installed"}`, "success");
    });

  const saveRegistry = () => {
    const next = registryDraft.trim();
    try {
      if (next) localStorage.setItem(REGISTRY_KEY, next);
      else localStorage.removeItem(REGISTRY_KEY);
    } catch {
      // Not persisted; still used for this session.
    }
    setRegistryUrl(next);
    setRegistry(null);
    void fetchRegistry(next);
  };

  const installedIds = new Set(plugins.map((item) => item.manifest.id));
  const visibleInstalled = plugins.filter((item) => matches(query, item.manifest.name, item.manifest.description, item.manifest.author, item.manifest.id));
  const madeByAssistant = visibleInstalled.filter((item) => item.source === "assistant");
  const layerCount = layers.length;
  const visibleCommunity = (registry?.plugins ?? []).filter((item) => matches(query, item.name, item.description, item.author, item.repo, ...(item.tags ?? [])));
  const visibleBundled = catalog.filter((item) => !item.remote && matches(query, item.manifest.name, item.manifest.description));
  const updateCount = updateFor.size;

  return (
    <Modal
      open={open}
      title={review ? (review.installedVersion ? `Update ${review.manifest.name}` : `Install ${review.manifest.name}`) : "Plugins"}
      subtitle={review ? "Review what this plugin can do before it runs." : "Sandboxed extensions that run with only the permissions you approve."}
      onClose={() => setOverlay(null)}
      width="large"
      className="plugin-store"
      bodyClassName="plugin-store-body"
    >
      {review ? (
        <ReviewScreen review={review} busy={busy === "install"} onBack={() => setReview(null)} onApprove={() => void approve(review)} />
      ) : (
        <>
          <div className="plugin-store-bar">
            <div className="plugin-tabs" role="tablist" aria-label="Plugin sources">
              <TabButton id="installed" tab={tab} setTab={setTab} label="Installed" count={plugins.length} badge={updateCount || undefined} />
              <TabButton id="community" tab={tab} setTab={setTab} label="Community" count={registry?.plugins.length} />
              <TabButton id="created" tab={tab} setTab={setTab} label="Created" count={(layerCount + madeByAssistant.length) || undefined} />
              {catalog.length ? <TabButton id="bundled" tab={tab} setTab={setTab} label="Bundled" count={visibleBundled.length || undefined} /> : null}
            </div>
            <label className="picker-search plugin-search">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter plugins…" aria-label="Filter plugins" spellCheck={false} />
            </label>
          </div>

          {tab === "installed" ? (
            <section className="plugin-tab-panel" role="tabpanel" aria-label="Installed plugins">
              <div className="plugin-list-actions">
                <button type="button" className="secondary-button" onClick={() => void checkUpdates()} disabled={busy === "updates"}>
                  {busy === "updates" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Check for updates
                </button>
                <button type="button" className="secondary-button" onClick={() => void reviewFile()} disabled={busy === "file"}>
                  {busy === "file" ? <LoaderCircle size={14} className="spin" /> : <PackagePlus size={14} />} Install from file
                </button>
              </div>
              {plugins.length === 0 ? (
                <EmptyState title="No plugins yet" body="Browse the community registry, install a plugin file, or ask the assistant to make one.">
                  <button type="button" className="primary-button" onClick={() => setTab("community")}>Browse community plugins</button>
                </EmptyState>
              ) : visibleInstalled.length === 0 ? (
                <EmptyState title="No matches" body={`No installed plugin matches “${query}”.`} />
              ) : (
                <div className="plugin-rows">
                  {visibleInstalled.map((plugin) => (
                    <InstalledRow
                      key={plugin.manifest.id}
                      plugin={plugin}
                      busy={busy === plugin.manifest.id}
                      reviewing={busy === `review:${plugin.manifest.id}`}
                      runtimeError={plugin.enabled ? failed.get(plugin.manifest.id) : undefined}
                      update={updateFor.get(plugin.manifest.id)}
                      onToggle={() => void toggle(plugin)}
                      onUninstall={() => void uninstall(plugin)}
                      onRestart={() => void pluginRuntime.restart(plugin.manifest.id)}
                      onUpdate={(update) => void reviewCommunity(update.repo, update.id)}
                    />
                  ))}
                </div>
              )}
            </section>
          ) : null}

          {tab === "community" ? (
            <section className="plugin-tab-panel" role="tabpanel" aria-label="Community plugins">
              <p className="plugin-tab-note">
                Community plugins are listed in a registry on GitHub and installed from their author’s GitHub Releases. They’re not reviewed by Noteral — check the permissions before you approve.
              </p>
              {busy === "registry" && !registry ? (
                <div className="plugin-loading"><LoaderCircle size={15} className="spin" /> Loading the registry…</div>
              ) : registryError ? (
                <EmptyState title="Couldn’t load the registry" body={registryError}>
                  <button type="button" className="secondary-button" onClick={() => void fetchRegistry()}><RefreshCw size={14} /> Try again</button>
                </EmptyState>
              ) : registry && registry.plugins.length === 0 ? (
                <EmptyState title="The registry is empty" body="No plugins have been published to this registry yet. See docs/plugins/publishing.md to add yours." />
              ) : (
                <div className="plugin-grid">
                  {visibleCommunity.map((entry) => {
                    const update = updateFor.get(entry.id);
                    return (
                      <article key={entry.id} className="plugin-card">
                        <div className="plugin-card-head">
                          <div className="plugin-card-title">
                            <h4>{entry.name}</h4>
                            <span className="plugin-meta">by {entry.author || "unknown"}</span>
                          </div>
                          {entry.installed && !update ? (
                            <span className="plugin-installed-tag">{entry.installedVersion ? `v${entry.installedVersion} installed` : "Installed"}</span>
                          ) : (
                            <button
                              type="button"
                              className={update ? "primary-button" : "secondary-button"}
                              disabled={busy === `review:${entry.id}`}
                              onClick={() => void reviewCommunity(entry.repo, entry.id)}
                            >
                              {busy === `review:${entry.id}` ? <LoaderCircle size={13} className="spin" /> : update ? <ArrowUpCircle size={13} /> : null}
                              {update ? `Update to ${update.latest}` : "Install"}
                            </button>
                          )}
                        </div>
                        <p className="plugin-description">{entry.description || "No description provided."}</p>
                        <div className="plugin-card-foot">
                          <button type="button" className="plugin-repo-link" onClick={() => openMarkdownLink(`https://github.com/${entry.repo}`)} title="Open the repository on GitHub">
                            <Globe2 size={12} /> {entry.repo}
                          </button>
                          {entry.tags?.length ? <span className="plugin-tags">{entry.tags.slice(0, 3).join(" · ")}</span> : null}
                        </div>
                      </article>
                    );
                  })}
                  {registry && visibleCommunity.length === 0 && registry.plugins.length > 0 ? <EmptyState title="No matches" body={`Nothing in the registry matches “${query}”.`} /> : null}
                </div>
              )}
              <details className="plugin-registry">
                <summary>Registry source{registry ? ` · updated ${relativeTime(registry.fetchedAt)}` : ""}{registry?.skipped ? ` · ${registry.skipped} invalid entries skipped` : ""}</summary>
                <div className="plugin-registry-row">
                  <input
                    className="inline-input grow"
                    value={registryDraft}
                    onChange={(event) => setRegistryDraft(event.target.value)}
                    placeholder={env?.defaultRegistryUrl ?? "Default registry"}
                    aria-label="Registry URL"
                    spellCheck={false}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") saveRegistry();
                    }}
                  />
                  <button type="button" className="secondary-button" onClick={saveRegistry} disabled={busy === "registry"}>
                    {busy === "registry" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} {registryDraft.trim() === registryUrl ? "Reload" : "Use"}
                  </button>
                </div>
                <p>Leave empty for the default registry. Any HTTPS URL serving a community-plugins.json works, so teams can run their own list.</p>
              </details>
            </section>
          ) : null}

          {tab === "created" ? (
            <section className="plugin-tab-panel created-panel" role="tabpanel" aria-label="Created by you and the assistant">
              <CreatedLayers query={query} />
              <div className="created-head">
                <h3><Bot size={13} /> Plugins made by the assistant</h3>
              </div>
              {madeByAssistant.length ? (
                <div className="plugin-rows">
                  {madeByAssistant.map((plugin) => (
                    <InstalledRow
                      key={plugin.manifest.id}
                      plugin={plugin}
                      busy={busy === plugin.manifest.id}
                      reviewing={busy === `review:${plugin.manifest.id}`}
                      runtimeError={plugin.enabled ? failed.get(plugin.manifest.id) : undefined}
                      update={updateFor.get(plugin.manifest.id)}
                      onToggle={() => void toggle(plugin)}
                      onUninstall={() => void uninstall(plugin)}
                      onRestart={() => void pluginRuntime.restart(plugin.manifest.id)}
                      onUpdate={(update) => void reviewCommunity(update.repo, update.id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="plugin-tab-note">
                  {query.trim() ? `No assistant plugin matches “${query}”.` : "In Creator mode the assistant can write a plugin, test it in a sandbox and install it after you approve. Those plugins show up here."}
                </p>
              )}
            </section>
          ) : null}

          {tab === "bundled" && catalog.length ? (
            <section className="plugin-tab-panel" role="tabpanel" aria-label="Bundled plugins">
              <p className="plugin-tab-note">Examples that ship with Noteral. They work offline and are a good starting point for your own plugin.</p>
              <div className="plugin-grid">
                {visibleBundled.map((entry) => {
                  const installed = installedIds.has(entry.manifest.id);
                  const current = plugins.find((item) => item.manifest.id === entry.manifest.id);
                  const newer = current && current.manifest.version !== entry.manifest.version;
                  return (
                    <article key={entry.manifest.id} className="plugin-card">
                      <div className="plugin-card-head">
                        <div className="plugin-card-title">
                          <h4>{entry.manifest.name}</h4>
                          <span className="plugin-meta">v{entry.manifest.version} · {entry.manifest.author || "Noteral"}</span>
                        </div>
                        {installed && !newer ? (
                          <span className="plugin-installed-tag">Installed</span>
                        ) : (
                          <button type="button" className="secondary-button" onClick={() => reviewBundled(entry)}>{newer ? `Update to ${entry.manifest.version}` : "Install"}</button>
                        )}
                      </div>
                      <p className="plugin-description">{entry.manifest.description || "No description provided."}</p>
                      <PermissionChips manifest={entry.manifest} />
                    </article>
                  );
                })}
              </div>
              {visibleBundled.length === 0 ? <EmptyState title="No matches" body={`No bundled plugin matches “${query}”.`} /> : null}
            </section>
          ) : null}

          <footer className="plugin-store-foot">
            <span>App {env?.appVersion ?? "…"} · SDK {env?.sdkVersion ?? "…"}</span>
            <span>Build your own: docs/plugins/README.md</span>
          </footer>
        </>
      )}
    </Modal>
  );
}

function TabButton({ id, tab, setTab, label, count, badge }: { id: Tab; tab: Tab; setTab: (tab: Tab) => void; label: string; count?: number; badge?: number }) {
  return (
    <button type="button" role="tab" aria-selected={tab === id} className={`plugin-tab${tab === id ? " active" : ""}`} onClick={() => setTab(id)}>
      {label}
      {count !== undefined ? <span className="plugin-tab-count">{count}</span> : null}
      {badge ? <span className="plugin-tab-badge" title={`${badge} update${badge === 1 ? "" : "s"}`}>{badge}</span> : null}
    </button>
  );
}

function EmptyState({ title, body, children }: { title: string; body: string; children?: ReactNode }) {
  return (
    <div className="plugin-empty">
      <strong>{title}</strong>
      <p>{body}</p>
      {children}
    </div>
  );
}

function PermissionChips({ manifest }: { manifest: Manifest }) {
  const items = permissionsOf(manifest);
  if (!items.length) return <div className="permission-list"><span className="permission-chip">No permissions</span></div>;
  return (
    <div className="permission-list">
      {items.map((permission) => {
        const info = permissionInfo.get(permission);
        return (
          <span key={permission} className={`permission-chip risk-${info?.risk ?? "low"}`} title={info ? `${info.title} — ${info.description}` : permission}>
            {permission}
          </span>
        );
      })}
    </div>
  );
}

interface InstalledRowProps {
  plugin: Info;
  busy: boolean;
  reviewing: boolean;
  runtimeError?: string;
  update?: PluginUpdate;
  onToggle: () => void;
  onUninstall: () => void;
  onRestart: () => void;
  onUpdate: (update: PluginUpdate) => void;
}

function InstalledRow({ plugin, busy, reviewing, runtimeError, update, onToggle, onUninstall, onRestart, onUpdate }: InstalledRowProps) {
  const { manifest } = plugin;
  const source = sourceLabel(plugin.source);
  const repo = manifest.repo || (plugin.source.startsWith("github:") ? plugin.source.slice(7) : "");
  const optionFields = usePluginOptionFields(manifest);
  const [optionsOpen, setOptionsOpen] = useState(false);
  usePluginConfigure();
  const hasPage = plugin.enabled && pluginConfigure.hasPage(manifest.id);
  return (
    <article className={`plugin-row${plugin.enabled ? " enabled" : ""}${plugin.problem || runtimeError ? " has-problem" : ""}`}>
      <div className="plugin-row-main">
        <div className="plugin-row-title">
          <h4>{manifest.name}</h4>
          <span className="plugin-meta">v{manifest.version}</span>
          <span className="plugin-source">{source.icon} {source.label}</span>
        </div>
        <p className="plugin-description">{manifest.description || "No description provided."}</p>
        {plugin.problem ? <div className="plugin-problem"><AlertTriangle size={13} /> {plugin.problem}</div> : null}
        {runtimeError ? (
          <div className="plugin-problem">
            <AlertTriangle size={13} /> <span>Stopped: {runtimeError}</span>
            <button type="button" className="text-button" onClick={onRestart}><RotateCcw size={12} /> Restart</button>
          </div>
        ) : null}
        <PermissionChips manifest={manifest} />
        <div className="plugin-row-foot">
          <span>{manifest.author || "Unknown author"} · installed {relativeTime(plugin.installedAt)}</span>
          {repo ? (
            <button type="button" className="plugin-repo-link" onClick={() => openMarkdownLink(`https://github.com/${repo}`)}>
              <ExternalLink size={11} /> {repo}
            </button>
          ) : null}
        </div>
        {optionsOpen && optionFields.length ? <PluginOptions manifest={manifest} /> : null}
      </div>
      <div className="plugin-row-side">
        {optionFields.length || hasPage ? (
          <button
            type="button"
            className={`icon-button plugin-options-toggle${optionsOpen ? " active" : ""}`}
            onClick={() => (hasPage ? pluginConfigure.open(manifest.id) : setOptionsOpen((open) => !open))}
            aria-expanded={optionsOpen}
            title={`${manifest.name} options`}
            aria-label={`${manifest.name} options`}
          >
            <SlidersHorizontal size={14} />
          </button>
        ) : null}
        <label className="switch" title={plugin.enabled ? "Disable plugin" : "Enable plugin"}>
          <input type="checkbox" checked={plugin.enabled} disabled={Boolean(plugin.problem) || busy} onChange={onToggle} aria-label={`Enable ${manifest.name}`} />
          <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        </label>
        {update ? (
          <button type="button" className="primary-button plugin-update" onClick={() => onUpdate(update)} disabled={reviewing}>
            {reviewing ? <LoaderCircle size={13} className="spin" /> : <ArrowUpCircle size={13} />} {update.latest}
          </button>
        ) : null}
        <button type="button" className="icon-button" onClick={onUninstall} disabled={busy} title={`Uninstall ${manifest.name}`} aria-label={`Uninstall ${manifest.name}`}>
          <Trash2 size={14} />
        </button>
      </div>
    </article>
  );
}

function ReviewScreen({ review, busy, onBack, onApprove }: { review: Review; busy: boolean; onBack: () => void; onApprove: () => void }) {
  const { manifest, release } = review;
  const permissions = permissionsOf(manifest);
  const added = new Set(review.added ?? []);
  const highRisk = permissions.some((item) => permissionInfo.get(item)?.risk === "high");
  const blocked = Boolean(review.problem);
  const origin =
    review.origin === "community"
      ? `github.com/${review.repo}${release?.tag && release.tag.replace(/^v/, "") !== manifest.version ? ` · tag ${release.tag}` : ""}`
      : review.origin === "bundled" ? "Bundled with Noteral" : "Local file";

  return (
    <div className="plugin-review">
      <button type="button" className="text-button plugin-review-back" onClick={onBack}><ArrowLeft size={13} /> Back to plugins</button>
      <header className="plugin-review-head">
        <div>
          <h3>{manifest.name}</h3>
          <p className="plugin-meta">
            {review.installedVersion ? `v${review.installedVersion} → v${manifest.version}` : `v${manifest.version}`} · by {manifest.author || "unknown"} · {origin}
          </p>
        </div>
        {review.origin === "community" && release?.htmlUrl ? (
          <button type="button" className="secondary-button" onClick={() => openMarkdownLink(release.htmlUrl)}><ExternalLink size={13} /> Release page</button>
        ) : null}
      </header>
      {manifest.description ? <p className="plugin-review-description">{manifest.description}</p> : null}
      {review.problem ? <div className="plugin-problem"><AlertTriangle size={13} /> {review.problem}</div> : null}

      <section className="plugin-review-section">
        <h4><ShieldCheck size={14} /> {permissions.length ? `It will be able to` : "It asks for no permissions"}</h4>
        {permissions.length ? (
          <ul className="plugin-permissions">
            {permissions.map((permission) => {
              const info = permissionInfo.get(permission);
              return (
                <li key={permission} className={`risk-${info?.risk ?? "low"}`}>
                  <span className="plugin-risk" aria-label={`${info?.risk ?? "low"} risk`}>{info?.risk ?? "low"}</span>
                  <div>
                    <strong>{info?.title ?? permission}{added.has(permission) ? <em className="plugin-new">new</em> : null}</strong>
                    <span>{info?.description ?? "Unknown permission."}</span>
                  </div>
                  <code>{permission}</code>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="plugin-review-copy">It can only run its own code inside its sandbox.</p>
        )}
        {highRisk ? <p className="plugin-review-warning"><AlertTriangle size={13} /> High-risk permissions let it change or send your data. Only approve plugins you trust.</p> : null}
      </section>

      {release?.notes ? (
        <section className="plugin-review-section">
          <h4>Release notes{release.publishedAt ? <span> · {relativeTime(release.publishedAt)}</span> : null}</h4>
          <Markdown source={release.notes.slice(0, 6000)} className="plugin-review-notes" onLink={openMarkdownLink} />
        </section>
      ) : null}

      <footer className="plugin-review-foot">
        <span>Plugins run sandboxed. You can disable or uninstall it any time.</span>
        <button type="button" className="secondary-button" onClick={onBack}>Cancel</button>
        <button type="button" className="primary-button" onClick={onApprove} disabled={busy || blocked}>
          {busy ? <LoaderCircle size={14} className="spin" /> : null} {permissions.length ? "Approve and " : ""}{review.installedVersion ? "update" : "install"}
        </button>
      </footer>
    </div>
  );
}

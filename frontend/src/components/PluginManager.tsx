import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowUpCircle,
  BookOpen,
  Bot,
  Box,
  ChevronRight,
  Compass,
  ExternalLink,
  FileArchive,
  Globe2,
  FileText,
  LayoutPanelLeft,
  ListTree,
  LoaderCircle,
  PackagePlus,
  PanelBottom,
  Puzzle,
  RefreshCw,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  SquareTerminal,
  Trash2,
  X,
} from "lucide-react";
import { api, errorMessage, list } from "../lib/api";
import type { CatalogEntry, CommunityPlugin, Info, Manifest, PluginEnvironment, PluginUpdate, Release } from "../lib/api";
import { dropLeadingTitle, prepareReadme } from "../lib/readme";
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

type Section = "installed" | "updates" | "discover" | "bundled" | "created";
type InstalledFilter = "all" | "enabled" | "disabled" | "issues";

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
const DOCS_URL = "https://github.com/neurh/noteral-plugins#readme";
const RISK_ORDER = { high: 0, medium: 1, low: 2 } as const;
const permissionInfo = new Map(PERMISSIONS.map((item) => [item.id as string, item]));

const SECTIONS: Record<Section, { title: string; blurb: string }> = {
  installed: { title: "Installed", blurb: "Turn plugins on or off, change their settings and see what each one can reach." },
  updates: { title: "Updates", blurb: "New releases of plugins you installed from the community registry." },
  discover: { title: "Discover", blurb: "Published by the community on GitHub and not reviewed by Noteral. Check the permissions before you approve." },
  bundled: { title: "Bundled", blurb: "Examples that ship with Noteral. They work offline and make a good starting point for your own." },
  created: { title: "Created", blurb: "Layers and plugins made by you and the assistant." },
};

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

/** The highest risk among a plugin's permissions, for the one-word summary on rows. */
function riskOf(manifest: Manifest): "high" | "medium" | "low" | "none" {
  const first = permissionsOf(manifest)[0];
  if (!first) return "none";
  return permissionInfo.get(first)?.risk ?? "low";
}

function sourceLabel(source: string): { label: string; icon: ReactNode } {
  if (source.startsWith("github:")) return { label: "Community", icon: <Globe2 size={11} /> };
  if (source === "catalog") return { label: "Bundled", icon: <Box size={11} /> };
  if (source === "assistant") return { label: "Made by assistant", icon: <Bot size={11} /> };
  return { label: "From file", icon: <FileArchive size={11} /> };
}

function repoOf(plugin: Info) {
  return plugin.manifest.repo || (plugin.source.startsWith("github:") ? plugin.source.slice(7) : "");
}

function matches(query: string, ...fields: (string | undefined | null)[]) {
  const needle = query.trim().toLowerCase();
  return !needle || fields.some((field) => field?.toLowerCase().includes(needle));
}

function plural(n: number, one: string, many = `${one}s`) {
  return `${n} ${n === 1 ? one : many}`;
}

const COLLAPSED_KEY = "noteral.plugins.collapsedSections";

function readCollapsed(): Set<string> {
  try {
    const raw = window.localStorage.getItem(COLLAPSED_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

/** Sections fold the same way on every plugin's page, and stay folded across visits. */
const collapsedSections = readCollapsed();

interface FoldSectionProps {
  id: string;
  icon?: ReactNode;
  title: ReactNode;
  /** A short note beside the title, such as a count. */
  note?: ReactNode;
  /** Buttons on the right of the header; clicking them doesn't fold the section. */
  actions?: ReactNode;
  defaultCollapsed?: boolean;
  children: ReactNode;
}

export function FoldSection({ id, icon, title, note, actions, defaultCollapsed = false, children }: FoldSectionProps) {
  const [open, setOpen] = useState(() => (collapsedSections.has(id) ? false : collapsedSections.has(`+${id}`) ? true : !defaultCollapsed));
  const toggle = () => {
    const next = !open;
    setOpen(next);
    collapsedSections.delete(id);
    collapsedSections.delete(`+${id}`);
    if (next === defaultCollapsed) collapsedSections.add(next ? `+${id}` : id);
    try {
      window.localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...collapsedSections]));
    } catch {
      // Folding still works for this session.
    }
  };
  const bodyId = `ps-section-${id}`;
  return (
    <section className={`ps-section ps-fold${open ? " is-open" : ""}`}>
      <div className="ps-fold-head">
        <h4 className="ps-fold-title">
          <button type="button" className="ps-fold-toggle" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
            <ChevronRight size={13} className="ps-fold-chevron" aria-hidden="true" />
            {icon}
            <span className="ps-fold-label">{title}</span>
            {note ? <span className="ps-fold-note">{note}</span> : null}
          </button>
        </h4>
        {actions ? <div className="ps-fold-actions">{actions}</div> : null}
      </div>
      {open ? <div className="ps-fold-body" id={bodyId}>{children}</div> : null}
    </section>
  );
}

export function PluginManager() {
  const open = useAppStore((state) => state.overlay === "plugins");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const plugins = useAppStore((state) => state.plugins);
  const loadPlugins = useAppStore((state) => state.loadPlugins);
  const notify = useAppStore((state) => state.notify);
  const runtimeStates = usePluginRuntimeStates();

  const [section, setSection] = useState<Section>("installed");
  const [filter, setFilter] = useState<InstalledFilter>("all");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [communityId, setCommunityId] = useState<string | null>(null);
  // The plugin page opened from an installed plugin: where Back returns, and
  // a stand-in entry for plugins that aren't listed in the registry.
  const [pageFrom, setPageFrom] = useState<string | null>(null);
  const [pageEntry, setPageEntry] = useState<CommunityPlugin | null>(null);
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
    setDetailId(null);
    setCommunityId(null);
    setPageFrom(null);
    setQuery("");
    void loadPlugins();
    void api.getPluginEnvironment().then(setEnv).catch(() => undefined);
    void api.listPluginCatalog().then((entries) => setCatalog(list(entries))).catch(() => undefined);
  }, [open, loadPlugins]);

  // The registry lives on GitHub; it's only fetched once you open Discover.
  useEffect(() => {
    if (open && section === "discover" && !registry && !registryError && busy !== "registry") void fetchRegistry();
  }, [open, section]);

  // Updates are checked the first time you open the Updates section.
  useEffect(() => {
    if (open && section === "updates" && updates === null && busy !== "updates") void checkUpdates(true);
  }, [open, section]);

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

  const checkUpdates = (quiet = false) =>
    run("updates", async () => {
      const found = list(await api.checkPluginUpdates());
      setUpdates(found);
      if (quiet) return;
      const ready = found.filter((item) => !item.problem).length;
      notify(ready ? `${plural(ready, "update")} available` : "All community plugins are up to date", "info");
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
      setDetailId(null);
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
      setSection("installed");
      setCommunityId(null);
      setDetailId(info.manifest.id);
      const verb = current.installedVersion ? "Updated" : "Installed";
      notify(`${verb} ${info.manifest.name} ${info.manifest.version}${info.enabled ? "" : " — turn it on to start it"}`, "success");
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

  const go = (next: Section) => {
    setSection(next);
    setDetailId(null);
    setCommunityId(null);
    setPageFrom(null);
    setReview(null);
    setQuery("");
  };

  const installedIds = new Set(plugins.map((item) => item.manifest.id));
  const hasIssue = (plugin: Info) => Boolean(plugin.problem || (plugin.enabled && failed.has(plugin.manifest.id)));
  const issueCount = plugins.filter(hasIssue).length;
  const enabledCount = plugins.filter((item) => item.enabled).length;
  const visibleInstalled = plugins
    .filter((item) => matches(query, item.manifest.name, item.manifest.description, item.manifest.author, item.manifest.id))
    .filter((item) => (filter === "enabled" ? item.enabled : filter === "disabled" ? !item.enabled : filter === "issues" ? hasIssue(item) : true))
    .sort((a, b) => Number(hasIssue(b)) - Number(hasIssue(a)) || a.manifest.name.localeCompare(b.manifest.name));
  const madeByAssistant = plugins.filter((item) => item.source === "assistant" && matches(query, item.manifest.name, item.manifest.description, item.manifest.id));
  const visibleCommunity = (registry?.plugins ?? []).filter((item) => matches(query, item.name, item.description, item.author, item.repo, ...(item.tags ?? [])));
  const visibleBundled = catalog.filter((item) => !item.remote && matches(query, item.manifest.name, item.manifest.description));
  const updateCount = updateFor.size;
  const detail = detailId ? plugins.find((item) => item.manifest.id === detailId) : undefined;
  const communityEntry = communityId
    ? registry?.plugins.find((item) => item.id === communityId) ?? (pageEntry?.id === communityId ? pageEntry : undefined)
    : undefined;
  const community = detail ? undefined : communityEntry;
  const meta = SECTIONS[section];

  const openPluginPage = (plugin: Info) => {
    const { manifest } = plugin;
    const listed = registry?.plugins.find((item) => item.id === manifest.id);
    setPageEntry(
      listed ?? {
        id: manifest.id,
        name: manifest.name,
        author: manifest.author ?? "",
        description: manifest.description ?? "",
        repo: repoOf(plugin),
        tags: [],
        installed: true,
        installedVersion: manifest.version,
        enabled: plugin.enabled,
        installedFromRegistry: false,
      },
    );
    setPageFrom(manifest.id);
    setCommunityId(manifest.id);
    setDetailId(null);
  };
  const goBack = () => {
    if (review) setReview(null);
    else if (detail) setDetailId(null);
    else if (pageFrom) {
      setCommunityId(null);
      setDetailId(pageFrom);
      setPageFrom(null);
    } else setCommunityId(null);
  };
  const pageFromPlugin = pageFrom ? plugins.find((item) => item.manifest.id === pageFrom) : undefined;

  const row = (plugin: Info) => (
    <PluginRow
      key={plugin.manifest.id}
      plugin={plugin}
      busy={busy === plugin.manifest.id}
      runtimeError={plugin.enabled ? failed.get(plugin.manifest.id) : undefined}
      update={updateFor.get(plugin.manifest.id)}
      onOpen={() => setDetailId(plugin.manifest.id)}
      onToggle={() => void toggle(plugin)}
    />
  );

  let body: ReactNode;
  if (review) {
    body = <ReviewScreen review={review} busy={busy === "install"} onBack={() => setReview(null)} onApprove={() => void approve(review)} />;
  } else if (detail) {
    body = (
      <PluginDetail
        plugin={detail}
        busy={busy === detail.manifest.id}
        reviewing={busy === `review:${detail.manifest.id}`}
        runtimeError={detail.enabled ? failed.get(detail.manifest.id) : undefined}
        update={updateFor.get(detail.manifest.id)}
        onToggle={() => void toggle(detail)}
        onUninstall={() => void uninstall(detail)}
        onRestart={() => void pluginRuntime.restart(detail.manifest.id)}
        onUpdate={(update) => void reviewCommunity(update.repo, update.id)}
        onOpenPage={repoOf(detail) ? () => openPluginPage(detail) : undefined}
      />
    );
  } else if (community) {
    body = (
      <CommunityDetail
        entry={community}
        update={updateFor.get(community.id)}
        reviewing={busy === `review:${community.id}`}
        installed={plugins.find((item) => item.manifest.id === community.id)}
        onInstall={() => void reviewCommunity(community.repo, community.id)}
        onManage={() => {
          setPageFrom(null);
          setDetailId(community.id);
        }}
      />
    );
  } else if (section === "installed") {
    body = (
      <>
        {plugins.length ? (
          <div className="ps-filters" role="radiogroup" aria-label="Show">
            <FilterChip id="all" filter={filter} setFilter={setFilter} label="All" count={plugins.length} />
            <FilterChip id="enabled" filter={filter} setFilter={setFilter} label="On" count={enabledCount} />
            <FilterChip id="disabled" filter={filter} setFilter={setFilter} label="Off" count={plugins.length - enabledCount} />
            {issueCount ? <FilterChip id="issues" filter={filter} setFilter={setFilter} label="Needs attention" count={issueCount} tone="danger" /> : null}
          </div>
        ) : null}
        {plugins.length === 0 ? (
          <EmptyState icon={<Puzzle size={20} />} title="No plugins yet" body="Plugins add commands, panels, status items and menu actions. Each one runs in a sandbox with only the permissions you approve.">
            <button type="button" className="primary-button" onClick={() => go("discover")}><Compass size={14} /> Discover plugins</button>
            <button type="button" className="secondary-button" onClick={() => void reviewFile()} disabled={busy === "file"}>
              {busy === "file" ? <LoaderCircle size={14} className="spin" /> : <PackagePlus size={14} />} Install from file
            </button>
          </EmptyState>
        ) : visibleInstalled.length === 0 ? (
          <EmptyState title="No matches" body={query.trim() ? `No installed plugin matches “${query}”.` : "No plugin fits this filter."} />
        ) : (
          <div className="ps-list">{visibleInstalled.map(row)}</div>
        )}
      </>
    );
  } else if (section === "updates") {
    const problems = (updates ?? []).filter((item) => item.problem);
    const ready = (updates ?? []).filter((item) => !item.problem);
    body =
      busy === "updates" && updates === null ? (
        <div className="plugin-loading"><LoaderCircle size={15} className="spin" /> Checking the plugins’ GitHub releases…</div>
      ) : (
        <>
          {ready.length ? (
            <div className="ps-list">
              {ready.map((update) => {
                const plugin = plugins.find((item) => item.manifest.id === update.id);
                return (
                  <div key={update.id} className="ps-row">
                    <button type="button" className="ps-row-hit" onClick={() => (plugin ? setDetailId(update.id) : undefined)}>
                      <PluginGlyph enabled={plugin?.enabled ?? true} />
                      <span className="ps-row-text">
                        <span className="ps-row-title"><strong>{update.name}</strong><span className="ps-version">v{update.current} → v{update.latest}</span></span>
                        <span className="ps-row-sub">{update.repo}{update.newPermissions?.length ? ` · asks for ${plural(update.newPermissions.length, "new permission")}` : ""}</span>
                      </span>
                    </button>
                    <div className="ps-row-side">
                      <button type="button" className="primary-button ps-small" onClick={() => void reviewCommunity(update.repo, update.id)} disabled={busy === `review:${update.id}`}>
                        {busy === `review:${update.id}` ? <LoaderCircle size={13} className="spin" /> : <ArrowUpCircle size={13} />} Review update
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState icon={<ShieldCheck size={20} />} title="Everything is up to date" body={updates === null ? "Check GitHub for new releases of your community plugins." : "Every plugin from the community registry runs its latest release."}>
              <button type="button" className="secondary-button" onClick={() => void checkUpdates()} disabled={busy === "updates"}>
                {busy === "updates" ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Check again
              </button>
            </EmptyState>
          )}
          {problems.length ? (
            <div className="ps-notes">
              {problems.map((item) => (
                <div key={item.id} className="plugin-problem"><AlertTriangle size={13} /> <strong>{item.name}</strong> {item.problem}</div>
              ))}
            </div>
          ) : null}
        </>
      );
  } else if (section === "discover") {
    body = (
      <>
        {busy === "registry" && !registry ? (
          <div className="plugin-loading"><LoaderCircle size={15} className="spin" /> Loading the registry…</div>
        ) : registryError ? (
          <EmptyState icon={<AlertTriangle size={20} />} title="Couldn’t load the registry" body={registryError}>
            <button type="button" className="secondary-button" onClick={() => void fetchRegistry()}><RefreshCw size={14} /> Try again</button>
          </EmptyState>
        ) : registry && registry.plugins.length === 0 ? (
          <EmptyState title="The registry is empty" body="No plugins have been published to this registry yet. See docs/plugins/publishing.md to add yours." />
        ) : registry && visibleCommunity.length === 0 ? (
          <EmptyState title="No matches" body={`Nothing in the registry matches “${query}”.`} />
        ) : (
          <div className="ps-grid">
            {visibleCommunity.map((entry) => {
              const update = updateFor.get(entry.id);
              const reviewing = busy === `review:${entry.id}`;
              return (
                <article key={entry.id} className="ps-card">
                  <button type="button" className="ps-card-hit" onClick={() => setCommunityId(entry.id)} aria-label={`${entry.name} details`}>
                    <span className="ps-card-head">
                      <PluginGlyph enabled />
                      <span className="ps-card-title">
                        <h4>{entry.name}</h4>
                        <span>by {entry.author || "unknown"}</span>
                      </span>
                    </span>
                    <span className="ps-card-description">{entry.description || "No description provided."}</span>
                  </button>
                  {entry.tags?.length ? (
                    <div className="ps-tags">{entry.tags.slice(0, 4).map((tag) => <span key={tag}>{tag}</span>)}</div>
                  ) : null}
                  <div className="ps-card-foot">
                    <button type="button" className="plugin-repo-link" onClick={() => openMarkdownLink(`https://github.com/${entry.repo}`)} title="Open the repository on GitHub">
                      <Globe2 size={12} /> {entry.repo}
                    </button>
                    {entry.installed && !update ? (
                      <span className="plugin-installed-tag">{entry.installedVersion ? `v${entry.installedVersion} installed` : "Installed"}</span>
                    ) : (
                      <button type="button" className={`${update ? "primary-button" : "secondary-button"} ps-small`} disabled={reviewing} onClick={() => void reviewCommunity(entry.repo, entry.id)}>
                        {reviewing ? <LoaderCircle size={13} className="spin" /> : update ? <ArrowUpCircle size={13} /> : null}
                        {update ? `Update to ${update.latest}` : "Install"}
                      </button>
                    )}
                  </div>
                </article>
              );
            })}
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
      </>
    );
  } else if (section === "bundled") {
    body =
      visibleBundled.length === 0 ? (
        <EmptyState title="No matches" body={`No bundled plugin matches “${query}”.`} />
      ) : (
        <div className="ps-grid">
          {visibleBundled.map((entry) => {
            const installed = installedIds.has(entry.manifest.id);
            const current = plugins.find((item) => item.manifest.id === entry.manifest.id);
            const newer = current && current.manifest.version !== entry.manifest.version;
            return (
              <article key={entry.manifest.id} className="ps-card">
                <div className="ps-card-head">
                  <PluginGlyph enabled />
                  <div className="ps-card-title">
                    <h4>{entry.manifest.name}</h4>
                    <span>v{entry.manifest.version} · {entry.manifest.author || "Noteral"}</span>
                  </div>
                </div>
                <p className="ps-card-description">{entry.manifest.description || "No description provided."}</p>
                <div className="ps-card-foot">
                  <RiskSummary manifest={entry.manifest} />
                  {installed && !newer ? (
                    <span className="plugin-installed-tag">Installed</span>
                  ) : (
                    <button type="button" className="secondary-button ps-small" onClick={() => reviewBundled(entry)}>{newer ? `Update to ${entry.manifest.version}` : "Install"}</button>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      );
  } else {
    body = (
      <div className="created-panel">
        <CreatedLayers query={query} />
        <div className="created-head">
          <h3><Bot size={13} /> Plugins made by the assistant</h3>
        </div>
        {madeByAssistant.length ? (
          <div className="ps-list">{madeByAssistant.map(row)}</div>
        ) : (
          <p className="plugin-tab-note">
            {query.trim() ? `No assistant plugin matches “${query}”.` : "In Creator mode the assistant can write a plugin, test it in a sandbox and install it after you approve. Those plugins show up here."}
          </p>
        )}
      </div>
    );
  }

  const inList = !review && !detail && !community;
  const createdCount = layers.length + plugins.filter((item) => item.source === "assistant").length;

  return (
    <Modal open={open} bare title="Plugins" onClose={() => setOverlay(null)} width="large" className="plugin-store" bodyClassName="plugin-store-body">
      <div className="ps">
        <nav className="ps-nav" aria-label="Plugin sections">
          <div className="ps-brand">
            <h2>Plugins</h2>
            <p>Sandboxed extensions</p>
          </div>
          <div className="ps-nav-items">
            <NavItem id="installed" section={section} go={go} icon={<Puzzle size={15} />} label="Installed" count={plugins.length || undefined} />
            <NavItem id="updates" section={section} go={go} icon={<ArrowUpCircle size={15} />} label="Updates" badge={updateCount || undefined} />
            <NavItem id="discover" section={section} go={go} icon={<Compass size={15} />} label="Discover" count={registry?.plugins.length} />
            {catalog.some((item) => !item.remote) ? <NavItem id="bundled" section={section} go={go} icon={<Box size={15} />} label="Bundled" count={catalog.filter((item) => !item.remote).length} /> : null}
            <NavItem id="created" section={section} go={go} icon={<Sparkles size={15} />} label="Created" count={createdCount || undefined} />
          </div>
          <div className="ps-nav-foot">
            <button type="button" className="ps-nav-action" onClick={() => void reviewFile()} disabled={busy === "file"}>
              {busy === "file" ? <LoaderCircle size={14} className="spin" /> : <PackagePlus size={14} />} Install from file
            </button>
            <button type="button" className="ps-nav-action" onClick={() => openMarkdownLink(DOCS_URL)}>
              <BookOpen size={14} /> Build a plugin
            </button>
            <span className="ps-env">App {env?.appVersion ?? "…"} · SDK {env?.sdkVersion ?? "…"}</span>
          </div>
        </nav>

        <section className="ps-main" aria-label={review ? "Review plugin" : detail ? detail.manifest.name : community ? community.name : meta.title}>
          <header className="ps-head">
            {inList ? (
              <div className="ps-head-copy">
                <h3>{meta.title}</h3>
                <p>{meta.blurb}</p>
              </div>
            ) : (
              <div className="ps-head-copy">
                <button type="button" className="text-button ps-back" onClick={goBack}>
                  <ArrowLeft size={13} /> {review ? (detail ? detail.manifest.name : communityEntry ? communityEntry.name : meta.title) : detail && communityEntry ? communityEntry.name : !detail && pageFromPlugin ? pageFromPlugin.manifest.name : meta.title}
                </button>
              </div>
            )}
            {inList && section !== "updates" ? (
              <label className="ps-search">
                <Search size={14} />
                <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={section === "discover" ? "Search the registry" : "Filter"} aria-label="Filter plugins" spellCheck={false} />
              </label>
            ) : null}
            {inList && section === "updates" ? (
              <button type="button" className="secondary-button ps-small" onClick={() => void checkUpdates()} disabled={busy === "updates"}>
                {busy === "updates" ? <LoaderCircle size={13} className="spin" /> : <RefreshCw size={13} />} Check now
              </button>
            ) : null}
            <button type="button" className="icon-button ps-close" onClick={() => setOverlay(null)} aria-label="Close plugins" title="Close">
              <X size={17} />
            </button>
          </header>
          <div className={`ps-content${inList ? "" : " is-detail"}`}>{body}</div>
        </section>
      </div>
    </Modal>
  );
}

function NavItem({ id, section, go, icon, label, count, badge }: { id: Section; section: Section; go: (section: Section) => void; icon: ReactNode; label: string; count?: number; badge?: number }) {
  return (
    <button type="button" className={`ps-nav-item${section === id ? " active" : ""}`} aria-current={section === id ? "page" : undefined} onClick={() => go(id)}>
      {icon}
      <span>{label}</span>
      {badge ? <em className="ps-badge" title={plural(badge, "update")}>{badge}</em> : count !== undefined ? <small>{count}</small> : null}
    </button>
  );
}

function FilterChip({ id, filter, setFilter, label, count, tone }: { id: InstalledFilter; filter: InstalledFilter; setFilter: (filter: InstalledFilter) => void; label: string; count: number; tone?: "danger" }) {
  return (
    <button type="button" role="radio" aria-checked={filter === id} className={`ps-chip${filter === id ? " active" : ""}${tone ? ` is-${tone}` : ""}`} onClick={() => setFilter(id)}>
      {label} <small>{count}</small>
    </button>
  );
}

function EmptyState({ icon, title, body, children }: { icon?: ReactNode; title: string; body: string; children?: ReactNode }) {
  return (
    <div className="plugin-empty">
      {icon ? <span className="plugin-empty-icon">{icon}</span> : null}
      <strong>{title}</strong>
      <p>{body}</p>
      {children ? <div className="plugin-empty-actions">{children}</div> : null}
    </div>
  );
}

function PluginGlyph({ enabled, size = "md" }: { enabled: boolean; size?: "md" | "lg" }) {
  return (
    <span className={`ps-glyph is-${size}${enabled ? " is-on" : ""}`} aria-hidden="true">
      <Puzzle size={size === "lg" ? 20 : 16} strokeWidth={1.7} />
    </span>
  );
}

/** One line that tells you how much a plugin can reach, without listing every permission. */
function RiskSummary({ manifest }: { manifest: Manifest }) {
  const risk = riskOf(manifest);
  const count = (manifest.permissions ?? []).length;
  const label = risk === "none" ? "No permissions" : `${plural(count, "permission")}${risk === "high" ? " · can change or send data" : ""}`;
  return (
    <span className={`ps-risk risk-${risk}`} title={permissionsOf(manifest).join(", ") || undefined}>
      <ShieldCheck size={12} /> {label}
    </span>
  );
}

interface PluginRowProps {
  plugin: Info;
  busy: boolean;
  runtimeError?: string;
  update?: PluginUpdate;
  onOpen: () => void;
  onToggle: () => void;
}

function PluginRow({ plugin, busy, runtimeError, update, onOpen, onToggle }: PluginRowProps) {
  const { manifest } = plugin;
  const source = sourceLabel(plugin.source);
  const problem = plugin.problem || (runtimeError ? `Stopped: ${runtimeError}` : "");
  return (
    <div className={`ps-row${plugin.enabled ? " is-on" : ""}${problem ? " has-problem" : ""}`}>
      <button type="button" className="ps-row-hit" onClick={onOpen} aria-label={`${manifest.name} details`}>
        <PluginGlyph enabled={plugin.enabled} />
        <span className="ps-row-text">
          <span className="ps-row-title">
            <strong>{manifest.name}</strong>
            <span className="ps-version">v{manifest.version}</span>
            {update ? <span className="ps-pill is-accent"><ArrowUpCircle size={11} /> {update.latest}</span> : null}
          </span>
          {problem ? (
            <span className="ps-row-sub is-problem"><AlertTriangle size={11} /> {problem}</span>
          ) : (
            <span className="ps-row-sub">{manifest.description || "No description provided."}</span>
          )}
          <span className="ps-row-meta">
            <span>{source.icon} {source.label}</span>
            <span>{manifest.author || "Unknown author"}</span>
            <RiskSummary manifest={manifest} />
          </span>
        </span>
      </button>
      <div className="ps-row-side">
        <label className="switch" title={plugin.enabled ? "Turn off" : "Turn on"}>
          <input type="checkbox" checked={plugin.enabled} disabled={Boolean(plugin.problem) || busy} onChange={onToggle} aria-label={`Enable ${manifest.name}`} />
          <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        </label>
        <ChevronRight size={15} className="ps-row-chevron" aria-hidden="true" />
      </div>
    </div>
  );
}

interface PluginDetailProps {
  plugin: Info;
  busy: boolean;
  reviewing: boolean;
  runtimeError?: string;
  update?: PluginUpdate;
  onToggle: () => void;
  onUninstall: () => void;
  onRestart: () => void;
  onUpdate: (update: PluginUpdate) => void;
  /** Opens the plugin's page (README, releases) inside the manager. */
  onOpenPage?: () => void;
}

function PluginDetail({ plugin, busy, reviewing, runtimeError, update, onToggle, onUninstall, onRestart, onUpdate, onOpenPage }: PluginDetailProps) {
  const { manifest } = plugin;
  const source = sourceLabel(plugin.source);
  const repo = repoOf(plugin);
  const optionFields = usePluginOptionFields(manifest);
  usePluginConfigure();
  const hasPage = plugin.enabled && pluginConfigure.hasPage(manifest.id);
  const contributes = contributionGroups(manifest);

  return (
    <div className="ps-detail">
      <header className="ps-detail-head">
        <PluginGlyph enabled={plugin.enabled} size="lg" />
        <div className="ps-detail-title">
          <h3>{manifest.name}</h3>
          <p>
            v{manifest.version} · {manifest.author || "Unknown author"} · <span className="ps-source">{source.icon} {source.label}</span>
          </p>
        </div>
        <label className="switch ps-detail-switch" title={plugin.enabled ? "Turn off" : "Turn on"}>
          <span className="ps-switch-label">{plugin.enabled ? "On" : "Off"}</span>
          <input type="checkbox" checked={plugin.enabled} disabled={Boolean(plugin.problem) || busy} onChange={onToggle} aria-label={`Enable ${manifest.name}`} />
          <span className="switch-track" aria-hidden="true"><span className="switch-thumb" /></span>
        </label>
      </header>

      <div className="ps-actions">
        {update ? (
          <button type="button" className="primary-button ps-small" onClick={() => onUpdate(update)} disabled={reviewing}>
            {reviewing ? <LoaderCircle size={13} className="spin" /> : <ArrowUpCircle size={13} />} Update to {update.latest}
          </button>
        ) : null}
        {hasPage ? (
          <button type="button" className="secondary-button ps-small" onClick={() => pluginConfigure.open(manifest.id)}>
            <SlidersHorizontal size={13} /> Open settings
          </button>
        ) : null}
        {repo && onOpenPage ? (
          <button type="button" className="secondary-button ps-small" onClick={onOpenPage} title="Its README, releases and permissions">
            <BookOpen size={13} /> Plugin page
          </button>
        ) : null}
        <span className="ps-actions-gap" />
        <button type="button" className="secondary-button ps-small ps-danger" onClick={onUninstall} disabled={busy}>
          <Trash2 size={13} /> Uninstall
        </button>
      </div>

      {plugin.problem ? <div className="plugin-problem"><AlertTriangle size={13} /> {plugin.problem}</div> : null}
      {runtimeError ? (
        <div className="plugin-problem">
          <AlertTriangle size={13} /> <span>Stopped: {runtimeError}</span>
          <button type="button" className="text-button" onClick={onRestart}><RotateCcw size={12} /> Restart</button>
        </div>
      ) : null}

      <p className="ps-detail-description">{manifest.description || "No description provided."}</p>

      {optionFields.length || hasPage ? (
        <FoldSection
          id="settings"
          icon={<Settings2 size={13} />}
          title="Settings"
          note={optionFields.length ? plural(optionFields.length, "option") : undefined}
          actions={hasPage ? (
            <button type="button" className="text-button ps-small" onClick={() => pluginConfigure.open(manifest.id)}>
              <SlidersHorizontal size={12} /> Full settings page
            </button>
          ) : undefined}
        >
          {optionFields.length ? (
            <PluginOptions manifest={manifest} />
          ) : (
            <p className="plugin-review-copy">
              {manifest.name} keeps its settings on its own page.{" "}
              <button type="button" className="text-button" onClick={() => pluginConfigure.open(manifest.id)}>Open it</button>
            </p>
          )}
        </FoldSection>
      ) : null}

      {contributes.length ? (
        <FoldSection id="adds" icon={<Puzzle size={13} />} title="What it adds" note={plural(contributes.reduce((n, group) => n + group.items.length, 0), "item")}>
          <ContributionList groups={contributes} limit={6} />
        </FoldSection>
      ) : null}

      <FoldSection
        id="permissions"
        icon={<ShieldCheck size={13} />}
        title={(manifest.permissions ?? []).length ? "What it can access" : "It asks for no permissions"}
        note={(manifest.permissions ?? []).length ? String(permissionsOf(manifest).length) : undefined}
      >
        <PermissionList manifest={manifest} />
      </FoldSection>

      <FoldSection id="details" title="Details" defaultCollapsed>
        <dl className="ps-facts">
          <dt>ID</dt><dd><code>{manifest.id}</code></dd>
          <dt>Installed</dt><dd>{relativeTime(plugin.installedAt)}</dd>
          <dt>SDK</dt><dd>{manifest.sdkVersion}</dd>
          {manifest.minAppVersion ? (<><dt>Needs</dt><dd>Noteral {manifest.minAppVersion} or later</dd></>) : null}
          {repo ? (<><dt>Repository</dt><dd><button type="button" className="plugin-repo-link" onClick={() => openMarkdownLink(`https://github.com/${repo}`)}><Globe2 size={12} /> {repo} <ExternalLink size={11} /></button></dd></>) : null}
          {manifest.authorUrl ? (<><dt>Author</dt><dd><button type="button" className="plugin-repo-link" onClick={() => openMarkdownLink(manifest.authorUrl!)}>{manifest.authorUrl}</button></dd></>) : null}
        </dl>
      </FoldSection>
    </div>
  );
}

function ContributionList({ groups, limit }: { groups: ReturnType<typeof contributionGroups>; limit: number }) {
  return (
    <ul className="ps-adds">
      {groups.map((group) => (
        <li key={group.label}>
          <span className="ps-adds-icon">{group.icon}</span>
          <div>
            <strong>{plural(group.items.length, group.label, group.many)}</strong>
            <span>{group.items.slice(0, limit).join(" · ")}{group.items.length > limit ? ` · +${group.items.length - limit} more` : ""}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}

function contributionGroups(manifest: Manifest) {
  const c = manifest.contributes ?? {};
  const groups: { label: string; many?: string; icon: ReactNode; items: string[] }[] = [
    { label: "command", icon: <SquareTerminal size={14} />, items: list(c.commands).map((item) => item.title || item.id) },
    { label: "panel", icon: <LayoutPanelLeft size={14} />, items: list(c.panels).map((item) => item.title || item.id) },
    { label: "status item", icon: <PanelBottom size={14} />, items: list(c.statusItems).map((item) => item.label || item.id) },
    { label: "menu item", icon: <ListTree size={14} />, items: list(c.menus).map((item) => `${item.title} (${item.menu})`) },
    { label: "setting", icon: <Settings2 size={14} />, items: list(c.settings).map((item) => item.label || item.key) },
  ];
  return groups.filter((group) => group.items.length);
}

function PermissionList({ manifest, added }: { manifest: Manifest; added?: Set<string> }) {
  const permissions = permissionsOf(manifest);
  if (!permissions.length) return <p className="plugin-review-copy">It can only run its own code inside its sandbox.</p>;
  return (
    <ul className="plugin-permissions">
      {permissions.map((permission) => {
        const info = permissionInfo.get(permission);
        return (
          <li key={permission} className={`risk-${info?.risk ?? "low"}`}>
            <span className="plugin-risk" aria-label={`${info?.risk ?? "low"} risk`}>{info?.risk ?? "low"}</span>
            <div>
              <strong>{info?.title ?? permission}{added?.has(permission) ? <em className="plugin-new">new</em> : null}</strong>
              <span>{info?.description ?? "Unknown permission."}</span>
            </div>
            <code>{permission}</code>
          </li>
        );
      })}
    </ul>
  );
}

interface CommunityInfo {
  readme?: { markdown: string; imageBase: string; linkBase: string };
  readmeError?: string;
  release?: Release;
  releaseError?: string;
}

/** README and latest release per repo, kept for the session so going back and forth is instant. */
const communityCache = new Map<string, Promise<CommunityInfo>>();

function loadCommunityInfo(repo: string, id: string): Promise<CommunityInfo> {
  const key = `${repo}#${id}`;
  let pending = communityCache.get(key);
  if (!pending) {
    pending = Promise.all([
      api.getCommunityReadme(repo).then((readme) => ({ readme }), (err) => ({ readmeError: errorMessage(err) })),
      api.getCommunityRelease(repo, id).then((release) => ({ release }), (err) => ({ releaseError: errorMessage(err) })),
    ]).then(([a, b]) => {
      const info: CommunityInfo = { ...a, ...b };
      // Don't keep failures: the next visit tries again.
      if (info.readmeError || info.releaseError) communityCache.delete(key);
      return info;
    });
    communityCache.set(key, pending);
  }
  return pending;
}

interface CommunityDetailProps {
  entry: CommunityPlugin;
  update?: PluginUpdate;
  installed?: Info;
  reviewing: boolean;
  onInstall: () => void;
  onManage: () => void;
}

/** A community plugin before you install it: what it is (its README), what it can reach, where it comes from. */
function CommunityDetail({ entry, update, installed, reviewing, onInstall, onManage }: CommunityDetailProps) {
  const [info, setInfo] = useState<CommunityInfo | null>(null);

  useEffect(() => {
    let live = true;
    setInfo(null);
    void loadCommunityInfo(entry.repo, entry.id).then((value) => live && setInfo(value));
    return () => {
      live = false;
    };
  }, [entry.repo, entry.id]);

  const release = info?.release;
  const manifest = release?.manifest;
  const readme = useMemo(() => {
    if (!info?.readme?.markdown) return "";
    return dropLeadingTitle(prepareReadme(info.readme.markdown, info.readme), entry.name);
  }, [info, entry.name]);
  const repoUrl = `https://github.com/${entry.repo}`;
  const contributes = manifest ? contributionGroups(manifest) : [];
  const blocked = release ? release.problem || (release.compatible ? "" : "This release is not compatible with your version of Noteral.") : "";

  return (
    <div className="ps-detail ps-community">
      <header className="ps-detail-head">
        <PluginGlyph enabled size="lg" />
        <div className="ps-detail-title">
          <h3>{entry.name}</h3>
          <p>
            {manifest ? `v${manifest.version} · ` : ""}by {entry.author || "unknown"}
            {release?.publishedAt ? ` · released ${relativeTime(release.publishedAt)}` : ""}
          </p>
        </div>
      </header>

      <div className="ps-actions">
        {installed && !update ? (
          <>
            <span className="plugin-installed-tag">v{installed.manifest.version} installed</span>
            <button type="button" className="secondary-button ps-small" onClick={onManage}><Settings2 size={13} /> Manage</button>
          </>
        ) : (
          <button type="button" className="primary-button ps-small" disabled={reviewing || Boolean(blocked)} onClick={onInstall}>
            {reviewing ? <LoaderCircle size={13} className="spin" /> : update ? <ArrowUpCircle size={13} /> : <PackagePlus size={13} />}
            {update ? `Update to ${update.latest}` : "Install"}
          </button>
        )}
        <button type="button" className="secondary-button ps-small" onClick={() => openMarkdownLink(repoUrl)}><ExternalLink size={13} /> Repository</button>
        {release?.htmlUrl ? (
          <button type="button" className="secondary-button ps-small" onClick={() => openMarkdownLink(release.htmlUrl)}><ExternalLink size={13} /> Release</button>
        ) : null}
        <span className="ps-actions-gap" />
        {manifest ? <RiskSummary manifest={manifest} /> : null}
      </div>

      {entry.description ? <p className="ps-detail-description">{entry.description}</p> : null}
      {blocked ? <div className="plugin-problem"><AlertTriangle size={13} /> {blocked}</div> : null}
      {entry.tags?.length ? <div className="ps-tags">{entry.tags.map((tag) => <span key={tag}>{tag}</span>)}</div> : null}

      <FoldSection id="readme" icon={<FileText size={13} />} title="Readme">
        {!info ? (
          <div className="plugin-loading"><LoaderCircle size={15} className="spin" /> Loading the README from GitHub…</div>
        ) : readme ? (
          <div className="ps-readme">
            <Markdown source={readme} images onLink={openMarkdownLink} />
          </div>
        ) : (
          <p className="plugin-tab-note">
            {info.readmeError ? `Couldn’t load the README: ${info.readmeError}` : "This repository has no README."}{" "}
            <button type="button" className="text-button" onClick={() => openMarkdownLink(repoUrl)}>Open on GitHub</button>
          </p>
        )}
      </FoldSection>

      {manifest ? (
        <FoldSection
          id="permissions"
          icon={<ShieldCheck size={13} />}
          title={permissionsOf(manifest).length ? "Permissions it asks for" : "It asks for no permissions"}
          note={permissionsOf(manifest).length ? String(permissionsOf(manifest).length) : undefined}
        >
          <PermissionList manifest={manifest} />
        </FoldSection>
      ) : null}

      {contributes.length ? (
        <FoldSection id="adds" icon={<Puzzle size={13} />} title="What it adds" note={plural(contributes.reduce((n, group) => n + group.items.length, 0), "item")}>
          <ContributionList groups={contributes} limit={6} />
        </FoldSection>
      ) : null}

      <FoldSection id="details" title="Details" defaultCollapsed>
        <dl className="ps-facts">
          <dt>Repository</dt>
          <dd><button type="button" className="plugin-repo-link" onClick={() => openMarkdownLink(repoUrl)}><Globe2 size={12} /> {entry.repo} <ExternalLink size={11} /></button></dd>
          <dt>Plugin id</dt>
          <dd><code>{entry.id}</code></dd>
          {manifest?.minAppVersion ? (<><dt>Needs Noteral</dt><dd>{manifest.minAppVersion} or newer</dd></>) : null}
          {release?.tag ? (<><dt>Latest release</dt><dd>{release.tag}{release.publishedAt ? ` · ${relativeTime(release.publishedAt)}` : ""}</dd></>) : null}
          {info?.releaseError ? (<><dt>Release</dt><dd>{info.releaseError}</dd></>) : null}
        </dl>
      </FoldSection>
    </div>
  );
}

function ReviewScreen({ review, busy, onBack, onApprove }: { review: Review; busy: boolean; onBack: () => void; onApprove: () => void }) {
  const { manifest, release } = review;
  const permissions = permissionsOf(manifest);
  const added = new Set(review.added ?? []);
  const highRisk = permissions.some((item) => permissionInfo.get(item)?.risk === "high");
  const blocked = Boolean(review.problem);
  const contributes = contributionGroups(manifest);
  const origin =
    review.origin === "community"
      ? `github.com/${review.repo}${release?.tag && release.tag.replace(/^v/, "") !== manifest.version ? ` · tag ${release.tag}` : ""}`
      : review.origin === "bundled" ? "Bundled with Noteral" : "Local file";

  return (
    <div className="ps-detail plugin-review">
      <header className="ps-detail-head">
        <PluginGlyph enabled size="lg" />
        <div className="ps-detail-title">
          <h3>{review.installedVersion ? `Update ${manifest.name}` : `Install ${manifest.name}`}</h3>
          <p>
            {review.installedVersion ? `v${review.installedVersion} → v${manifest.version}` : `v${manifest.version}`} · by {manifest.author || "unknown"} · {origin}
          </p>
        </div>
        {review.origin === "community" && release?.htmlUrl ? (
          <button type="button" className="secondary-button ps-small" onClick={() => openMarkdownLink(release.htmlUrl)}><ExternalLink size={13} /> Release page</button>
        ) : null}
      </header>
      {manifest.description ? <p className="ps-detail-description">{manifest.description}</p> : null}
      {review.problem ? <div className="plugin-problem"><AlertTriangle size={13} /> {review.problem}</div> : null}

      <section className="ps-section">
        <h4><ShieldCheck size={13} /> {permissions.length ? "It will be able to" : "It asks for no permissions"}</h4>
        <PermissionList manifest={manifest} added={added} />
        {highRisk ? <p className="plugin-review-warning"><AlertTriangle size={13} /> High-risk permissions let it change or send your data. Only approve plugins you trust.</p> : null}
      </section>

      {contributes.length ? (
        <section className="ps-section">
          <h4><Puzzle size={13} /> What it adds</h4>
          <ul className="ps-adds">
            {contributes.map((group) => (
              <li key={group.label}>
                <span className="ps-adds-icon">{group.icon}</span>
                <div>
                  <strong>{plural(group.items.length, group.label, group.many)}</strong>
                  <span>{group.items.slice(0, 6).join(" · ")}</span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {release?.notes ? (
        <section className="ps-section">
          <h4>Release notes{release.publishedAt ? <span> · {relativeTime(release.publishedAt)}</span> : null}</h4>
          <Markdown source={release.notes.slice(0, 6000)} className="plugin-review-notes" onLink={openMarkdownLink} />
        </section>
      ) : null}

      <footer className="plugin-review-foot">
        <span>Plugins run sandboxed. You can turn it off or uninstall it any time.</span>
        <button type="button" className="secondary-button" onClick={onBack}>Cancel</button>
        <button type="button" className="primary-button" onClick={onApprove} disabled={busy || blocked}>
          {busy ? <LoaderCircle size={14} className="spin" /> : null} {permissions.length ? "Approve and " : ""}{review.installedVersion ? "update" : "install"}
        </button>
      </footer>
    </div>
  );
}

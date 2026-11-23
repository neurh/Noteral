import { useState } from "react";
import {
  Feather,
  FilePlus2,
  House,
  LayoutGrid,
  Library,
  Search,
  Star,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PageMeta } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { HOME_BACKGROUND_LABELS, HOME_TEMPLATE_LABELS, type HomeBackground, type HomeTemplate } from "../../lib/home";
import { useAppStore } from "../../store";
import { PageIcon } from "../PageIcon";
import { KindIcon } from "../KindIcon";

export const homeTemplateMeta: Array<{ id: HomeTemplate; label: string; description: string; icon: LucideIcon }> = [
  { id: "default", label: HOME_TEMPLATE_LABELS.default, description: "A calm place to start", icon: House },
  { id: "library", label: HOME_TEMPLATE_LABELS.library, description: "Search and browse every page", icon: Library },
  { id: "focus", label: HOME_TEMPLATE_LABELS.focus, description: "One clear place to begin", icon: Feather },
  { id: "gallery", label: HOME_TEMPLATE_LABELS.gallery, description: "See your pages at a glance", icon: LayoutGrid },
];

export const homeBackgroundMeta: Array<{ id: HomeBackground; label: string; swatch: string }> = [
  { id: "paper", label: HOME_BACKGROUND_LABELS.paper, swatch: "#f7f3ec" },
  { id: "linen", label: HOME_BACKGROUND_LABELS.linen, swatch: "#f0e4d1" },
  { id: "sage", label: HOME_BACKGROUND_LABELS.sage, swatch: "#e4ecdf" },
  { id: "clay", label: HOME_BACKGROUND_LABELS.clay, swatch: "#f0ddd2" },
  { id: "dusk", label: HOME_BACKGROUND_LABELS.dusk, swatch: "#e1e9f0" },
];

function useHomePages() {
  const pages = useAppStore((state) => state.pages);
  const recent = useAppStore((state) => state.recent);
  const favorites = useAppStore((state) => state.favorites);
  const byId = new Map(pages.map((page) => [page.id, page]));
  const favoritePages = favorites
    .map((id) => byId.get(id))
    .filter((page): page is PageMeta => Boolean(page));
  const recentPages = recent
    .map((page) => byId.get(page.id))
    .filter((page): page is PageMeta => Boolean(page));
  const sorted = [...pages].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  return { pages, favoritePages, recentPages, sorted };
}

export function HomeRow({ page, showTime = true }: { page: PageMeta; showTime?: boolean }) {
  const selectPage = useAppStore((state) => state.selectPage);
  return (
    <button type="button" className="home-row" onClick={() => void selectPage(page.id)} title={page.title}>
      <span className="tree-icon" aria-hidden="true">
        <PageIcon value={page.icon} size={15} fallback={<KindIcon page={page} size={15} />} />
      </span>
      <span className="home-row-title">{page.title}</span>
      {showTime ? <span className="home-row-time">{relativeTime(page.updatedAt)}</span> : null}
    </button>
  );
}

function HomeEyebrow({ workspaceName, children }: { workspaceName: string; children: string }) {
  return (
    <div className="home-eyebrow">
      <span>{children}</span>
      <span className="home-eyebrow-workspace">{workspaceName}</span>
    </div>
  );
}

function HomeFooter() {
  return <p className="home-foot">Everything stays on this device.</p>;
}

export function DefaultHome() {
  const workspace = useAppStore((state) => state.workspace);
  const createPage = useAppStore((state) => state.createPage);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const { favoritePages, recentPages } = useHomePages();
  return (
    <div className="home-page">
      <HomeEyebrow workspaceName={workspace?.name ?? "Noteral"}>Home</HomeEyebrow>
      <h1>Where were we?</h1>
      <p className="home-lede">Start a new page, or step back into a recent one.</p>
      <div className="home-actions">
        <button type="button" className="primary-button" onClick={() => void createPage()}>
          <FilePlus2 size={15} /> New page
        </button>
        <button type="button" className="secondary-button" onClick={() => setOverlay("library")}>
          <Search size={14} /> Search library
          <span className="home-kbd">Ctrl/⌘ K</span>
        </button>
      </div>
      {favoritePages.length > 0 ? (
        <section className="home-section" aria-labelledby="home-favorites">
          <div className="home-section-head"><h2 id="home-favorites">Favorites</h2></div>
          <div className="home-list">
            {favoritePages.slice(0, 5).map((page) => <HomeRow key={page.id} page={page} showTime={false} />)}
          </div>
        </section>
      ) : null}
      <section className="home-section" aria-labelledby="home-recent">
        <div className="home-section-head">
          <h2 id="home-recent">Recent</h2>
          <button type="button" className="home-link" onClick={() => setOverlay("library")}>All pages</button>
        </div>
        {recentPages.length > 0 ? (
          <div className="home-list">
            {recentPages.slice(0, 6).map((page) => <HomeRow key={page.id} page={page} />)}
          </div>
        ) : (
          <p className="home-empty">Nothing here yet. Your first page will show up as you write.</p>
        )}
      </section>
      <HomeFooter />
    </div>
  );
}

export function LibraryHome() {
  const workspace = useAppStore((state) => state.workspace);
  const selectPage = useAppStore((state) => state.selectPage);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const { favoritePages, sorted } = useHomePages();
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const results = needle ? sorted.filter((page) => page.title.toLowerCase().includes(needle)).slice(0, 20) : [];

  return (
    <div className="home-page home-library">
      <div className="home-library-head">
        <div>
          <HomeEyebrow workspaceName={workspace?.name ?? "Noteral"}>Library</HomeEyebrow>
          <h1>Everything you've written.</h1>
        </div>
        <span className="home-count">{sorted.length} {sorted.length === 1 ? "page" : "pages"}</span>
      </div>
      <p className="home-lede">A quick index of this workspace. Search titles here, or open the library for full text.</p>
      <label className="home-search">
        <Search size={15} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Escape") setQuery("");
            if (event.key === "Enter" && results[0]) void selectPage(results[0].id);
          }}
          placeholder="Search page titles"
          aria-label="Search page titles"
        />
        {query ? (
          <button type="button" className="home-search-clear" onClick={() => setQuery("")}>Clear</button>
        ) : (
          <button type="button" className="home-search-full" onClick={() => setOverlay("library")}>Full text</button>
        )}
      </label>

      {needle ? (
        <section className="home-section home-search-results" aria-labelledby="home-results">
          <div className="home-section-head">
            <h2 id="home-results">{results.length} {results.length === 1 ? "result" : "results"}</h2>
            <span className="home-section-note">Enter opens the first</span>
          </div>
          {results.length > 0 ? (
            <div className="home-list">{results.map((page) => <HomeRow key={page.id} page={page} />)}</div>
          ) : (
            <p className="home-empty">No page titles match “{query.trim()}”. Try the full-text library.</p>
          )}
        </section>
      ) : (
        <div className="home-columns">
          <section className="home-section" aria-labelledby="home-pinned">
            <div className="home-section-head"><h2 id="home-pinned">Favorites</h2></div>
            {favoritePages.length > 0 ? (
              <div className="home-list">{favoritePages.slice(0, 7).map((page) => <HomeRow key={page.id} page={page} showTime={false} />)}</div>
            ) : (
              <p className="home-empty">Star a page to pin it here.</p>
            )}
          </section>
          <section className="home-section" aria-labelledby="home-all-pages">
            <div className="home-section-head">
              <h2 id="home-all-pages">All pages</h2>
              <button type="button" className="home-link" onClick={() => setOverlay("library")}>Open library</button>
            </div>
            <div className="home-list">{sorted.slice(0, 9).map((page) => <HomeRow key={page.id} page={page} />)}</div>
          </section>
        </div>
      )}
      <HomeFooter />
    </div>
  );
}

export function FocusHome() {
  const workspace = useAppStore((state) => state.workspace);
  const createPage = useAppStore((state) => state.createPage);
  const selectPage = useAppStore((state) => state.selectPage);
  const { recentPages } = useHomePages();
  const now = new Date();
  const greeting = now.getHours() < 12 ? "Good morning" : now.getHours() < 18 ? "Good afternoon" : "Good evening";
  const date = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(now);
  const continuePage = recentPages[0];

  return (
    <div className="home-page home-focus">
      <HomeEyebrow workspaceName={workspace?.name ?? "Noteral"}>{date}</HomeEyebrow>
      <h1>{greeting}.</h1>
      <p className="home-focus-prompt">What's worth writing today?</p>
      <div className="home-actions home-focus-actions">
        <button type="button" className="primary-button" onClick={() => void createPage()}>
          <FilePlus2 size={15} /> Start a page
        </button>
        {continuePage ? (
          <button
            type="button"
            className="secondary-button"
            title={`Continue “${continuePage.title}”`}
            onClick={() => void selectPage(continuePage.id)}
          >
            Continue <span className="home-continue-title">“{continuePage.title}”</span>
          </button>
        ) : null}
      </div>
      {recentPages.length > 0 ? (
        <section className="home-focus-recent" aria-labelledby="home-pick-up">
          <div className="home-section-head"><h2 id="home-pick-up">Pick up where you left off</h2></div>
          <div className="home-list">
            {recentPages.slice(0, 3).map((page) => <HomeRow key={page.id} page={page} />)}
          </div>
        </section>
      ) : null}
      <HomeFooter />
    </div>
  );
}

export function GalleryHome() {
  const workspace = useAppStore((state) => state.workspace);
  const selectPage = useAppStore((state) => state.selectPage);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const { pages, favoritePages, sorted } = useHomePages();
  const [filter, setFilter] = useState<"all" | "favorites">("all");
  const shown = filter === "favorites" ? favoritePages : sorted;

  return (
    <div className="home-page home-gallery">
      <HomeEyebrow workspaceName={workspace?.name ?? "Noteral"}>Gallery</HomeEyebrow>
      <h1>A room for every thought.</h1>
      <p className="home-lede">Your pages, laid out in the open. Pick one up, or make a new mark.</p>
      <div className="home-gallery-tools">
        <div className="home-segmented" role="group" aria-label="Filter pages">
          <button type="button" className={filter === "all" ? "active" : ""} aria-pressed={filter === "all"} onClick={() => setFilter("all")}>
            All <span>{pages.length}</span>
          </button>
          <button type="button" className={filter === "favorites" ? "active" : ""} aria-pressed={filter === "favorites"} onClick={() => setFilter("favorites")}>
            Favorites <span>{favoritePages.length}</span>
          </button>
        </div>
        <button type="button" className="secondary-button" onClick={() => setOverlay("library")}>
          <Search size={14} /> Search
        </button>
      </div>
      {shown.length > 0 ? (
        <div className="home-gallery-grid">
          {shown.slice(0, 12).map((page, index) => (
            <button key={page.id} type="button" className="home-card" onClick={() => void selectPage(page.id)} title={page.title}>
              <span className={`home-card-icon tone-${index % 5}`} aria-hidden="true">
                <PageIcon value={page.icon} size={18} fallback={<KindIcon page={page} size={18} />} />
              </span>
              <span className="home-card-title">{page.title}</span>
              <span className="home-card-meta">
                {relativeTime(page.updatedAt)}
                {favoritePages.some((item) => item.id === page.id) ? <Star size={11} fill="currentColor" aria-label="Favorite" /> : null}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <p className="home-empty">
          {filter === "favorites" ? "No favorites yet. Star a page and it will appear here." : "No pages yet. Start with a blank page."}
        </p>
      )}
      <HomeFooter />
    </div>
  );
}

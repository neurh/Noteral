import { useMemo, useState } from "react";
import { ArrowRight, Database, FilePlus2, Library, Search, Star } from "lucide-react";
import type { PageMeta } from "../../lib/api";
import { relativeTime } from "../../lib/format";
import { useAppStore } from "../../store";
import { greetingFor, groupByLetter, longDate, promptOfTheDay, useHomeData, useMinuteClock } from "./data";
import {
  ActivityWidget,
  ClockWidget,
  ContinueWidget,
  FavoritesWidget,
  GalleryCard,
  GreetingWidget,
  HomeEmpty,
  HomeRow,
  IndexList,
  PageGlyph,
  PromptWidget,
  QuickActionsWidget,
  RecentWidget,
  SearchWidget,
  StatsWidget,
  TimelineList,
  TimelineWidget,
  modKey,
} from "./widgets";

function ViewHead({ kicker, title, children }: { kicker: string; title: string; children?: React.ReactNode }) {
  const workspace = useAppStore((state) => state.workspace);
  return (
    <header className="home-view-head">
      <div>
        <p className="home-eyebrow">
          <span>{kicker}</span>
          <span className="home-eyebrow-dot" aria-hidden="true" />
          <span>{workspace?.name ?? "Noteral"}</span>
        </p>
        <h1 className="home-display small">{title}</h1>
      </div>
      {children ? <div className="home-view-tools">{children}</div> : null}
    </header>
  );
}

/** Desk: greeting, quick actions, the page you left, and two short lists. */
export function DeskHome() {
  return (
    <div className="home-page home-desk">
      <GreetingWidget />
      <div className="home-desk-grid">
        <ContinueWidget />
        <QuickActionsWidget />
        <RecentWidget />
        <FavoritesWidget />
      </div>
    </div>
  );
}

/** Focus: one question, one button, one way back into your writing. */
export function FocusHome() {
  const now = useMinuteClock();
  const createPage = useAppStore((state) => state.createPage);
  const createItem = useAppStore((state) => state.createItem);
  const selectPage = useAppStore((state) => state.selectPage);
  const { byUpdated } = useHomeData();
  const last = byUpdated[0];
  const prompt = promptOfTheDay(now);
  return (
    <div className="home-page home-focus">
      <p className="home-eyebrow centered">
        <span>{longDate(now)}</span>
      </p>
      <h1 className="home-display focus">{greetingFor(now)}. What are you writing today?</h1>
      <div className="home-focus-actions">
        <button type="button" className="primary-button" onClick={() => void createPage()}>
          <FilePlus2 size={15} /> Start a page
        </button>
        {last ? (
          <button type="button" className="secondary-button" onClick={() => void selectPage(last.id)} title={last.title}>
            <PageGlyph page={last} size={14} />
            <span className="home-focus-last">{last.title || "Untitled"}</span>
            <ArrowRight size={13} aria-hidden="true" />
          </button>
        ) : null}
      </div>
      <figure className="home-focus-prompt">
        <figcaption>Or try today's prompt</figcaption>
        <blockquote>{prompt}</blockquote>
        <button type="button" className="hw-link" onClick={() => void createItem("page", undefined, { title: prompt.replace(/[?.]$/, "") })}>
          Write about it <ArrowRight size={12} aria-hidden="true" />
        </button>
      </figure>
    </div>
  );
}

/** Dashboard: everything measurable on one screen. */
export function DashboardHome() {
  return (
    <div className="home-page home-dashboard">
      <div className="home-dash-top">
        <GreetingWidget />
        <ClockWidget />
      </div>
      <div className="home-dash-grid">
        <StatsWidget />
        <ActivityWidget />
        <RecentWidget title="Recently opened" />
        <TimelineWidget />
        <FavoritesWidget />
        <PromptWidget />
      </div>
    </div>
  );
}

type GalleryFilter = "all" | "pages" | "databases" | "favorites";

/** Gallery: every page as a card with its cover. */
export function GalleryHome() {
  const { byUpdated } = useHomeData();
  const favorites = useAppStore((state) => state.favorites);
  const createPage = useAppStore((state) => state.createPage);
  const [filter, setFilter] = useState<GalleryFilter>("all");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const items = useMemo(() => {
    let list = byUpdated;
    if (filter === "pages") list = list.filter((page) => page.kind !== "database");
    if (filter === "databases") list = list.filter((page) => page.kind === "database");
    if (filter === "favorites") list = list.filter((page) => favorites.includes(page.id));
    if (sort === "title") list = [...list].sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled"));
    return list.slice(0, 120);
  }, [byUpdated, favorites, filter, sort]);
  const filters: { id: GalleryFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "pages", label: "Pages" },
    { id: "databases", label: "Databases" },
    { id: "favorites", label: "Favorites" },
  ];
  return (
    <div className="home-page home-gallery wide">
      <ViewHead kicker="Gallery" title="Your pages, at a glance.">
        <button type="button" className="primary-button" onClick={() => void createPage()}>
          <FilePlus2 size={14} /> New page
        </button>
      </ViewHead>
      <div className="home-toolbar">
        <div className="home-chips" role="radiogroup" aria-label="Show">
          {filters.map((item) => (
            <button key={item.id} type="button" role="radio" aria-checked={filter === item.id} className={`home-chip ${filter === item.id ? "active" : ""}`} onClick={() => setFilter(item.id)}>
              {item.label}
            </button>
          ))}
        </div>
        <label className="home-select">
          <span>Sort</span>
          <select value={sort} onChange={(event) => setSort(event.target.value as "updated" | "title")}>
            <option value="updated">Last edited</option>
            <option value="title">Title</option>
          </select>
        </label>
      </div>
      {items.length ? (
        <div className="home-gallery-grid">{items.map((page) => <GalleryCard key={page.id} page={page} />)}</div>
      ) : (
        <HomeEmpty>{filter === "favorites" ? "No favorites yet. Star a page to see it here." : "Nothing to show yet."}</HomeEmpty>
      )}
    </div>
  );
}

/** Timeline: edits grouped by day. */
export function TimelineHome() {
  const { byUpdated, counts } = useHomeData();
  const [limit, setLimit] = useState(40);
  return (
    <div className="home-page home-timeline-view">
      <ViewHead kicker="Timeline" title="What changed, day by day." />
      <p className="home-summary">
        {counts.today} edited today · {counts.thisWeek} this week · {byUpdated.length} in total
      </p>
      <TimelineList pages={byUpdated} limit={limit} />
      {byUpdated.length > limit ? (
        <button type="button" className="secondary-button home-more" onClick={() => setLimit((value) => value + 40)}>
          Show older
        </button>
      ) : null}
    </div>
  );
}

/** Index: every page, A to Z, with a letter rail. */
export function IndexHome() {
  const { byUpdated, counts } = useHomeData();
  const setOverlay = useAppStore((state) => state.setOverlay);
  const [query, setQuery] = useState("");
  const letters = useMemo(() => groupByLetter(byUpdated).map((group) => group.letter), [byUpdated]);
  return (
    <div className="home-page home-index-view">
      <ViewHead kicker="Index" title="Everything, A to Z.">
        <button type="button" className="secondary-button" onClick={() => setOverlay("library")}>
          <Library size={14} /> Library
        </button>
      </ViewHead>
      <label className="home-search">
        <Search size={15} aria-hidden="true" />
        <input type="search" value={query} placeholder={`Filter ${counts.pages + counts.databases} pages by title`} aria-label="Filter pages by title" onChange={(event) => setQuery(event.target.value)} />
      </label>
      {!query && letters.length > 3 ? (
        <nav className="home-letters" aria-label="Jump to letter">
          {letters.map((letter) => (
            <a key={letter} href={`#home-index-${letter}`} onClick={(event) => {
              event.preventDefault();
              document.getElementById(`home-index-${letter}`)?.scrollIntoView({ block: "start", behavior: "smooth" });
            }}>
              {letter}
            </a>
          ))}
        </nav>
      ) : null}
      <IndexList pages={byUpdated} query={query} />
    </div>
  );
}

function LaunchTile({ page }: { page: PageMeta }) {
  const selectPage = useAppStore((state) => state.selectPage);
  return (
    <button type="button" className="home-tile" onClick={() => void selectPage(page.id)} title={page.title || "Untitled"}>
      <span className="home-tile-icon">
        <PageGlyph page={page} size={20} />
      </span>
      <span className="home-tile-title">{page.title || "Untitled"}</span>
      <span className="home-tile-meta">{relativeTime(page.updatedAt)}</span>
    </button>
  );
}

/** Launchpad: search first, then favorite pages as big tiles. */
export function LaunchpadHome({ active }: { active: boolean }) {
  const now = useMinuteClock();
  const { favorites, recent } = useHomeData();
  const createPage = useAppStore((state) => state.createPage);
  const createItem = useAppStore((state) => state.createItem);
  const tiles = (favorites.length ? favorites : recent).slice(0, 12);
  return (
    <div className="home-page home-launchpad">
      <h1 className="home-display centered">{greetingFor(now)}.</h1>
      <SearchWidget large autoFocus={active} size="l" />
      <div className="home-launch-actions">
        <button type="button" className="home-chip" onClick={() => void createPage()}>
          <FilePlus2 size={13} /> New page
        </button>
        <button type="button" className="home-chip" onClick={() => void createItem("database")}>
          <Database size={13} /> New database
        </button>
        <span className="home-launch-hint">
          <kbd>{modKey} K</kbd> searches inside pages
        </span>
      </div>
      <section className="home-launch-section">
        <h2 className="home-section-title">
          {favorites.length ? (
            <>
              <Star size={12} aria-hidden="true" /> Favorites
            </>
          ) : (
            "Recent"
          )}
        </h2>
        {tiles.length ? <div className="home-tiles">{tiles.map((page) => <LaunchTile key={page.id} page={page} />)}</div> : <HomeEmpty>Pages you star will become tiles here.</HomeEmpty>}
      </section>
      {favorites.length ? (
        <section className="home-launch-section">
          <h2 className="home-section-title">Recent</h2>
          <div className="home-recent-chips">
            {recent.slice(0, 8).map((page) => (
              <HomeChipLink key={page.id} page={page} />
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function HomeChipLink({ page }: { page: PageMeta }) {
  const selectPage = useAppStore((state) => state.selectPage);
  return (
    <button type="button" className="home-chip" onClick={() => void selectPage(page.id)} title={page.title || "Untitled"}>
      <PageGlyph page={page} size={13} />
      <span className="home-chip-label">{page.title || "Untitled"}</span>
    </button>
  );
}

export { HomeRow };

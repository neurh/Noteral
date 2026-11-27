import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { nativeOpen } from "../../lib/nativeOpen";
import { Browser } from "@wailsio/runtime";
import {
  Activity,
  AlignLeft,
  ArrowRight,
  BookOpen,
  Check,
  Code2,
  Coffee,
  FileText,
  Goal,
  CodeXml,
  Heart,
  ImageIcon,
  Link2,
  Mail,
  Minus,
  Music,
  MousePointerClick,
  Repeat,
  BarChart3,
  CalendarDays,
  CalendarRange,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Database,
  FilePlus2,
  Folder,
  FolderOpen,
  Hand,
  History,
  Hourglass,
  Images,
  Library,
  Lightbulb,
  ListChecks,
  ListTree,
  PenLine,
  Pin,
  Plus,
  Search,
  Settings,
  SeparatorHorizontal,
  SquarePen,
  Star,
  StickyNote,
  X,
  Zap,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { PageMeta } from "../../lib/api";
import { coverStyle } from "../../lib/covers";
import { APP_VIEW_PERMISSIONS, ViewFrame } from "../ViewFrame";
import { relativeTime } from "../../lib/format";
import {
  DEFAULT_QUICK_ACTIONS,
  HOME_WIDGET_INFO,
  MAX_NOTE_LENGTH,
  MAX_TODO_ITEMS,
  newWidgetId,
  sizeForWidth,
  type HomeButton,
  type HomeButtonAction,
  type HomeButtonIcon,
  type HomeGoal,
  type HomeHabit,
  type HomeQuickAction,
  type HomeTodoItem,
  type HomeWidget,
  type HomeWidgetSize,
  type HomeWidgetType,
} from "../../lib/home";
import { useAppStore } from "../../store";
import { KindIcon } from "../KindIcon";
import { PageIcon } from "../PageIcon";
import {
  activityGrid,
  greetingFor,
  groupByDay,
  groupByLetter,
  isOpenable,
  longDate,
  promptOfTheDay,
  useHomeData,
  useMinuteClock,
} from "./data";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);
export const modKey = isMac ? "⌘" : "Ctrl";

export const WIDGET_ICONS: Record<HomeWidgetType, LucideIcon> = {
  greeting: Hand,
  clock: Clock3,
  quick: Zap,
  search: Search,
  continue: SquarePen,
  recent: History,
  favorites: Star,
  links: Pin,
  folder: FolderOpen,
  gallery: Images,
  timeline: CalendarRange,
  index: ListTree,
  stats: BarChart3,
  activity: Activity,
  calendar: CalendarDays,
  countdown: Hourglass,
  todo: ListChecks,
  note: StickyNote,
  text: AlignLeft,
  prompt: Lightbulb,
  spacer: SeparatorHorizontal,
  buttons: MousePointerClick,
  image: ImageIcon,
  habits: Repeat,
  progress: Goal,
  html: CodeXml,
};

// ---------------------------------------------------------------------------
// Building blocks

export function PageGlyph({ page, size = 15 }: { page: PageMeta; size?: number }) {
  return (
    <span className="tree-icon" aria-hidden="true">
      <PageIcon value={page.icon} size={size} fallback={<KindIcon page={page} size={size} />} />
    </span>
  );
}

export function HomeRow({ page, meta }: { page: PageMeta; meta?: ReactNode }) {
  const selectPage = useAppStore((state) => state.selectPage);
  return (
    <button type="button" className="home-row" onClick={() => void selectPage(page.id)} title={page.title || "Untitled"}>
      <PageGlyph page={page} />
      <span className="home-row-title">{page.title || "Untitled"}</span>
      <span className="home-row-time">{meta ?? relativeTime(page.updatedAt)}</span>
    </button>
  );
}

export function HomeEmpty({ children }: { children: ReactNode }) {
  return <p className="home-empty">{children}</p>;
}

/** A titled card; every widget sits in one. */
export function WidgetCard({
  title,
  action,
  className = "",
  children,
  bare = false,
}: {
  title?: string;
  action?: ReactNode;
  className?: string;
  children: ReactNode;
  bare?: boolean;
}) {
  return (
    <section className={`hw ${bare ? "hw-bare" : ""} ${className}`}>
      {title || action ? (
        <header className="hw-head">
          {title ? <h2>{title}</h2> : <span />}
          {action}
        </header>
      ) : null}
      {children}
    </section>
  );
}

function limitFor(size: HomeWidgetSize, s: number, m: number, l: number) {
  return size === "s" ? s : size === "m" ? m : l;
}

/** Common props of the widgets the Custom view can configure. */
export interface WidgetProps {
  widget?: HomeWidget;
  size?: HomeWidgetSize;
  /** Header label when the widget has no title override. */
  title?: string;
  /** True while the Custom view is being edited. */
  editing?: boolean;
  onPatch?: (patch: Partial<HomeWidget>) => void;
}

/** The header label for a widget: its override, its default, or nothing if hidden. */
function heading(widget: HomeWidget | undefined, fallback: string): string | undefined {
  if (widget?.hideTitle) return undefined;
  return widget?.title?.trim() || fallback;
}

function pageList(pages: PageMeta[], variant: string | undefined, meta?: (page: PageMeta) => ReactNode) {
  if (variant === "cards" || variant === "tiles") {
    return <div className={variant === "tiles" ? "hw-tiles" : "home-gallery-grid compact"}>{pages.map((page) => (variant === "tiles" ? <PageTile key={page.id} page={page} /> : <GalleryCard key={page.id} page={page} />))}</div>;
  }
  return <div role="list">{pages.map((page) => <HomeRow key={page.id} page={page} meta={meta?.(page)} />)}</div>;
}

function PageTile({ page }: { page: PageMeta }) {
  const selectPage = useAppStore((state) => state.selectPage);
  return (
    <button type="button" className="hw-tile" onClick={() => void selectPage(page.id)} title={page.title || "Untitled"}>
      <span className="hw-tile-icon">
        <PageGlyph page={page} size={18} />
      </span>
      <span className="hw-tile-title">{page.title || "Untitled"}</span>
    </button>
  );
}

const pad2 = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

// ---------------------------------------------------------------------------
// Essentials

export function GreetingWidget({ title, size = "l", widget }: WidgetProps) {
  const now = useMinuteClock();
  const workspace = useAppStore((state) => state.workspace);
  const centered = widget?.variant === "center";
  const headline = widget?.title?.trim() || title?.trim() || `${greetingFor(now)}.`;
  return (
    <WidgetCard bare className={`hw-greeting size-${size} ${centered ? "center" : ""}`}>
      {widget?.hideTitle ? null : (
        <p className={`home-eyebrow ${centered ? "centered" : ""}`}>
          <span>{longDate(now)}</span>
          <span className="home-eyebrow-dot" aria-hidden="true" />
          <span>{workspace?.name ?? "Noteral"}</span>
        </p>
      )}
      <h1 className={`home-display ${centered ? "centered" : ""}`}>{headline}</h1>
      {widget?.text?.trim() ? <p className={`hw-greeting-sub ${centered ? "centered" : ""}`}>{widget.text}</p> : null}
    </WidgetCard>
  );
}

function formatClock(now: Date, hour24: boolean): { time: string; suffix?: string } {
  if (hour24) return { time: `${pad2(now.getHours())}:${pad2(now.getMinutes())}` };
  const h = now.getHours() % 12 || 12;
  return { time: `${h}:${pad2(now.getMinutes())}`, suffix: now.getHours() < 12 ? "AM" : "PM" };
}

function AnalogFace({ now }: { now: Date }) {
  const minute = now.getMinutes();
  const hour = (now.getHours() % 12) + minute / 60;
  return (
    <svg className="hw-analog" viewBox="0 0 100 100" role="img" aria-label={now.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}>
      <circle cx="50" cy="50" r="46" className="hw-analog-face" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const long = i % 3 === 0;
        const r1 = long ? 36 : 39;
        return <line key={i} x1={50 + Math.sin(a) * r1} y1={50 - Math.cos(a) * r1} x2={50 + Math.sin(a) * 42} y2={50 - Math.cos(a) * 42} className={long ? "hw-analog-tick major" : "hw-analog-tick"} />;
      })}
      <line x1="50" y1="50" x2={50 + Math.sin((hour / 12) * Math.PI * 2) * 22} y2={50 - Math.cos((hour / 12) * Math.PI * 2) * 22} className="hw-analog-hour" />
      <line x1="50" y1="50" x2={50 + Math.sin((minute / 60) * Math.PI * 2) * 33} y2={50 - Math.cos((minute / 60) * Math.PI * 2) * 33} className="hw-analog-minute" />
      <circle cx="50" cy="50" r="2.6" className="hw-analog-pin" />
    </svg>
  );
}

export function ClockWidget({ size = "s", widget }: WidgetProps) {
  const now = useMinuteClock();
  const analog = widget?.variant === "analog";
  const { time, suffix } = formatClock(now, widget?.hour24 === true);
  const label = widget?.hideTitle ? undefined : widget?.title?.trim();
  return (
    <WidgetCard title={label} className={`hw-clock size-${size} ${analog ? "analog" : ""}`}>
      {analog ? <AnalogFace now={now} /> : null}
      <div className="hw-clock-copy">
        <div className="hw-clock-time">
          {time}
          {suffix ? <small>{suffix}</small> : null}
        </div>
        <div className="hw-clock-date">{longDate(now)}</div>
      </div>
    </WidgetCard>
  );
}

interface QuickActionDef {
  label: string;
  icon: LucideIcon;
  primary?: boolean;
  hint?: string;
}

export const QUICK_ACTION_INFO: Record<HomeQuickAction, QuickActionDef> = {
  page: { label: "New page", icon: FilePlus2, primary: true },
  database: { label: "New database", icon: Database },
  folder: { label: "New folder", icon: Folder },
  search: { label: "Search", icon: Search, hint: `${modKey} K` },
  library: { label: "Library", icon: Library },
  settings: { label: "Settings", icon: Settings },
};

export function QuickActionsWidget({ size = "m", title = "Start something", widget }: WidgetProps) {
  const createPage = useAppStore((state) => state.createPage);
  const createItem = useAppStore((state) => state.createItem);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const run: Record<HomeQuickAction, () => void> = {
    page: () => void createPage(),
    database: () => void createItem("database"),
    folder: () => void createItem("folder"),
    search: () => setOverlay("palette"),
    library: () => setOverlay("library"),
    settings: () => setOverlay("settings"),
  };
  const actions = widget?.actions ?? DEFAULT_QUICK_ACTIONS;
  return (
    <WidgetCard title={heading(widget, title)} className={`hw-quick size-${size} ${widget?.variant === "list" ? "list" : ""}`}>
      {actions.length ? (
        <div className="hw-quick-grid">
          {actions.map((id) => {
            const { label, icon: Icon, primary, hint } = QUICK_ACTION_INFO[id];
            return (
              <button key={id} type="button" className={`hw-action ${primary ? "primary" : ""}`} onClick={run[id]}>
                <Icon size={15} aria-hidden="true" />
                <span>{label}</span>
                {hint ? <kbd>{hint}</kbd> : null}
              </button>
            );
          })}
        </div>
      ) : (
        <HomeEmpty>Pick actions in this widget's settings.</HomeEmpty>
      )}
    </WidgetCard>
  );
}

export function SearchWidget({ size = "m", autoFocus = false, large = false, widget }: WidgetProps & { autoFocus?: boolean; large?: boolean }) {
  const { byUpdated } = useHomeData();
  const selectPage = useAppStore((state) => state.selectPage);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const [query, setQuery] = useState("");
  const needle = query.trim().toLowerCase();
  const results = useMemo(
    () => (needle ? byUpdated.filter((page) => (page.title || "Untitled").toLowerCase().includes(needle)).slice(0, limitFor(size, 4, 6, 8)) : []),
    [byUpdated, needle, size],
  );
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (autoFocus) inputRef.current?.focus({ preventScroll: true });
  }, [autoFocus]);
  const label = widget?.hideTitle ? undefined : widget?.title?.trim();
  return (
    <WidgetCard title={label} className={`hw-search size-${size} ${large ? "large" : ""}`} bare={large}>
      <label className="home-search">
        <Search size={large ? 18 : 15} aria-hidden="true" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          placeholder="Find a page…"
          aria-label="Find a page by title"
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && results[0]) void selectPage(results[0].id);
            if (event.key === "Escape") setQuery("");
          }}
        />
        <button type="button" className="home-search-kbd" onClick={() => setOverlay("palette")} title="Search inside pages">
          {modKey} K
        </button>
      </label>
      {needle ? (
        <div className="hw-search-results" role="list">
          {results.length ? results.map((page) => <HomeRow key={page.id} page={page} />) : <HomeEmpty>No page titled “{query.trim()}”. Press {modKey} K to search inside pages.</HomeEmpty>}
        </div>
      ) : null}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Pages

export function ContinueWidget({ size = "m", widget }: WidgetProps) {
  const { byUpdated } = useHomeData();
  const selectPage = useAppStore((state) => state.selectPage);
  const createPage = useAppStore((state) => state.createPage);
  const page = byUpdated[0];
  if (!page) {
    return (
      <WidgetCard title={heading(widget, "Continue")} className={`hw-continue size-${size}`}>
        <HomeEmpty>Your last edited page will wait for you here.</HomeEmpty>
        <button type="button" className="primary-button hw-continue-button" onClick={() => void createPage()}>
          <FilePlus2 size={14} /> New page
        </button>
      </WidgetCard>
    );
  }
  const cover = page.cover ? coverStyle(page.cover) : undefined;
  return (
    <WidgetCard className={`hw-continue size-${size}`}>
      <button type="button" className="hw-continue-card" onClick={() => void selectPage(page.id)}>
        <span className={`hw-continue-cover ${cover ? "" : "empty"}`} style={cover} aria-hidden="true" />
        <span className="hw-continue-body">
          <span className="hw-kicker">{widget?.title?.trim() || "Pick up where you left off"}</span>
          <span className="hw-continue-title">
            <PageGlyph page={page} size={17} />
            <span>{page.title || "Untitled"}</span>
          </span>
          <span className="hw-continue-meta">
            Edited {relativeTime(page.updatedAt)}
            <span className="hw-continue-go">
              Continue <ArrowRight size={13} aria-hidden="true" />
            </span>
          </span>
        </span>
      </button>
    </WidgetCard>
  );
}

export function RecentWidget({ size = "m", title = "Recent", widget }: WidgetProps) {
  const { recent } = useHomeData();
  const items = recent.slice(0, widget?.limit ?? limitFor(size, 4, 6, 10));
  return (
    <WidgetCard title={heading(widget, title)} className={`hw-list size-${size}`}>
      {items.length ? pageList(items, widget?.variant) : <HomeEmpty>Pages you open will gather here.</HomeEmpty>}
    </WidgetCard>
  );
}

export function FavoritesWidget({ size = "m", widget }: WidgetProps) {
  const { favorites } = useHomeData();
  const items = favorites.slice(0, widget?.limit ?? limitFor(size, 4, 6, 12));
  return (
    <WidgetCard title={heading(widget, "Favorites")} className={`hw-list size-${size}`}>
      {items.length ? pageList(items, widget?.variant, () => <Star size={11} className="home-star" aria-label="Favorite" />) : <HomeEmpty>Star a page from its menu to keep it one click away.</HomeEmpty>}
    </WidgetCard>
  );
}

export function LinksWidget({ size = "m", widget, editing }: WidgetProps) {
  const pages = useAppStore((state) => state.pages);
  const items = useMemo(() => {
    const byId = new Map(pages.map((page) => [page.id, page]));
    return (widget?.pageIds ?? []).map((id) => byId.get(id)).filter((page): page is PageMeta => Boolean(page && isOpenable(page)));
  }, [pages, widget?.pageIds]);
  return (
    <WidgetCard title={heading(widget, "Pinned")} className={`hw-list hw-links size-${size}`}>
      {items.length ? pageList(items, widget?.variant) : <HomeEmpty>{editing ? "Choose pages in the Widget panel." : "No pinned pages yet. Edit Home to choose some."}</HomeEmpty>}
    </WidgetCard>
  );
}

export function FolderWidget({ size = "m", widget, editing }: WidgetProps) {
  const pages = useAppStore((state) => state.pages);
  const parent = widget?.pageId ? pages.find((page) => page.id === widget.pageId) : undefined;
  const children = useMemo(
    () => (parent ? pages.filter((page) => page.parentId === parent.id).sort((a, b) => a.position - b.position) : []),
    [pages, parent],
  );
  const limit = widget?.limit ?? limitFor(size, 5, 8, 12);
  const openable = children.filter(isOpenable).slice(0, limit);
  const title = heading(widget, parent ? parent.title || "Untitled" : "Folder");
  if (!parent) {
    return (
      <WidgetCard title={title} className={`hw-list hw-folder size-${size}`}>
        <HomeEmpty>{editing ? "Pick a folder in the Widget panel." : "This folder no longer exists."}</HomeEmpty>
      </WidgetCard>
    );
  }
  return (
    <WidgetCard title={title} action={<span className="hw-head-note">{children.length} inside</span>} className={`hw-list hw-folder size-${size}`}>
      {openable.length ? pageList(openable, widget?.variant) : <HomeEmpty>Nothing inside yet.</HomeEmpty>}
    </WidgetCard>
  );
}

export function GalleryCard({ page }: { page: PageMeta }) {
  const selectPage = useAppStore((state) => state.selectPage);
  const favorites = useAppStore((state) => state.favorites);
  const cover = page.cover ? coverStyle(page.cover) : undefined;
  return (
    <button type="button" className="home-card" onClick={() => void selectPage(page.id)} title={page.title || "Untitled"}>
      <span className={`home-card-cover ${cover ? "" : "empty"}`} style={cover} aria-hidden="true">
        {!cover ? <PageIcon value={page.icon} size={22} fallback={<KindIcon page={page} size={22} />} /> : null}
      </span>
      <span className="home-card-body">
        {cover ? (
          <span className="home-card-icon">
            <PageGlyph page={page} size={15} />
          </span>
        ) : null}
        <span className="home-card-title">{page.title || "Untitled"}</span>
        <span className="home-card-meta">
          {favorites.includes(page.id) ? <Star size={10} className="home-star" aria-label="Favorite" /> : null}
          {page.kind === "database" ? "Database · " : ""}
          {relativeTime(page.updatedAt)}
        </span>
      </span>
    </button>
  );
}

export function GalleryWidget({ size = "l", widget }: WidgetProps) {
  const { byUpdated } = useHomeData();
  const items = byUpdated.slice(0, widget?.limit ?? limitFor(size, 2, 4, 8));
  return (
    <WidgetCard title={heading(widget, "Recently edited")} className={`hw-gallery size-${size}`}>
      {items.length ? <div className="home-gallery-grid">{items.map((page) => <GalleryCard key={page.id} page={page} />)}</div> : <HomeEmpty>No pages yet.</HomeEmpty>}
    </WidgetCard>
  );
}

export function TimelineList({ pages, limit }: { pages: PageMeta[]; limit: number }) {
  const now = useMinuteClock();
  const groups = useMemo(() => groupByDay(pages.slice(0, limit), now), [pages, limit, now]);
  if (!groups.length) return <HomeEmpty>Edits will line up here, day by day.</HomeEmpty>;
  return (
    <ol className="home-timeline">
      {groups.map((group) => (
        <li key={group.key} className="home-timeline-day">
          <h3>
            <span className="home-timeline-dot" aria-hidden="true" />
            {group.label}
            <span className="home-timeline-count">{group.pages.length}</span>
          </h3>
          <div role="list">
            {group.pages.map((page) => (
              <HomeRow key={page.id} page={page} meta={new Date(page.updatedAt).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })} />
            ))}
          </div>
        </li>
      ))}
    </ol>
  );
}

export function TimelineWidget({ size = "m", widget }: WidgetProps) {
  const { byUpdated } = useHomeData();
  return (
    <WidgetCard title={heading(widget, "Timeline")} className={`hw-timeline size-${size}`}>
      <TimelineList pages={byUpdated} limit={widget?.limit ?? limitFor(size, 4, 8, 14)} />
    </WidgetCard>
  );
}

export function IndexList({ pages, query = "" }: { pages: PageMeta[]; query?: string }) {
  const needle = query.trim().toLowerCase();
  const groups = useMemo(() => groupByLetter(needle ? pages.filter((page) => (page.title || "Untitled").toLowerCase().includes(needle)) : pages), [pages, needle]);
  if (!groups.length) return <HomeEmpty>{needle ? `No page titled “${query.trim()}”.` : "No pages yet."}</HomeEmpty>;
  return (
    <div className="home-index">
      {groups.map((group) => (
        <section key={group.letter} className="home-index-group" id={`home-index-${group.letter}`}>
          <h3>{group.letter}</h3>
          <div role="list">{group.pages.map((page) => <HomeRow key={page.id} page={page} />)}</div>
        </section>
      ))}
    </div>
  );
}

export function IndexWidget({ size = "l", widget }: WidgetProps) {
  const { byUpdated } = useHomeData();
  const setOverlay = useAppStore((state) => state.setOverlay);
  const [query, setQuery] = useState("");
  return (
    <WidgetCard
      title={heading(widget, "All pages")}
      action={
        <button type="button" className="hw-link" onClick={() => setOverlay("library")}>
          <Library size={13} aria-hidden="true" /> Library
        </button>
      }
      className={`hw-index size-${size}`}
    >
      <label className="home-search compact">
        <Search size={14} aria-hidden="true" />
        <input type="search" value={query} placeholder="Filter by title" aria-label="Filter pages by title" onChange={(event) => setQuery(event.target.value)} />
      </label>
      <div className="hw-index-scroll">
        <IndexList pages={byUpdated} query={query} />
      </div>
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Insights

export function StatsWidget({ size = "m", widget }: WidgetProps) {
  const { counts } = useHomeData();
  const stats = [
    { label: "Pages", value: counts.pages },
    { label: "Databases", value: counts.databases },
    { label: "Edited this week", value: counts.thisWeek },
    ...(size === "l" ? [{ label: "Edited today", value: counts.today }] : []),
  ];
  return (
    <WidgetCard title={heading(widget, "At a glance")} className={`hw-stats size-${size}`}>
      <dl className="hw-stats-grid" style={{ gridTemplateColumns: `repeat(${stats.length}, minmax(0, 1fr))` }}>
        {stats.map((stat) => (
          <div key={stat.label}>
            <dd>{stat.value}</dd>
            <dt>{stat.label}</dt>
          </div>
        ))}
      </dl>
    </WidgetCard>
  );
}

export function ActivityWidget({ size = "m", widget }: WidgetProps) {
  const { pages } = useHomeData();
  const now = useMinuteClock();
  const fallbackWeeks = size === "s" ? 8 : size === "m" ? 14 : 26;
  const heatRef = useRef<HTMLDivElement>(null);
  const [fitWeeks, setFitWeeks] = useState(0);
  useEffect(() => {
    const node = heatRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;
    // Columns of ~15px cells with 3px gaps; whole weeks only, so the grid never stretches cells.
    const measure = (width: number) => setFitWeeks(Math.max(6, Math.min(52, Math.floor((width + 3) / 18))));
    const observer = new ResizeObserver((entries) => measure(entries[0]?.contentRect.width ?? 0));
    observer.observe(node);
    measure(node.clientWidth);
    return () => observer.disconnect();
  }, []);
  const weeks = fitWeeks || fallbackWeeks;
  const grid = useMemo(() => activityGrid(pages, weeks, now), [pages, weeks, now]);
  const max = Math.max(1, ...grid.flat().map((day) => day.count));
  const total = grid.flat().reduce((sum, day) => sum + Math.max(0, day.count), 0);
  return (
    <WidgetCard title={heading(widget, "Activity")} action={<span className="hw-head-note">{total} edits · {weeks} weeks</span>} className={`hw-activity size-${size}`}>
      <div ref={heatRef} className="hw-heatmap" style={{ gridTemplateColumns: `repeat(${weeks}, minmax(0, 1fr))` }} role="img" aria-label={`${total} page edits and creations in the last ${weeks} weeks`}>
        {grid.map((column, w) => (
          <div key={w} className="hw-heat-col">
            {column.map((day) => {
              const level = day.count < 0 ? -1 : day.count === 0 ? 0 : Math.ceil((day.count / max) * 4);
              return <span key={day.date.getTime()} className="hw-heat" data-level={level} title={day.count >= 0 ? `${day.date.toLocaleDateString()}: ${day.count}` : undefined} />;
            })}
          </div>
        ))}
      </div>
      <div className="hw-heat-legend" aria-hidden="true">
        <span>Less</span>
        {[0, 1, 2, 3, 4].map((level) => (
          <span key={level} className="hw-heat" data-level={level} />
        ))}
        <span>More</span>
      </div>
    </WidgetCard>
  );
}

const WEEKDAYS = Array.from({ length: 7 }, (_, i) => new Date(2024, 0, 7 + i).toLocaleDateString(undefined, { weekday: "narrow" }));

export function CalendarWidget({ size = "s", widget }: WidgetProps) {
  const now = useMinuteClock();
  const { pages } = useHomeData();
  const [offset, setOffset] = useState(0);
  const month = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  const edited = useMemo(() => {
    const set = new Set<string>();
    for (const page of pages) {
      for (const stamp of [page.updatedAt, page.createdAt]) {
        const d = new Date(stamp);
        if (!Number.isNaN(d.getTime())) set.add(dateKey(d));
      }
    }
    return set;
  }, [pages]);
  const today = dateKey(now);
  const days: (Date | null)[] = [];
  for (let i = 0; i < month.getDay(); i++) days.push(null);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  for (let d = 1; d <= count; d++) days.push(new Date(month.getFullYear(), month.getMonth(), d));
  const label = month.toLocaleDateString(undefined, { month: "long", year: month.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  return (
    <WidgetCard
      title={heading(widget, label)}
      action={
        <span className="hw-cal-nav">
          <button type="button" onClick={() => setOffset((v) => v - 1)} aria-label="Previous month">
            <ChevronLeft size={14} />
          </button>
          {offset !== 0 ? (
            <button type="button" className="hw-cal-today" onClick={() => setOffset(0)}>
              Today
            </button>
          ) : null}
          <button type="button" onClick={() => setOffset((v) => v + 1)} aria-label="Next month">
            <ChevronRight size={14} />
          </button>
        </span>
      }
      className={`hw-calendar size-${size}`}
    >
      {widget?.hideTitle ? <div className="hw-cal-month">{label}</div> : null}
      <div className="hw-cal-grid" role="grid" aria-label={label}>
        {WEEKDAYS.map((day, i) => (
          <span key={`h${i}`} className="hw-cal-head" aria-hidden="true">
            {day}
          </span>
        ))}
        {days.map((date, i) => {
          if (!date) return <span key={`e${i}`} />;
          const key = dateKey(date);
          const classes = ["hw-cal-day", key === today ? "today" : "", edited.has(key) ? "edited" : "", date > now ? "future" : ""].join(" ");
          return (
            <span key={key} className={classes} role="gridcell" title={edited.has(key) ? `${date.toLocaleDateString()}: you wrote` : undefined}>
              {date.getDate()}
            </span>
          );
        })}
      </div>
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Personal

export function CountdownWidget({ size = "s", widget, editing }: WidgetProps) {
  const now = useMinuteClock();
  const title = heading(widget, "Countdown");
  if (!widget?.date) {
    return (
      <WidgetCard title={title} className={`hw-countdown size-${size}`}>
        <HomeEmpty>{editing ? "Pick a date in the Widget panel." : "No date yet — choose one with Edit."}</HomeEmpty>
      </WidgetCard>
    );
  }
  const [y, m, d] = widget.date.split("-").map(Number);
  const target = new Date(y, m - 1, d);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const days = Math.round((target.getTime() - start.getTime()) / 86400000);
  const when = target.toLocaleDateString(undefined, { weekday: "short", month: "long", day: "numeric", year: target.getFullYear() === now.getFullYear() ? undefined : "numeric" });
  return (
    <WidgetCard title={title} className={`hw-countdown size-${size}`}>
      <div className="hw-count-number">{days === 0 ? "Today" : Math.abs(days)}</div>
      <div className="hw-count-label">{days === 0 ? when : `${Math.abs(days) === 1 ? "day" : "days"} ${days > 0 ? "to go" : "ago"} · ${when}`}</div>
    </WidgetCard>
  );
}

export function TodoWidget({ size = "s", widget, onPatch }: WidgetProps) {
  const items = widget?.items ?? [];
  const [draft, setDraft] = useState("");
  const done = items.filter((item) => item.done).length;
  const save = (next: HomeTodoItem[]) => onPatch?.({ items: next });
  const add = () => {
    const text = draft.trim();
    if (!text || items.length >= MAX_TODO_ITEMS) return;
    save([...items, { id: newWidgetId(), text: text.slice(0, 200), done: false }]);
    setDraft("");
  };
  return (
    <WidgetCard title={heading(widget, "Checklist")} action={items.length ? <span className="hw-head-note">{done}/{items.length}</span> : undefined} className={`hw-todo size-${size}`}>
      {items.length ? (
        <div className="hw-todo-bar" aria-hidden="true">
          <span style={{ width: `${(done / items.length) * 100}%` }} />
        </div>
      ) : null}
      <ul className="hw-todo-list">
        {items.map((item) => (
          <li key={item.id} className={item.done ? "done" : ""}>
            <label>
              <input type="checkbox" checked={item.done} onChange={() => save(items.map((it) => (it.id === item.id ? { ...it, done: !it.done } : it)))} />
              <span>{item.text}</span>
            </label>
            <button type="button" className="hw-todo-remove" onClick={() => save(items.filter((it) => it.id !== item.id))} aria-label={`Remove “${item.text}”`}>
              <X size={12} />
            </button>
          </li>
        ))}
      </ul>
      {items.length < MAX_TODO_ITEMS ? (
        <form
          className="hw-todo-add"
          onSubmit={(event) => {
            event.preventDefault();
            add();
          }}
        >
          <Plus size={13} aria-hidden="true" />
          <input type="text" value={draft} maxLength={200} placeholder="Add a task" aria-label="Add a task" onChange={(event) => setDraft(event.target.value)} />
        </form>
      ) : null}
    </WidgetCard>
  );
}

/** A text box that saves 400ms after typing stops, and on unmount. */
function useDebouncedText(value: string | undefined, onSave: ((text: string) => void) | undefined) {
  const [text, setText] = useState(value ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(text);
  const saveRef = useRef(onSave);
  latest.current = text;
  saveRef.current = onSave;
  useEffect(() => {
    if (timer.current) return;
    setText(value ?? "");
  }, [value]);
  useEffect(
    () => () => {
      if (timer.current) {
        clearTimeout(timer.current);
        saveRef.current?.(latest.current);
      }
    },
    [],
  );
  const change = (next: string) => {
    setText(next);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      saveRef.current?.(next);
    }, 400);
  };
  return [text, change] as const;
}

export function NoteWidget({ widget, size = "s", onPatch }: WidgetProps) {
  const [text, setText] = useDebouncedText(widget?.text, onPatch ? (next) => onPatch({ text: next }) : undefined);
  return (
    <WidgetCard title={heading(widget, "Sticky note")} className={`hw-note size-${size}`}>
      <textarea value={text} maxLength={MAX_NOTE_LENGTH} placeholder="Jot something down. It stays on this Home." aria-label="Sticky note" onChange={(event) => setText(event.target.value)} />
    </WidgetCard>
  );
}

export function TextWidget({ widget, editing, onPatch }: WidgetProps) {
  const variant = widget?.variant ?? "heading";
  const [text, setText] = useDebouncedText(widget?.text, onPatch ? (next) => onPatch({ text: next }) : undefined);
  const placeholder = { heading: "A heading", paragraph: "Write a few lines…", quote: "A line worth keeping", callout: "Something to remember" }[variant] ?? "Write something…";
  if (editing) {
    return (
      <WidgetCard bare={variant !== "callout"} className={`hw-text v-${variant}`}>
        <textarea className="hw-text-input" rows={variant === "heading" ? 1 : 3} value={text} maxLength={MAX_NOTE_LENGTH} placeholder={placeholder} aria-label="Text" onChange={(event) => setText(event.target.value)} />
      </WidgetCard>
    );
  }
  if (!text.trim()) return null;
  return (
    <WidgetCard bare={variant !== "callout"} className={`hw-text v-${variant}`}>
      {variant === "heading" ? <h2 className="hw-text-body">{text}</h2> : variant === "quote" ? <blockquote className="hw-text-body">{text}</blockquote> : <p className="hw-text-body">{text}</p>}
    </WidgetCard>
  );
}

export function PromptWidget({ size = "s", widget }: WidgetProps) {
  const now = useMinuteClock();
  const createItem = useAppStore((state) => state.createItem);
  const prompt = promptOfTheDay(now);
  return (
    <WidgetCard title={heading(widget, "Today's prompt")} className={`hw-prompt size-${size}`}>
      <blockquote>{prompt}</blockquote>
      <button type="button" className="hw-link" onClick={() => void createItem("page", undefined, { title: prompt.replace(/[?.]$/, "") })}>
        <PenLine size={13} aria-hidden="true" /> Write about it
      </button>
    </WidgetCard>
  );
}

export function SpacerWidget({ widget }: WidgetProps) {
  return <div className={`hw-spacer ${widget?.variant === "line" ? "line" : ""}`} aria-hidden="true" />;
}

// ---------------------------------------------------------------------------
// Buttons

export const BUTTON_ICONS: Record<HomeButtonIcon, LucideIcon> = {
  arrow: ArrowRight,
  file: FileText,
  database: Database,
  folder: Folder,
  search: Search,
  book: BookOpen,
  settings: Settings,
  link: Link2,
  star: Star,
  heart: Heart,
  bolt: Zap,
  calendar: CalendarDays,
  mail: Mail,
  music: Music,
  code: Code2,
  coffee: Coffee,
};

export const BUTTON_ACTION_LABELS: Record<HomeButtonAction, string> = {
  page: "Open a page",
  url: "Open a link",
  "new-page": "New page",
  "new-database": "New database",
  "new-folder": "New folder",
  search: "Search",
  library: "Library",
  settings: "Settings",
};

export function openExternal(url: string) {
  try {
    void Browser.OpenURL(url).catch(() => nativeOpen(url, "_blank", "noopener,noreferrer"));
  } catch {
    nativeOpen(url, "_blank", "noopener,noreferrer");
  }
}

/** What a button reads as when it has no label of its own. */
export function buttonLabel(button: HomeButton, pages: PageMeta[]): string {
  if (button.label.trim()) return button.label.trim();
  if (button.action === "page") return pages.find((page) => page.id === button.target)?.title || "Open page";
  if (button.action === "url" && button.target) {
    try {
      return new URL(button.target, "https://x.invalid").hostname.replace(/^www\./, "") || "Open link";
    } catch {
      return "Open link";
    }
  }
  return BUTTON_ACTION_LABELS[button.action];
}

export function ButtonsWidget({ widget, editing }: WidgetProps) {
  const pages = useAppStore((state) => state.pages);
  const selectPage = useAppStore((state) => state.selectPage);
  const createPage = useAppStore((state) => state.createPage);
  const createItem = useAppStore((state) => state.createItem);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const buttons = widget?.buttons ?? [];
  const variant = widget?.variant ?? "solid";
  const run = (button: HomeButton) => {
    if (editing) return;
    switch (button.action) {
      case "page":
        if (button.target && pages.some((page) => page.id === button.target)) void selectPage(button.target);
        break;
      case "url":
        if (button.target) openExternal(button.target);
        break;
      case "new-page":
        void createPage();
        break;
      case "new-database":
        void createItem("database");
        break;
      case "new-folder":
        void createItem("folder");
        break;
      case "search":
        setOverlay("palette");
        break;
      default:
        setOverlay(button.action);
    }
  };
  const missing = (button: HomeButton) =>
    (button.action === "page" && !pages.some((page) => page.id === button.target)) || (button.action === "url" && !button.target);
  return (
    <WidgetCard title={widget?.hideTitle || !widget?.title ? undefined : widget.title} className={`hw-buttons v-${variant}`}>
      {buttons.length ? (
        <div className="hw-button-row">
          {buttons.map((button) => {
            const Icon = BUTTON_ICONS[button.icon];
            const broken = missing(button);
            return (
              <button
                key={button.id}
                type="button"
                className={`hw-button ${broken ? "broken" : ""}`}
                style={button.color ? ({ "--hb-color": button.color } as CSSProperties) : undefined}
                onClick={() => run(button)}
                disabled={broken && !editing}
                title={broken ? (button.action === "page" ? "That page no longer exists" : "Add a link in this widget's settings") : button.action === "url" ? button.target : undefined}
              >
                <span className="hw-button-icon">
                  <Icon size={variant === "tile" ? 18 : 15} aria-hidden="true" />
                </span>
                <span className="hw-button-label">{buttonLabel(button, pages)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <HomeEmpty>Add buttons in this widget's settings.</HomeEmpty>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Image

export function ImageWidget({ widget }: WidgetProps) {
  const [failed, setFailed] = useState(false);
  const url = widget?.url;
  useEffect(() => setFailed(false), [url]);
  const fit = widget?.variant === "contain" ? "contain" : "cover";
  return (
    <WidgetCard bare className={`hw-image fit-${fit}`}>
      {url && !failed ? (
        <img src={url} alt={widget?.text ?? ""} loading="lazy" draggable={false} onError={() => setFailed(true)} />
      ) : (
        <div className="hw-image-empty">
          <ImageIcon size={22} aria-hidden="true" />
          <span>{failed ? "This image didn't load." : "Paste an image link in this widget's settings."}</span>
        </div>
      )}
      {widget?.text ? <figcaption className="hw-image-caption">{widget.text}</figcaption> : null}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Habits

function lastDays(count: number): { key: string; label: string; today: boolean }[] {
  const out: { key: string; label: string; today: boolean }[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    out.push({ key: dateKey(day), label: day.toLocaleDateString(undefined, { weekday: "narrow" }), today: i === 0 });
  }
  return out;
}

function streakOf(habit: HomeHabit): number {
  const done = new Set(habit.days);
  const now = new Date();
  let streak = 0;
  // A streak still counts when today isn't ticked yet.
  for (let i = done.has(dateKey(now)) ? 0 : 1; i < 400; i++) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (!done.has(dateKey(day))) break;
    streak++;
  }
  return streak;
}

export function HabitsWidget({ widget, onPatch, size = "m" }: WidgetProps) {
  const habits = widget?.habits ?? [];
  const days = useMemo(() => lastDays(size === "s" ? 5 : 7), [size]);
  const toggle = (habit: HomeHabit, key: string) => {
    const has = habit.days.includes(key);
    const next = has ? habit.days.filter((d) => d !== key) : [key, ...habit.days].sort().reverse().slice(0, 42);
    onPatch?.({ habits: habits.map((h) => (h.id === habit.id ? { ...h, days: next } : h)) });
  };
  const todayKey = days[days.length - 1].key;
  const doneToday = habits.filter((h) => h.days.includes(todayKey)).length;
  return (
    <WidgetCard
      title={heading(widget, "Habits")}
      action={habits.length ? <span className="hw-head-note">{doneToday}/{habits.length} today</span> : undefined}
      className={`hw-habits size-${size}`}
    >
      {habits.length ? (
        <table className="hw-habit-table">
          <thead>
            <tr>
              <th scope="col">
                <span className="hw-sr">Habit</span>
              </th>
              {days.map((day) => (
                <th key={day.key} scope="col" className={day.today ? "today" : ""}>
                  {day.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {habits.map((habit) => {
              const streak = streakOf(habit);
              return (
                <tr key={habit.id}>
                  <th scope="row">
                    <span className="hw-habit-name">{habit.text || "Untitled habit"}</span>
                    {streak > 1 ? <span className="hw-habit-streak">{streak} day streak</span> : null}
                  </th>
                  {days.map((day) => {
                    const on = habit.days.includes(day.key);
                    return (
                      <td key={day.key}>
                        <button
                          type="button"
                          className={`hw-habit-dot ${on ? "on" : ""} ${day.today ? "today" : ""}`}
                          aria-pressed={on}
                          aria-label={`${habit.text || "Habit"}, ${day.key}${on ? ", done" : ""}`}
                          onClick={() => toggle(habit, day.key)}
                        >
                          {on ? <Check size={11} strokeWidth={3} aria-hidden="true" /> : null}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <HomeEmpty>Add habits in this widget's settings.</HomeEmpty>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Goals

function GoalRing({ ratio }: { ratio: number }) {
  const r = 19;
  const c = 2 * Math.PI * r;
  return (
    <svg className="hw-goal-ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r={r} className="track" />
      <circle cx="24" cy="24" r={r} className="value" strokeDasharray={c} strokeDashoffset={c * (1 - ratio)} />
    </svg>
  );
}

export function GoalsWidget({ widget, onPatch, size = "s" }: WidgetProps) {
  const goals = widget?.goals ?? [];
  const ring = widget?.variant === "ring";
  const step = (goal: HomeGoal, delta: number) =>
    onPatch?.({ goals: goals.map((g) => (g.id === goal.id ? { ...g, value: Math.max(0, Math.min(g.max, g.value + delta)) } : g)) });
  return (
    <WidgetCard title={heading(widget, "Goals")} className={`hw-goals ${ring ? "rings" : "bars"} size-${size}`}>
      {goals.length ? (
        <ul className="hw-goal-list">
          {goals.map((goal) => {
            const ratio = goal.max ? goal.value / goal.max : 0;
            const done = goal.value >= goal.max;
            return (
              <li key={goal.id} className={done ? "done" : ""}>
                {ring ? (
                  <span className="hw-goal-ring-wrap">
                    <GoalRing ratio={ratio} />
                    <span className="hw-goal-pct">{Math.round(ratio * 100)}%</span>
                  </span>
                ) : null}
                <div className="hw-goal-copy">
                  <div className="hw-goal-line">
                    <span className="hw-goal-name">{goal.text || "Untitled goal"}</span>
                    <span className="hw-goal-count">
                      {goal.value}/{goal.max}
                    </span>
                  </div>
                  {!ring ? (
                    <div className="hw-goal-bar" aria-hidden="true">
                      <span style={{ width: `${ratio * 100}%` }} />
                    </div>
                  ) : null}
                </div>
                <div className="hw-goal-steps">
                  <button type="button" className="hw-goal-step" onClick={() => step(goal, -1)} disabled={goal.value <= 0} aria-label={`Less ${goal.text}`}>
                    <Minus size={12} />
                  </button>
                  <button type="button" className="hw-goal-step" onClick={() => step(goal, 1)} disabled={done} aria-label={`More ${goal.text}`}>
                    <Plus size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <HomeEmpty>Add goals in this widget's settings.</HomeEmpty>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------
// Custom HTML

const HOME_VIEW_OWNER = { kind: "app" as const, id: "home", name: "Home" };

export function HtmlWidget({ widget, editing = false, onPatch }: WidgetProps) {
  const props = useMemo(() => ({ data: widget?.data ?? null, widgetId: widget?.id ?? "", editing }), [widget?.data, widget?.id, editing]);
  if (!widget) return null;
  const title = widget.title?.trim();
  return (
    <WidgetCard bare={!title || widget.hideTitle} title={widget.hideTitle ? undefined : title} className="hw-html">
      {widget.html ? (
        <ViewFrame
          surface="home"
          viewKey={`app:home:${widget.id}`}
          html={widget.html}
          owner={HOME_VIEW_OWNER}
          permissions={APP_VIEW_PERMISSIONS}
          props={props}
          fill
          onData={onPatch ? (data) => onPatch({ data }) : undefined}
          className="hw-html-frame"
          title={title || "Custom HTML widget"}
        />
      ) : (
        <HomeEmpty>Add HTML in this widget's settings, or ask the assistant to build one.</HomeEmpty>
      )}
    </WidgetCard>
  );
}

// ---------------------------------------------------------------------------

export interface RenderContext {
  /** Layout-level greeting headline. */
  layoutTitle?: string;
  editing: boolean;
  onPatch: (patch: Partial<HomeWidget>) => void;
}

export function renderWidget(widget: HomeWidget, ctx: RenderContext): ReactNode {
  const props: WidgetProps = { widget, size: sizeForWidth(widget.w), editing: ctx.editing, onPatch: ctx.onPatch };
  switch (widget.type) {
    case "greeting":
      return <GreetingWidget {...props} title={ctx.layoutTitle} />;
    case "clock":
      return <ClockWidget {...props} />;
    case "quick":
      return <QuickActionsWidget {...props} />;
    case "search":
      return <SearchWidget {...props} />;
    case "continue":
      return <ContinueWidget {...props} />;
    case "recent":
      return <RecentWidget {...props} />;
    case "favorites":
      return <FavoritesWidget {...props} />;
    case "links":
      return <LinksWidget {...props} />;
    case "folder":
      return <FolderWidget {...props} />;
    case "gallery":
      return <GalleryWidget {...props} />;
    case "timeline":
      return <TimelineWidget {...props} />;
    case "index":
      return <IndexWidget {...props} />;
    case "stats":
      return <StatsWidget {...props} />;
    case "activity":
      return <ActivityWidget {...props} />;
    case "calendar":
      return <CalendarWidget {...props} />;
    case "countdown":
      return <CountdownWidget {...props} />;
    case "todo":
      return <TodoWidget {...props} />;
    case "note":
      return <NoteWidget {...props} />;
    case "text":
      return <TextWidget {...props} />;
    case "prompt":
      return <PromptWidget {...props} />;
    case "spacer":
      return <SpacerWidget {...props} />;
    case "buttons":
      return <ButtonsWidget {...props} />;
    case "image":
      return <ImageWidget {...props} />;
    case "habits":
      return <HabitsWidget {...props} />;
    case "progress":
      return <GoalsWidget {...props} />;
    case "html":
      return <HtmlWidget {...props} />;
  }
}

/** Widgets whose content stays interactive while the layout is being edited. */
export const LIVE_WHILE_EDITING: ReadonlySet<HomeWidgetType> = new Set(["note", "todo", "text", "habits", "progress"]);

/** The label a widget shows in the editor. */
export function widgetLabel(widget: HomeWidget): string {
  return widget.title?.trim() || HOME_WIDGET_INFO[widget.type].label;
}

export { HOME_WIDGET_INFO };

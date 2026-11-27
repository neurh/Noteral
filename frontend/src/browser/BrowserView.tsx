import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Check,
  Clock,
  Ellipsis,
  FileText,
  Globe,
  History,
  House,
  Lock,
  LockOpen,
  RotateCw,
  Scissors,
  Search,
  Settings2,
  Star,
  X,
} from "lucide-react";
import { openExternal } from "../components/home/widgets";
import { PagePickerDialog } from "../components/PagePickerDialog";
import { PageIcon } from "../components/PageIcon";
import { openSettings } from "../components/SettingsDialog";
import { Markdown } from "../lib/markdownView";
import { popups, type PopupMenuItem } from "../lib/popups";
import { errorMessage } from "../lib/api";
import { useAppStore } from "../store";
import { CLIP_FOLDER_TITLE, clipToNewPage, clipToPage, fragmentMarkdown, selectionMarkdown, type ClipInput } from "./clip";
import {
  READER_SIZES,
  canGo,
  cleanLocation,
  currentLocation,
  frameSource,
  hostOf,
  inputSearches,
  isBookmarked,
  isDirectFrame,
  isWebLocation,
  resolveInput,
  searchEngine,
  searchQueryOf,
  searchUrl,
  suggest,
  titleForLocation,
} from "./model";
import { useBrowserStore, type FrameMessage } from "./store";
import { Favicon } from "./WebTabIcon";

interface BrowserViewProps {
  tabId: string;
  active: boolean;
}

type Picker = { kind: "append"; input: ClipInput } | { kind: "folder"; input: ClipInput } | null;

/** Pages through the app run sandboxed in an opaque origin; sites loaded directly keep their own. */
const FRAME_SANDBOX = "allow-scripts allow-forms allow-popups allow-popups-to-escape-sandbox allow-modals allow-downloads";
const DIRECT_SANDBOX = `${FRAME_SANDBOX} allow-same-origin`;

type BridgeMessage =
  | FrameMessage
  | { type: "navigate"; url: string; newTab?: boolean; background?: boolean; external?: boolean; replace?: boolean }
  | { type: "key"; key: string; ctrl?: boolean; meta?: boolean; alt?: boolean; shift?: boolean }
  | { type: "selection"; id: number; text?: string; html?: string };

let selectionRequests = 0;

/** Selected markup from a page frame, reduced to plain structure before it touches the app's document. */
function selectionFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, "text/html");
  doc.querySelectorAll("script, style, link, meta, iframe, object, embed, template, noscript, svg, canvas, video, audio, form, input, button, select, textarea").forEach((node) => node.remove());
  doc.querySelectorAll("*").forEach((node) => {
    for (const attr of Array.from(node.attributes)) {
      const keep = attr.name === "href" || attr.name === "src" || attr.name === "alt";
      if (!keep || /^\s*(javascript|data|vbscript):/i.test(attr.value)) node.removeAttribute(attr.name);
    }
  });
  return fragmentMarkdown(doc.body);
}

/** One browser tab: toolbar, then the home page, the live page or its Reader copy. */
export function BrowserView({ tabId, active }: BrowserViewProps) {
  const tab = useBrowserStore((state) => state.data.tabs[tabId]);
  const view = useBrowserStore((state) => state.views[tabId]);
  const prefs = useBrowserStore((state) => state.data.prefs);
  const bookmarks = useBrowserStore((state) => state.data.bookmarks);
  const browser = useBrowserStore.getState;
  const location = tab ? currentLocation(tab) : "";
  const mode = tab?.mode ?? prefs.defaultMode;
  const addressRef = useRef<HTMLInputElement | null>(null);
  const readerRef = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const selectionWaiters = useRef(new Map<number, (value: { text: string; html: string }) => void>());
  const [notice, setNotice] = useState<{ text: string; pageId?: string; error?: boolean; busy?: boolean } | null>(null);
  const [picker, setPicker] = useState<Picker>(null);

  useEffect(() => {
    if (active) browser().ensureLoaded(tabId);
  }, [active, browser, location, tabId]);

  useEffect(() => {
    if (!notice || notice.busy) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 8000 : 6000);
    return () => clearTimeout(timer);
  }, [notice]);

  const focusAddress = useCallback(() => {
    addressRef.current?.focus();
    addressRef.current?.select();
  }, []);

  // Browser keys while this tab is on screen.
  useEffect(() => {
    if (!active) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      const key = event.key.toLowerCase();
      if ((mod && key === "l" && !event.shiftKey && !event.altKey) || event.key === "F6") {
        event.preventDefault();
        focusAddress();
      } else if ((mod && key === "r" && !event.altKey) || event.key === "F5") {
        event.preventDefault();
        browser().reload(tabId);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [active, browser, focusAddress, tabId]);

  // Messages from the bridge inside this tab's page frame.
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const data = event.data as (BridgeMessage & { source?: string }) | null;
      if (!data || data.source !== "noteral-browse" || typeof data.type !== "string") return;
      const state = browser();
      switch (data.type) {
        case "navigate": {
          if (typeof data.url !== "string" || !/^https?:/i.test(data.url)) return;
          if (data.external) openExternal(data.url);
          else if (data.newTab) state.open(data.url, { background: Boolean(data.background) });
          else state.navigate(tabId, data.url, { replace: Boolean(data.replace) });
          return;
        }
        case "key": {
          // Replay it on the app, so app and browser shortcuts work while the page has focus.
          window.dispatchEvent(new KeyboardEvent("keydown", { key: data.key, ctrlKey: Boolean(data.ctrl), metaKey: Boolean(data.meta), altKey: Boolean(data.alt), shiftKey: Boolean(data.shift), bubbles: true, cancelable: true }));
          return;
        }
        case "selection": {
          const resolve = selectionWaiters.current.get(data.id);
          selectionWaiters.current.delete(data.id);
          resolve?.({ text: String(data.text ?? ""), html: String(data.html ?? "") });
          return;
        }
        default:
          state.frameMessage(tabId, data);
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [browser, tabId]);

  const isWeb = isWebLocation(location);
  const current = view?.location === location ? view : undefined;
  const reader = current?.reader?.location === location ? current.reader : undefined;
  const frameSrc = current?.frameSrc && isWebLocation(current.frameSrc) ? current.frameSrc : "";
  const direct = isDirectFrame(frameSrc);
  const showReader = isWeb && mode === "reader";
  const loading = Boolean(current?.loading && !showReader) || (showReader && reader?.status === "loading");
  const bookmarked = isWeb && isBookmarked({ ...browser().data, bookmarks }, location);
  const title = (showReader ? reader?.page?.title : undefined) || tab?.title || titleForLocation(location);
  const engine = searchEngine(prefs);

  const go = useCallback((target: string, options: { newTab?: boolean } = {}) => {
    if (options.newTab) browser().open(target, { background: true });
    else browser().navigate(tabId, target);
  }, [browser, tabId]);

  /** What is selected in the page frame, as Markdown. Sites loaded directly can't be asked. */
  const frameSelection = (): Promise<string> => {
    const target = frameRef.current?.contentWindow;
    if (!target || direct) return Promise.resolve("");
    const id = ++selectionRequests;
    return new Promise<string>((resolve) => {
      const timer = setTimeout(() => {
        selectionWaiters.current.delete(id);
        resolve("");
      }, 600);
      selectionWaiters.current.set(id, (value) => {
        clearTimeout(timer);
        resolve(value.html ? selectionFromHtml(value.html) : value.text.trim());
      });
      target.postMessage({ type: "noteral-selection", id }, "*");
    });
  };

  const runClip = async (make: () => Promise<ClipInput | null>, target: { pageId?: string; parentId?: string } = {}) => {
    setNotice({ text: "Clipping…", busy: true });
    try {
      const input = await make();
      if (!input) {
        setNotice({ text: "There's no readable text on this page to clip. Try Link only.", error: true });
        return;
      }
      if (target.pageId) {
        await clipToPage(target.pageId, input);
        const name = useAppStore.getState().pages.find((item) => item.id === target.pageId)?.title || "Untitled";
        setNotice({ text: `Added to ${name}`, pageId: target.pageId });
      } else {
        const pageId = await clipToNewPage(input, { parentId: target.parentId });
        const pages = useAppStore.getState().pages;
        const folder = pages.find((item) => item.id === pages.find((p) => p.id === pageId)?.parentId);
        setNotice({ text: `Saved to ${folder?.title || CLIP_FOLDER_TITLE}`, pageId });
      }
    } catch (error) {
      setNotice({ text: errorMessage(error), error: true });
    }
  };

  const article = async (): Promise<ClipInput | null> => {
    const page = await browser().readerPage(tabId);
    if (!page || !page.readable || !page.text.trim()) return null;
    return { kind: "article", url: location, title: page.title || title, description: page.description, body: page.text };
  };

  const openClipMenu = async (anchor: Element) => {
    if (!isWeb) return;
    const selected = showReader ? selectionMarkdown(readerRef.current) : await frameSelection();
    const base: ClipInput = { kind: "bookmark", url: location, title, body: "" };
    const selection: ClipInput | null = selected ? { ...base, kind: "selection", body: selected } : null;
    const bookmark = async (): Promise<ClipInput> => {
      const page = await browser().readerPage(tabId).catch(() => undefined);
      return { ...base, title: page?.title || title, description: page?.description };
    };
    const items: PopupMenuItem[] = [
      { type: "header", label: `Clip to ${CLIP_FOLDER_TITLE}` },
      { id: "article", label: "Article", icon: "file-text", description: "The readable text, images and links", run: () => void runClip(article) },
      {
        id: "selection",
        label: "Selection",
        icon: "text-select",
        description: selection ? "The text you highlighted" : direct ? "Highlight text in Reader first" : "Highlight text on the page first",
        disabled: !selection,
        run: () => selection && void runClip(async () => selection),
      },
      { id: "bookmark", label: "Link only", icon: "link", description: "Title, summary and address", run: () => void runClip(bookmark) },
      { type: "separator" },
      { id: "append", label: "Add to a page…", icon: "file-plus", run: () => void article().then((input) => setPicker({ kind: "append", input: selection ?? input ?? base })) },
      { id: "folder", label: "Clip into folder…", icon: "folder", run: () => void article().then((input) => setPicker({ kind: "folder", input: input ?? base })) },
    ];
    void popups.menuAt(anchor, items, { placement: "bottom-end", width: 268 });
  };

  const openMoreMenu = (anchor: Element) => {
    const state = browser();
    const items: PopupMenuItem[] = [
      { id: "new", label: "New browser tab", icon: "plus", run: () => void state.open() },
      { id: "external", label: "Open in system browser", icon: "external-link", disabled: !isWeb, run: () => openExternal(location) },
      { id: "copy", label: "Copy address", icon: "link", disabled: !isWeb, run: () => void navigator.clipboard?.writeText(location) },
      { type: "separator" },
      {
        label: "Reader text size",
        icon: "type",
        children: READER_SIZES.map((size) => ({ id: `size-${size}`, label: `${size} px`, checked: prefs.readerSize === size, run: () => state.setPrefs({ readerSize: size }) })),
      },
      { id: "clear-history", label: "Clear browsing history", icon: "trash-2", danger: true, disabled: !state.data.history.length, run: () => state.clearHistory() },
      { type: "separator" },
      { id: "settings", label: "Browser settings…", icon: "settings-2", run: () => openSettings("browser") },
    ];
    void popups.menuAt(anchor, items, { placement: "bottom-end", width: 248 });
  };

  return (
    <div className={`page-pane browser-pane${active ? " active" : ""}`} aria-hidden={!active} data-browser-tab={tabId}>
      <div className="browser-toolbar">
        <div className="browser-nav">
          <button type="button" className="icon-button" aria-label="Back" title="Back (Alt+←)" disabled={!tab || !canGo(tab, -1)} onClick={() => browser().back(tabId)}>
            <ArrowLeft size={16} />
          </button>
          <button type="button" className="icon-button" aria-label="Forward" title="Forward (Alt+→)" disabled={!tab || !canGo(tab, 1)} onClick={() => browser().forward(tabId)}>
            <ArrowRight size={16} />
          </button>
          <button type="button" className="icon-button" aria-label={loading ? "Loading" : "Reload"} title="Reload (Ctrl+R)" disabled={!location} onClick={() => browser().reload(tabId)}>
            <RotateCw size={15} className={loading ? "spin" : undefined} />
          </button>
          <button type="button" className="icon-button browser-home-button" aria-label="Home" title="Home" disabled={!location && !prefs.homePage} onClick={() => browser().home(tabId)}>
            <House size={15} />
          </button>
        </div>
        <AddressBar
          inputRef={addressRef}
          location={location}
          bookmarked={bookmarked}
          onSubmit={(target) => go(target)}
          onToggleBookmark={isWeb ? () => browser().toggleBookmark(location, title) : undefined}
        />
        {isWeb ? (
          <div className="browser-mode" role="radiogroup" aria-label="View">
            <button type="button" role="radio" aria-checked={!showReader} className={!showReader ? "on" : ""} title="The page itself" onClick={() => browser().setMode(tabId, "web")}>
              <Globe size={14} /> <span>Page</span>
            </button>
            <button type="button" role="radio" aria-checked={showReader} className={showReader ? "on" : ""} title="Just the text, in your reading font" onClick={() => browser().setMode(tabId, "reader")}>
              <BookOpen size={14} /> <span>Reader</span>
            </button>
          </div>
        ) : null}
        {isWeb ? (
          <button type="button" className="secondary-button browser-clip" title="Save this page into Noteral" onClick={(event) => void openClipMenu(event.currentTarget)}>
            <Scissors size={14} /> <span>Clip</span>
          </button>
        ) : null}
        <button type="button" className="icon-button" aria-label="More" title="More" onClick={(event) => openMoreMenu(event.currentTarget)}>
          <Ellipsis size={16} />
        </button>
      </div>
      <div className={`browser-progress${loading ? " on" : ""}`} aria-hidden="true" />
      {notice ? (
        <div className={`browser-notice${notice.error ? " error" : ""}`} role="status">
          {notice.busy ? <RotateCw size={14} className="spin" /> : notice.error ? <AlertTriangle size={14} /> : <Check size={14} />}
          <span>{notice.text}</span>
          {notice.pageId ? (
            <button type="button" className="text-button" onClick={() => notice.pageId && void useAppStore.getState().selectPage(notice.pageId)}>
              Open
            </button>
          ) : null}
          {!notice.busy ? (
            <button type="button" className="icon-button tiny" aria-label="Dismiss" onClick={() => setNotice(null)}>
              <X size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
      <div className="browser-body">
        {!location ? <StartPage active={active} engineName={engine.name} onGo={go} /> : null}
        {isWeb && frameSrc ? (
          <iframe
            ref={frameRef}
            key={`${current?.frameKey ?? 0}:${frameSrc}`}
            className={`browser-frame${showReader ? " hidden" : ""}`}
            src={frameSource(frameSrc)}
            title={title}
            sandbox={direct ? DIRECT_SANDBOX : FRAME_SANDBOX}
            referrerPolicy={direct ? "strict-origin-when-cross-origin" : "no-referrer"}
            allow="fullscreen; clipboard-write; autoplay"
            onLoad={() => browser().frameLoaded(tabId)}
          />
        ) : null}
        {showReader ? (
          !reader || reader.status === "loading" ? (
            <LoadingState location={location} />
          ) : reader.status === "error" ? (
            <ErrorState location={location} message={reader.error ?? "Something went wrong."} onRetry={() => browser().reload(tabId)} onPage={() => browser().setMode(tabId, "web")} />
          ) : reader.page && reader.page.error && !reader.page.readable ? (
            <ErrorState location={location} message={reader.page.error} onRetry={() => browser().reload(tabId)} onPage={() => browser().setMode(tabId, "web")} />
          ) : reader.page ? (
            <Reader
              readerRef={readerRef}
              location={location}
              title={reader.page.title || title}
              description={reader.page.description}
              text={reader.page.text}
              truncated={reader.page.truncated}
              size={prefs.readerSize}
              onGo={go}
            />
          ) : null
        ) : null}
      </div>
      {picker ? (
        <PagePickerDialog
          open
          title={picker.kind === "append" ? "Add the clip to a page" : "Clip into a folder"}
          subtitle={picker.kind === "append" ? "The clip goes at the end of the page, under its title and source." : "The clip becomes a new page inside the folder."}
          filter={(item) => !item.deletedAt && (picker.kind === "append" ? (item.kind ?? "page") === "page" : item.kind === "folder")}
          placeholder={picker.kind === "append" ? "Find a page…" : "Find a folder…"}
          onClose={() => setPicker(null)}
          onPick={(pageId) => {
            const chosen = picker;
            setPicker(null);
            void runClip(async () => chosen.input, chosen.kind === "append" ? { pageId } : { parentId: pageId });
          }}
        />
      ) : null}
    </div>
  );
}

// ── address bar ────────────────────────────────────────────────────────────

interface AddressBarProps {
  inputRef: React.MutableRefObject<HTMLInputElement | null>;
  location: string;
  bookmarked: boolean;
  onSubmit: (location: string) => void;
  onToggleBookmark?: () => void;
}

function AddressBar({ inputRef, location, bookmarked, onSubmit, onToggleBookmark }: AddressBarProps) {
  const data = useBrowserStore((state) => state.data);
  const engine = searchEngine(data.prefs);
  const [draft, setDraft] = useState<string | null>(null);
  const [index, setIndex] = useState(0);
  const editing = draft !== null;
  const shown = cleanLocation(location);
  const value = editing ? draft : shown;
  const options = useMemo(() => {
    if (!editing || !draft.trim()) return [];
    const searches = inputSearches(draft);
    const search = { location: searchUrl(draft, engine), label: draft.trim(), detail: `Search ${engine.name}`, kind: "search" as const };
    const site = resolveInput(draft, engine);
    const first = searches ? search : { location: site, label: hostOf(site) || site, detail: "Go to site", kind: "go" as const };
    const rest = suggest(data, draft, 6)
      .filter((item) => item.url !== first.location)
      .map((item) => ({ location: item.url, label: item.title, detail: item.url.replace(/^https?:\/\/(www\.)?/, ""), kind: item.bookmark ? ("bookmark" as const) : ("history" as const) }));
    // An address can still be searched for, below the sites it matches.
    const searchAlso = searches ? [] : [search];
    return [first, ...rest, ...searchAlso];
  }, [data, draft, editing, engine]);

  const submit = (target: string) => {
    if (!target) return;
    setDraft(null);
    inputRef.current?.blur();
    onSubmit(target);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" && options.length) {
      event.preventDefault();
      setIndex((current) => (current + 1) % options.length);
    } else if (event.key === "ArrowUp" && options.length) {
      event.preventDefault();
      setIndex((current) => (current - 1 + options.length) % options.length);
    } else if (event.key === "Escape") {
      event.preventDefault();
      setDraft(null);
      event.currentTarget.blur();
    }
  };

  const secure = location.startsWith("https://");
  const isSearch = !location || searchQueryOf(location) !== null;
  const LeadIcon = isSearch ? Search : secure ? Lock : LockOpen;

  return (
    <form
      className={`browser-address${editing ? " editing" : ""}`}
      role="search"
      onSubmit={(event: FormEvent) => {
        event.preventDefault();
        if (draft !== null) submit(options[index]?.location ?? resolveInput(draft, engine));
      }}
    >
      <span className={`browser-address-lead${isWebLocation(location) && !secure && !editing ? " insecure" : ""}`} title={isWebLocation(location) ? (secure ? "Secure connection" : "Not secure") : undefined}>
        {editing ? <Search size={14} /> : <LeadIcon size={13} />}
      </span>
      <input
        ref={inputRef}
        value={value}
        placeholder={`Search ${engine.name} or type an address`}
        aria-label="Address"
        spellCheck={false}
        autoComplete="off"
        onFocus={(event) => {
          setDraft(shown);
          setIndex(0);
          const input = event.currentTarget;
          requestAnimationFrame(() => input.select());
        }}
        onBlur={() => setTimeout(() => setDraft(null), 120)}
        onChange={(event) => {
          setDraft(event.target.value);
          setIndex(0);
        }}
        onKeyDown={onKeyDown}
      />
      {onToggleBookmark && !editing ? (
        <button type="button" className={`icon-button tiny browser-star${bookmarked ? " on" : ""}`} aria-pressed={bookmarked} aria-label={bookmarked ? "Remove bookmark" : "Bookmark this page"} title={bookmarked ? "Remove bookmark" : "Bookmark this page"} onClick={onToggleBookmark}>
          <Star size={14} fill={bookmarked ? "currentColor" : "none"} />
        </button>
      ) : null}
      {editing && options.length ? (
        <div className="browser-suggest" role="listbox">
          {options.map((option, n) => (
            <button
              type="button"
              key={`${option.kind}:${option.location}`}
              role="option"
              aria-selected={n === index}
              className={n === index ? "on" : ""}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setIndex(n)}
              onClick={() => submit(option.location)}
            >
              <span className="browser-suggest-icon">
                {option.kind === "search" ? <Search size={14} /> : option.kind === "bookmark" ? <Star size={14} /> : option.kind === "history" ? <Clock size={14} /> : <Favicon location={option.location} size={14} />}
              </span>
              <span className="browser-suggest-label">{option.label}</span>
              <span className="browser-suggest-detail">{option.detail}</span>
            </button>
          ))}
        </div>
      ) : null}
    </form>
  );
}

// ── start page ─────────────────────────────────────────────────────────────

function relativeTime(iso: string): string {
  const then = Date.parse(iso);
  if (!Number.isFinite(then)) return "";
  const minutes = Math.round((Date.now() - then) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days} d ago`;
  return new Date(then).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function StartPage({ active, engineName, onGo }: { active: boolean; engineName: string; onGo: (location: string, options?: { newTab?: boolean }) => void }) {
  const bookmarks = useBrowserStore((state) => state.data.bookmarks);
  const history = useBrowserStore((state) => state.data.history);
  const clipFolderId = useBrowserStore((state) => state.data.prefs.clipFolderId);
  const pages = useAppStore((state) => state.pages);
  const selectPage = useAppStore((state) => state.selectPage);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [showAllHistory, setShowAllHistory] = useState(false);

  useEffect(() => {
    if (active) inputRef.current?.focus();
  }, [active]);

  const clips = useMemo(() => {
    const folder =
      pages.find((page) => page.id === clipFolderId && page.kind === "folder" && !page.deletedAt) ??
      pages.find((page) => page.kind === "folder" && !page.parentId && !page.deletedAt && page.title === CLIP_FOLDER_TITLE);
    if (!folder) return [];
    return pages
      .filter((page) => page.parentId === folder.id && !page.deletedAt)
      .sort((a, b) => (b.createdAt || b.updatedAt).localeCompare(a.createdAt || a.updatedAt))
      .slice(0, 5);
  }, [clipFolderId, pages]);

  const visits = showAllHistory ? history.slice(0, 40) : history.slice(0, 8);
  const linkClick = (event: ReactMouseEvent, url: string) => {
    event.preventDefault();
    onGo(url, { newTab: event.metaKey || event.ctrlKey || event.button === 1 });
  };

  return (
    <div className="browser-start">
      <div className="browser-start-inner">
        <form
          className="browser-start-search"
          role="search"
          onSubmit={(event) => {
            event.preventDefault();
            const target = resolveInput(query, searchEngine(useBrowserStore.getState().data.prefs));
            if (target) onGo(target);
          }}
        >
          <Search size={18} />
          <input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder={`Search ${engineName} or type an address`} aria-label={`Search ${engineName} or type an address`} spellCheck={false} />
          <kbd>Enter</kbd>
        </form>
        <p className="browser-start-engine">
          Searching with <strong>{engineName}</strong>
          <button type="button" className="text-button" onClick={() => openSettings("browser")}>
            <Settings2 size={12} /> Change
          </button>
        </p>

        {bookmarks.length ? (
          <section className="browser-section">
            <h2>
              <Bookmark size={13} /> Bookmarks
            </h2>
            <div className="browser-bookmarks">
              {bookmarks.slice(0, 12).map((item) => (
                <a key={item.url} href={item.url} className="browser-bookmark" title={item.url} onClick={(event) => linkClick(event, item.url)} onAuxClick={(event) => linkClick(event, item.url)}>
                  <span className="browser-bookmark-icon">
                    <Favicon location={item.url} size={16} />
                  </span>
                  <span className="browser-bookmark-text">
                    <span className="browser-bookmark-title">{item.title}</span>
                    <span className="browser-bookmark-host">{hostOf(item.url)}</span>
                  </span>
                  <button
                    type="button"
                    className="icon-button tiny browser-row-remove"
                    aria-label={`Remove ${item.title}`}
                    title="Remove bookmark"
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      useBrowserStore.getState().removeBookmark(item.url);
                    }}
                  >
                    <X size={12} />
                  </button>
                </a>
              ))}
            </div>
          </section>
        ) : null}

        <div className="browser-start-columns">
          <section className="browser-section">
            <h2>
              <History size={13} /> Recently visited
              {history.length > 8 ? (
                <button type="button" className="text-button" onClick={() => setShowAllHistory((value) => !value)}>
                  {showAllHistory ? "Show less" : "Show more"}
                </button>
              ) : null}
            </h2>
            {visits.length ? (
              <ul className="browser-list">
                {visits.map((item) => (
                  <li key={item.url}>
                    <a href={item.url} title={item.url} onClick={(event) => linkClick(event, item.url)} onAuxClick={(event) => linkClick(event, item.url)}>
                      <Favicon location={item.url} size={14} />
                      <span className="browser-list-title">{item.title}</span>
                      <span className="browser-list-meta">{relativeTime(item.visitedAt)}</span>
                    </a>
                    <button type="button" className="icon-button tiny browser-row-remove" aria-label={`Remove ${item.title} from history`} title="Remove from history" onClick={() => useBrowserStore.getState().removeVisit(item.url)}>
                      <X size={12} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="browser-empty">Pages you open show up here.</p>
            )}
          </section>
          <section className="browser-section">
            <h2>
              <Scissors size={13} /> Recent clips
            </h2>
            {clips.length ? (
              <ul className="browser-list">
                {clips.map((page) => (
                  <li key={page.id}>
                    <a
                      href={`noteral://page/${page.id}`}
                      onClick={(event) => {
                        event.preventDefault();
                        void selectPage(page.id);
                      }}
                    >
                      <PageIcon value={page.icon} size={14} fallback={<FileText size={14} />} />
                      <span className="browser-list-title">{page.title || "Untitled"}</span>
                      <span className="browser-list-meta">{relativeTime(page.createdAt || page.updatedAt)}</span>
                    </a>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="browser-empty">
                Use <strong>Clip</strong> on any page to save its article, a highlight or just the link into <em>{CLIP_FOLDER_TITLE}</em>.
              </p>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}

// ── reader ─────────────────────────────────────────────────────────────────

interface ReaderProps {
  readerRef: React.MutableRefObject<HTMLDivElement | null>;
  location: string;
  title: string;
  description: string;
  text: string;
  truncated: boolean;
  size: number;
  onGo: (location: string, options?: { newTab?: boolean }) => void;
}

function Reader({ readerRef, location, title, description, text, truncated, size, onGo }: ReaderProps) {
  const newTab = useRef(false);
  const words = useMemo(() => text.split(/\s+/).filter(Boolean).length, [text]);
  const minutes = Math.max(1, Math.round(words / 230));
  const body = useMemo(() => {
    // The extractor often repeats the title as the first heading.
    const lines = text.trimStart().split("\n");
    if (lines[0]?.replace(/^#+\s*/, "").trim() === title.trim()) return lines.slice(1).join("\n");
    return text;
  }, [text, title]);
  const onLink = useCallback(
    (href: string) => {
      if (/^https?:/i.test(href)) onGo(href, { newTab: newTab.current });
      else if (href.startsWith("#")) readerRef.current?.querySelector(href.replace(/[^#\w-]/g, ""))?.scrollIntoView({ behavior: "smooth" });
      newTab.current = false;
    },
    [onGo, readerRef],
  );

  return (
    <div className="browser-scroll">
      <article
        className="browser-reader"
        ref={readerRef}
        style={{ fontSize: `${size}px` }}
        onClickCapture={(event) => {
          newTab.current = event.metaKey || event.ctrlKey;
        }}
        onAuxClickCapture={(event) => {
          const anchor = (event.target as HTMLElement).closest("a[href]");
          if (event.button !== 1 || !anchor) return;
          event.preventDefault();
          const href = anchor.getAttribute("href") ?? "";
          if (/^https?:/i.test(href)) onGo(href, { newTab: true });
        }}
      >
        <header className="browser-reader-head">
          <span className="browser-reader-site">
            <Favicon location={location} size={14} />
            {hostOf(location)}
            <span aria-hidden="true">·</span>
            {minutes} min read
          </span>
          <h1>{title}</h1>
          {description && !body.trimStart().startsWith(description.slice(0, 40)) ? <p className="browser-reader-lead">{description}</p> : null}
        </header>
        {body.trim() ? (
          <Markdown source={body} className="browser-reader-body" onLink={onLink} images />
        ) : (
          <p className="browser-empty">There's no readable text on this page.</p>
        )}
        {truncated ? <p className="browser-reader-more">The page goes on. Switch to Page for the rest.</p> : null}
        <footer className="browser-reader-foot">
          <button type="button" className="secondary-button" onClick={() => openExternal(location)}>
            <ArrowUpRight size={14} /> Open original
          </button>
        </footer>
      </article>
    </div>
  );
}

// ── loading and errors ─────────────────────────────────────────────────────

function LoadingState({ location }: { location: string }) {
  return (
    <div className="browser-scroll">
      <div className="browser-reader browser-reader-skeleton" aria-label={`Loading ${hostOf(location)}`}>
        <span className="browser-reader-site">
          <Favicon location={location} size={14} />
          {hostOf(location)}
        </span>
        <div className="sk sk-title" />
        <div className="sk sk-title short" />
        <div className="sk-gap" />
        {[92, 100, 96, 70, 0, 100, 88, 94, 60].map((width, n) => (width ? <div key={n} className="sk" style={{ width: `${width}%` }} /> : <div key={n} className="sk-gap" />))}
      </div>
    </div>
  );
}

function ErrorState({ location, message, onRetry, onPage }: { location: string; message: string; onRetry: () => void; onPage?: () => void }) {
  return (
    <div className="browser-scroll">
      <div className="browser-error">
        <span className="browser-error-icon">
          <AlertTriangle size={20} />
        </span>
        <h2>Reader can't open {hostOf(location) || "this page"}</h2>
        <p>{message}</p>
        <div className="browser-error-actions">
          <button type="button" className="primary-button" onClick={onRetry}>
            <RotateCw size={14} /> Try again
          </button>
          {onPage ? (
            <button type="button" className="secondary-button" onClick={onPage}>
              <Globe size={14} /> Show the page
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

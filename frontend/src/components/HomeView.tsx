import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, House, MoreHorizontal, SlidersHorizontal } from "lucide-react";
import { HOME_TEMPLATE_INFO, backgroundForView, defaultHomeTabSettings, homeTone, homeViewKey, splitBackgroundPatch, type HomeCustomLayout, type HomeTabSettings } from "../lib/home";
import { useAppStore } from "../store";
import { CustomHome } from "./home/CustomHome";
import { HomeBackdrop } from "./home/HomeBackdrop";
import { HomeMenu } from "./home/HomeMenu";
import { DashboardHome, DeskHome, FocusHome, GalleryHome, IndexHome, LaunchpadHome, TimelineHome } from "./home/views";

export function HomeView({ tabId, active = true }: { tabId?: string; active?: boolean }) {
  const settings = useAppStore((state) => (tabId ? state.homeTabs[tabId] : undefined)) ?? defaultHomeTabSettings;
  const theme = useAppStore((state) => state.resolvedTheme);
  const history = useAppStore((state) => state.history);
  const historyIndex = useAppStore((state) => state.historyIndex);
  const goBack = useAppStore((state) => state.goBack);
  const goForward = useAppStore((state) => state.goForward);
  const updateHomeTab = useAppStore((state) => state.updateHomeTab);
  const view = useAppStore((state) => (settings.template === "custom" ? state.homeViews.find((item) => item.id === settings.view) : undefined));
  const createHomeView = useAppStore((state) => state.createHomeView);
  const updateHomeView = useAppStore((state) => state.updateHomeView);
  const duplicateHomeView = useAppStore((state) => state.duplicateHomeView);
  const removeHomeView = useAppStore((state) => state.removeHomeView);
  const viewKey = homeViewKey(settings);
  const backdrop = useAppStore((state) => backgroundForView(state.homePrefs, viewKey));
  const defaultView = useAppStore((state) => state.homePrefs.defaultView ?? "desk");
  const setHomeBackground = useAppStore((state) => state.setHomeBackground);
  const setDefaultHomeView = useAppStore((state) => state.setDefaultHomeView);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
    setEditing(false);
  }, [tabId]);

  useEffect(() => {
    if (!active) setMenuOpen(false);
  }, [active]);

  useEffect(() => {
    if (settings.template !== "custom") setEditing(false);
  }, [settings.template]);

  const update = useCallback(
    (patch: Partial<HomeTabSettings>) => {
      if (tabId) updateHomeTab(tabId, patch);
    },
    [tabId, updateHomeTab],
  );
  // The menu edits one settings object; the background part belongs to the view.
  const onMenuChange = useCallback(
    (patch: Partial<HomeTabSettings>) => {
      const { background, tab } = splitBackgroundPatch(patch);
      if (background) setHomeBackground(viewKey, background);
      if (Object.keys(tab).length) update(tab);
    },
    [setHomeBackground, update, viewKey],
  );
  const shown = { ...settings, ...backdrop };
  const closeMenu = useCallback(() => setMenuOpen(false), []);
  const viewId = view?.id;
  const onCustomChange = useCallback((layout: HomeCustomLayout) => {
    if (viewId) updateHomeView(viewId, layout);
  }, [viewId, updateHomeView]);

  const editView = (id: string) => {
    if (!tabId) return;
    update({ template: "custom", view: id });
    setEditing(true);
    setMenuOpen(false);
  };
  const startCustomizing = () => {
    if (!tabId) return;
    editView(settings.template === "custom" && view ? view.id : createHomeView());
  };

  const tone = homeTone(backdrop, theme);
  const canBack = historyIndex > 0;
  const canForward = historyIndex < history.length - 1;
  const canCustomize = Boolean(tabId);

  return (
    <section
      className={`home-view ${active ? "active" : ""}`}
      data-background={backdrop.background}
      data-view={settings.template}
      data-tone={tone}
      role="main"
      aria-label="Home"
      aria-hidden={!active}
    >
      <HomeBackdrop
        background={backdrop.background}
        color={backdrop.color}
        gradient={backdrop.gradient}
        ascii={backdrop.ascii}
        active={active}
        calm={editing && settings.template === "custom"}
      />
      <div className={`home-tone home-tone-${tone}`} data-tone={tone}>
        <header className="page-header home-header" aria-label="Home navigation">
          <div className="page-header-left">
            <button type="button" className="icon-button" aria-label="Go back" title="Go back (Alt+← or ⌘[)" disabled={!canBack} onClick={goBack}>
              <ArrowLeft size={16} />
            </button>
            <button type="button" className="icon-button" aria-label="Go forward" title="Go forward (Alt+→ or ⌘])" disabled={!canForward} onClick={goForward}>
              <ArrowRight size={16} />
            </button>
          </div>

          <div className="home-header-title">
            <House size={13} aria-hidden="true" />
            <span>Home</span>
            <span className="home-header-dot" aria-hidden="true">·</span>
            <span className="home-header-context">{view?.name ?? HOME_TEMPLATE_INFO[settings.template].label}</span>
          </div>

          <div className="page-header-right">
            {settings.template === "custom" && !editing && canCustomize ? (
              <button type="button" className="home-header-pill" onClick={() => setEditing(true)} title="Add, move and resize widgets">
                <SlidersHorizontal size={13} aria-hidden="true" />
                <span>Edit</span>
              </button>
            ) : null}
            <div className="home-menu-anchor" ref={anchorRef}>
              <button
                type="button"
                className={`icon-button ${menuOpen ? "is-on" : ""}`}
                aria-label="Home options"
                aria-haspopup="dialog"
                aria-expanded={menuOpen}
                title="Home options"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={17} />
              </button>
            </div>
          </div>
        </header>

        {settings.template === "custom" && view ? (
          <CustomHome
            key={view.id}
            view={view}
            editing={editing && canCustomize}
            onEditingChange={setEditing}
            onChange={onCustomChange}
            onRename={(name) => updateHomeView(view.id, { name })}
            onDuplicateView={() => {
              const id = duplicateHomeView(view.id);
              if (id) update({ view: id });
            }}
            onDeleteView={() => {
              setEditing(false);
              removeHomeView(view.id);
            }}
          />
        ) : (
          <div className="home-scroll">
            {settings.template === "desk" ? <DeskHome /> : null}
            {settings.template === "focus" ? <FocusHome /> : null}
            {settings.template === "dashboard" ? <DashboardHome /> : null}
            {settings.template === "gallery" ? <GalleryHome /> : null}
            {settings.template === "timeline" ? <TimelineHome /> : null}
            {settings.template === "index" ? <IndexHome /> : null}
            {settings.template === "launchpad" ? <LaunchpadHome active={active} /> : null}
          </div>
        )}
      </div>

      {menuOpen && active ? (
        <HomeMenu
          anchor={anchorRef.current}
          settings={shown}
          theme={theme}
          defaultView={defaultView}
          onDefaultView={setDefaultHomeView}
          onChange={canCustomize ? onMenuChange : undefined}
          onCustomize={canCustomize ? startCustomizing : undefined}
          onEditView={canCustomize ? editView : undefined}
          onClose={closeMenu}
        />
      ) : null}
    </section>
  );
}

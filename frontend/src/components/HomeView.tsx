import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, House, MoreHorizontal, Plus } from "lucide-react";
import { defaultHomeTabSettings } from "../lib/home";
import { useAppStore } from "../store";
import {
  DefaultHome,
  FocusHome,
  GalleryHome,
  LibraryHome,
  homeBackgroundMeta,
  homeTemplateMeta,
} from "./home/templates";

export function HomeView({ tabId, active = true }: { tabId?: string; active?: boolean }) {
  const settings = useAppStore((state) => (tabId ? state.homeTabs[tabId] : undefined)) ?? defaultHomeTabSettings;
  const history = useAppStore((state) => state.history);
  const historyIndex = useAppStore((state) => state.historyIndex);
  const goBack = useAppStore((state) => state.goBack);
  const goForward = useAppStore((state) => state.goForward);
  const updateHomeTab = useAppStore((state) => state.updateHomeTab);
  const openHomeTab = useAppStore((state) => state.openHomeTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLDivElement>(null);
  const template = homeTemplateMeta.find((item) => item.id === settings.template) ?? homeTemplateMeta[0];
  const background = homeBackgroundMeta.find((item) => item.id === settings.background) ?? homeBackgroundMeta[0];

  useEffect(() => {
    setMenuOpen(false);
  }, [tabId]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (menuAnchor.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  const canBack = historyIndex > 0;
  const canForward = historyIndex < history.length - 1;
  const canCustomize = Boolean(tabId);

  return (
    <section
      className={`home-view ${active ? "active" : ""}`}
      data-background={settings.background}
      role="main"
      aria-label="Home"
      aria-hidden={!active}
    >
      <header className="page-header home-header" aria-label="Home navigation">
        <div className="page-header-left">
          <button
            type="button"
            className="icon-button"
            aria-label="Go back"
            title="Go back (Alt+← or ⌘[)"
            disabled={!canBack}
            onClick={goBack}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Go forward"
            title="Go forward (Alt+→ or ⌘])"
            disabled={!canForward}
            onClick={goForward}
          >
            <ArrowRight size={16} />
          </button>
        </div>

        <div className="home-header-title">
          <House size={13} aria-hidden="true" />
          <span>Home</span>
          <span className="home-header-dot" aria-hidden="true">·</span>
          <span className="home-header-context">{template.label}</span>
        </div>

        <div className="page-header-right">
          <div className="home-menu-anchor" ref={menuAnchor}>
            <button
              type="button"
              className="icon-button"
              aria-label="Home options"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              title="Home options"
              onClick={() => setMenuOpen((open) => !open)}
            >
              <MoreHorizontal size={17} />
            </button>
            {menuOpen ? (
              <div className="menu home-menu" role="menu" aria-label="Home options">
                <div className="home-menu-label">View</div>
                {homeTemplateMeta.map((item) => {
                  const Icon = item.icon;
                  const selected = settings.template === item.id;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      role="menuitemradio"
                      aria-checked={selected}
                      disabled={!canCustomize}
                      onClick={() => tabId && updateHomeTab(tabId, { template: item.id })}
                    >
                      <span className="home-template-icon" aria-hidden="true"><Icon size={14} /></span>
                      <span className="home-template-copy">
                        <span className="home-template-name">{item.label}</span>
                        <span className="home-template-desc">{item.description}</span>
                      </span>
                      {selected ? <Check size={14} className="menu-check" /> : null}
                    </button>
                  );
                })}
                <div className="menu-separator" />
                <div className="home-menu-label"><span>Background</span><span className="home-menu-value">{background.label}</span></div>
                <div className="home-swatches" role="group" aria-label="Home background">
                  {homeBackgroundMeta.map((item) => {
                    const selected = settings.background === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`home-swatch ${selected ? "selected" : ""}`}
                        style={{ background: item.swatch }}
                        role="menuitemradio"
                        aria-checked={selected}
                        aria-label={`${item.label} background`}
                        title={item.label}
                        disabled={!canCustomize}
                        onClick={() => tabId && updateHomeTab(tabId, { background: item.id })}
                      >
                        {selected ? <Check size={12} aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
                <div className="menu-separator" />
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuOpen(false);
                    openHomeTab(defaultHomeTabSettings);
                  }}
                >
                  <span className="home-template-icon" aria-hidden="true"><Plus size={14} /></span>
                  <span className="home-template-copy">
                    <span className="home-template-name">Open default in new tab</span>
                    <span className="home-template-desc">A fresh Home with this view reset</span>
                  </span>
                </button>
                <p className="home-menu-note">Each Home tab remembers its own view.</p>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <div className="home-scroll">
        {settings.template === "library" ? <LibraryHome /> : null}
        {settings.template === "focus" ? <FocusHome /> : null}
        {settings.template === "gallery" ? <GalleryHome /> : null}
        {settings.template === "default" ? <DefaultHome /> : null}
      </div>
    </section>
  );
}

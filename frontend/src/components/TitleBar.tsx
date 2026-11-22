import { useEffect, useRef, useState } from "react";
import { Window } from "@wailsio/runtime";
import {
  ChevronDown,
  Download,
  FileJson,
  FolderOpen,
  Info,
  Minus,
  PanelLeft,
  PanelRight,
  Settings,
  Square,
  X,
} from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useAppStore } from "../store";
import { TabStrip } from "./TabStrip";

export function TitleBar() {
  const platform = useAppStore((state) => state.bootstrap?.platform ?? "");
  const leftOpen = useAppStore((state) => state.settings.leftOpen);
  const rightOpen = useAppStore((state) => state.settings.rightOpen);
  const workspace = useAppStore((state) => state.workspace);
  const activePageId = useAppStore((state) => state.activePageId);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const notify = useAppStore((state) => state.notify);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const isMac = platform === "darwin";

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [menuOpen]);

  async function exportPage(kind: "json" | "markdown") {
    setMenuOpen(false);
    if (!workspace || !activePageId) {
      notify("Open a page before exporting.", "info");
      return;
    }
    try {
      const result = kind === "json" ? await api.exportJson(workspace.id, activePageId) : await api.exportMarkdown(workspace.id, activePageId);
      if (result) notify(`Exported to ${result.path}`, "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  return (
    <header className={`titlebar ${isMac ? "titlebar-mac" : "titlebar-custom"}`}>
      {isMac ? <div className="traffic-light-space" aria-hidden="true" /> : null}
      <div className="titlebar-left no-drag">
        <button
          type="button"
          className={`icon-button ${leftOpen ? "is-on" : ""}`}
          aria-label={leftOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={leftOpen}
          title={leftOpen ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
          onClick={() => updateSettings({ leftOpen: !leftOpen })}
        >
          <PanelLeft size={17} />
        </button>
      </div>
      <TabStrip />
      <div className="titlebar-spacer" aria-hidden="true" />
      <div className="titlebar-right no-drag">
        <button
          type="button"
          className={`icon-button ${rightOpen ? "is-on" : ""}`}
          aria-label={rightOpen ? "Hide inspector" : "Show inspector"}
          aria-pressed={rightOpen}
          title={rightOpen ? "Hide inspector (Ctrl+Shift+B)" : "Show inspector (Ctrl+Shift+B)"}
          onClick={() => updateSettings({ rightOpen: !rightOpen })}
        >
          <PanelRight size={17} />
        </button>
        <div className="menu-anchor" ref={menuRef}>
          <button
            type="button"
            className={`icon-button ${menuOpen ? "is-on" : ""}`}
            aria-label="More actions"
            aria-expanded={menuOpen}
            title="More actions"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <ChevronDown size={16} />
          </button>
          {menuOpen ? (
            <div className="menu" role="menu">
              <button type="button" role="menuitem" onClick={() => void exportPage("markdown")} disabled={!activePageId}>
                <Download size={15} /> Export Markdown
              </button>
              <button type="button" role="menuitem" onClick={() => void exportPage("json")} disabled={!activePageId}>
                <FileJson size={15} /> Export page JSON
              </button>
              <div className="menu-separator" />
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setOverlay("settings"); }}>
                <Settings size={15} /> Settings
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void api.revealDataDir().catch((error) => notify(errorMessage(error), "error")); }}>
                <FolderOpen size={15} /> Open data folder
              </button>
              <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); setOverlay("settings"); }}>
                <Info size={15} /> About Noteral
              </button>
            </div>
          ) : null}
        </div>
        {!isMac ? (
          <div className="window-controls">
            <button type="button" className="window-button" aria-label="Minimise" title="Minimise" onClick={() => void Window.Minimise()}>
              <Minus size={15} />
            </button>
            <button type="button" className="window-button" aria-label="Maximise" title="Maximise" onClick={() => void Window.ToggleMaximise()}>
              <Square size={12} />
            </button>
            <button type="button" className="window-button window-close" aria-label="Close" title="Close" onClick={() => void Window.Close()}>
              <X size={15} />
            </button>
          </div>
        ) : null}
      </div>
    </header>
  );
}

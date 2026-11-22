import { PanelLeft, PanelRight, Search } from "lucide-react";
import { useAppStore } from "../store";
import { WindowControls } from "./WindowControls";

/**
 * The window's top bar: brand on the left, search in the middle, view and window
 * controls on the right. It is transparent, spans the full width, and stays the
 * drag region for the frameless window.
 */
export function TopBar() {
  const platform = useAppStore((state) => state.bootstrap?.platform ?? "");
  const leftOpen = useAppStore((state) => state.settings.leftOpen);
  const rightOpen = useAppStore((state) => state.settings.rightOpen);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const isMac = platform === "darwin";

  return (
    <header className="topbar">
      <div className="topbar-left">
        <div className="topbar-brand" aria-label="Noteral">
          <span className="topbar-mark" aria-hidden="true">N</span>
          <span className="topbar-name">Noteral</span>
        </div>
        <button
          type="button"
          className={`icon-button topbar-toggle-left ${leftOpen ? "is-on" : ""}`}
          aria-label={leftOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={leftOpen}
          title={leftOpen ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
          onClick={() => updateSettings({ leftOpen: !leftOpen })}
        >
          <PanelLeft size={17} />
        </button>
      </div>
      <div className="topbar-center">
        <button
          type="button"
          className="topbar-search"
          aria-label="Search notes and commands"
          title="Search notes and commands (Ctrl/⌘ K)"
          onClick={() => setOverlay("palette")}
        >
          <Search size={14} />
          <span className="topbar-search-label">Search notes and commands</span>
          <kbd>{isMac ? "⌘K" : "Ctrl K"}</kbd>
        </button>
      </div>
      <div className="topbar-right">
        <button
          type="button"
          className={`icon-button topbar-toggle-right ${rightOpen ? "is-on" : ""}`}
          aria-label={rightOpen ? "Hide inspector" : "Show inspector"}
          aria-pressed={rightOpen}
          title={rightOpen ? "Hide inspector (Ctrl+Shift+B)" : "Show inspector (Ctrl+Shift+B)"}
          onClick={() => updateSettings({ rightOpen: !rightOpen })}
        >
          <PanelRight size={17} />
        </button>
        {!isMac ? <WindowControls /> : null}
      </div>
    </header>
  );
}

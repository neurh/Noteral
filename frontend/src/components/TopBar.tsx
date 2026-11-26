import { ChevronDown, PanelLeft, PanelRight, Search, Sparkles } from "lucide-react";
import { toggleAssistant } from "../assistant/open";
import { assistantQuickActions } from "../assistant/quickActions";
import { popups } from "../lib/popups";
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
  const assistantOpen = useAppStore((state) => state.settings.rightOpen && state.rightTab === "assistant");
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
        <div className="topbar-search-box">
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
          <div className={`topbar-ai ${assistantOpen ? "is-on" : ""}`} role="group" aria-label="Assistant">
            <button
              type="button"
              className="topbar-ai-main"
              aria-pressed={assistantOpen}
              aria-label={assistantOpen ? "Hide assistant" : "Show assistant"}
              title={`${assistantOpen ? "Hide" : "Show"} assistant (${isMac ? "⌘J" : "Ctrl+J"})`}
              onClick={() => toggleAssistant()}
            >
              <Sparkles size={13} />
              <span className="topbar-ai-label">AI</span>
            </button>
            <button
              type="button"
              className="topbar-ai-more"
              aria-label="Assistant actions"
              aria-haspopup="menu"
              title="Assistant actions"
              onClick={(event) => {
                const group = event.currentTarget.parentElement ?? event.currentTarget;
                void popups.menuAt(group, assistantQuickActions(), { placement: "bottom-end", width: 250 });
              }}
            >
              <ChevronDown size={13} />
            </button>
          </div>
        </div>
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

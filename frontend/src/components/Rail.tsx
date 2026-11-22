import { Boxes, LibraryBig, PanelLeft, Puzzle, Search, Settings } from "lucide-react";
import { useAppStore } from "../store";

const items = [
  { id: "workspaces", label: "Workspaces", icon: Boxes },
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "palette", label: "Search", icon: Search },
  { id: "plugins", label: "Plugins", icon: Puzzle },
  { id: "settings", label: "Settings", icon: Settings },
] as const;

export function Rail() {
  const overlay = useAppStore((state) => state.overlay);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const leftOpen = useAppStore((state) => state.settings.leftOpen);
  const updateSettings = useAppStore((state) => state.updateSettings);

  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-top">
        <button
          type="button"
          className={`icon-button rail-toggle ${leftOpen ? "is-on" : ""}`}
          aria-label={leftOpen ? "Hide sidebar" : "Show sidebar"}
          aria-pressed={leftOpen}
          title={leftOpen ? "Hide sidebar (Ctrl+B)" : "Show sidebar (Ctrl+B)"}
          onClick={() => updateSettings({ leftOpen: !leftOpen })}
        >
          <PanelLeft size={17} />
        </button>
      </div>
      <div className="rail-items">
        {items.map((item) => {
          const Icon = item.icon;
          const selected = overlay === item.id;
          return (
            <button
              key={item.id}
              type="button"
              className={`rail-button ${selected ? "selected" : ""}`}
              aria-label={item.label}
              aria-pressed={selected}
              title={item.label}
              onClick={() => setOverlay(item.id)}
            >
              <Icon size={19} strokeWidth={1.8} />
            </button>
          );
        })}
      </div>
      <div className="rail-bottom" aria-hidden="true">
        <span className="rail-dot" />
      </div>
    </nav>
  );
}

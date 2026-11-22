import { Boxes, LibraryBig, Puzzle, Search, Settings } from "lucide-react";
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
  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-top" aria-hidden="true">
        <span className="rail-logo">N</span>
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

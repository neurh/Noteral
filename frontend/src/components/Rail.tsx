import { Layers, LibraryBig, ListTree, Puzzle, Search, Settings } from "lucide-react";
import { useAppStore, type LeftTab } from "../store";

const items = [
  { id: "library", label: "Library", icon: LibraryBig },
  { id: "palette", label: "Search", icon: Search },
  { id: "plugins", label: "Plugins", icon: Puzzle },
] as const;

const bottomItems = [
  { id: "settings", label: "Settings", icon: Settings },
  { id: "workspaces", label: "Workspaces", icon: Layers },
] as const;

// The first rail button mirrors the sidebar's page-tree tab: it opens a closed
// sidebar, switches an open sidebar to the tree, and hides the sidebar when the
// tree is already showing. Exported for unit tests.
export function nextTreeAction(leftOpen: boolean, leftTab: LeftTab): "open" | "switch" | "hide" {
  if (!leftOpen) return "open";
  return leftTab === "tree" ? "hide" : "switch";
}

export function Rail() {
  const overlay = useAppStore((state) => state.overlay);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const leftOpen = useAppStore((state) => state.settings.leftOpen);
  const leftTab = useAppStore((state) => state.leftTab);
  const setLeftTab = useAppStore((state) => state.setLeftTab);
  const updateSettings = useAppStore((state) => state.updateSettings);

  const treeVisible = leftOpen && leftTab === "tree";
  const toggleTree = () => {
    const action = nextTreeAction(leftOpen, leftTab);
    if (action === "open") {
      setLeftTab("tree");
      updateSettings({ leftOpen: true });
    } else if (action === "switch") {
      setLeftTab("tree");
    } else {
      updateSettings({ leftOpen: false });
    }
  };

  return (
    <nav className="rail" aria-label="Primary">
      <div className="rail-items">
        <button
          type="button"
          className={`rail-button rail-tree-button ${treeVisible ? "selected" : ""}`}
          aria-label="Page tree"
          aria-pressed={treeVisible}
          title={treeVisible ? "Hide page tree" : "Show page tree"}
          onClick={toggleTree}
        >
          <ListTree size={19} strokeWidth={1.8} />
        </button>
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
      <div className="rail-bottom">
        {bottomItems.map((item) => {
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
    </nav>
  );
}

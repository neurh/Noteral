import { Clock, ListTree, Star } from "lucide-react";
import { useAppStore, type LeftTab } from "../store";

const tabs: Array<{ id: LeftTab; label: string; icon: typeof ListTree }> = [
  { id: "tree", label: "Page tree", icon: ListTree },
  { id: "favorites", label: "Favorites", icon: Star },
  { id: "recent", label: "Recent", icon: Clock },
];

export function LeftSidebarTabs() {
  const tab = useAppStore((state) => state.leftTab);
  const setTab = useAppStore((state) => state.setLeftTab);
  const pages = useAppStore((state) => state.pages);

  return (
    <div className="left-sidebar-tabs" role="tablist" aria-label="Sidebar views">
      {tabs.map((item) => {
        const Icon = item.icon;
        const selected = tab === item.id;
        return (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={item.label}
            title={item.label}
            className={`left-tab ${selected ? "active" : ""}`}
            onClick={() => setTab(item.id)}
          >
            <Icon size={15} />
          </button>
        );
      })}
      <div className="left-tab-spacer" />
      <span className="left-tab-count" title="Pages in workspace">{pages.length}</span>
    </div>
  );
}

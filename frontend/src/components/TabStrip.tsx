import { Plus, X } from "lucide-react";
import { useAppStore } from "../store";

export function TabStrip() {
  const tabs = useAppStore((state) => state.tabs);
  const pages = useAppStore((state) => state.pages);
  const active = useAppStore((state) => state.activePageId);
  const selectPage = useAppStore((state) => state.selectPage);
  const closeTab = useAppStore((state) => state.closeTab);
  const reorderTabs = useAppStore((state) => state.reorderTabs);
  const createPage = useAppStore((state) => state.createPage);
  const titles = new Map(pages.map((page) => [page.id, page.title]));
  let dragIndex: number | null = null;

  return (
    <div className="tab-strip" role="tablist" aria-label="Open pages">
      {tabs.map((pageId, index) => {
        const title = titles.get(pageId) ?? "Untitled";
        const selected = active === pageId;
        return (
          <div
            key={pageId}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`tab ${selected ? "active" : ""}`}
            draggable
            onDragStart={(event) => {
              dragIndex = index;
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", String(index));
            }}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragIndex ?? Number(event.dataTransfer.getData("text/plain"));
              if (Number.isFinite(from)) reorderTabs(from, index);
              dragIndex = null;
            }}
            onDragEnd={() => {
              dragIndex = null;
            }}
            onMouseDown={(event) => {
              if (event.button === 1) {
                event.preventDefault();
                void closeTab(pageId);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                void selectPage(pageId);
              }
            }}
            onClick={() => void selectPage(pageId)}
            title={title}
          >
            <span className="tab-title">{title}</span>
            <button
              type="button"
              className="tab-close"
              aria-label={`Close ${title}`}
              title={`Close ${title}`}
              onClick={(event) => {
                event.stopPropagation();
                void closeTab(pageId);
              }}
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button type="button" className="icon-button tab-new" aria-label="New page" title="New page (Ctrl+N)" onClick={() => void createPage()}>
        <Plus size={15} />
      </button>
    </div>
  );
}

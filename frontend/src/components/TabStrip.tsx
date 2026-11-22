import { useRef } from "react";
import { House, Plus, X } from "lucide-react";
import { HOME_TEMPLATE_LABELS } from "../lib/home";
import { isHomeTab, useAppStore } from "../store";

export function TabStrip() {
  const tabs = useAppStore((state) => state.tabs);
  const pages = useAppStore((state) => state.pages);
  const active = useAppStore((state) => state.activeTabId);
  const homeTabs = useAppStore((state) => state.homeTabs);
  const selectTab = useAppStore((state) => state.selectTab);
  const closeTab = useAppStore((state) => state.closeTab);
  const reorderTabs = useAppStore((state) => state.reorderTabs);
  const openHomeTab = useAppStore((state) => state.openHomeTab);
  const titles = new Map(pages.map((page) => [page.id, page.title]));
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  let dragIndex: number | null = null;

  function focusTab(index: number) {
    const next = Math.max(0, Math.min(tabs.length - 1, index));
    const tabId = tabs[next];
    if (!tabId) return;
    selectTab(tabId);
    requestAnimationFrame(() => tabRefs.current.get(tabId)?.focus());
  }

  return (
    <div className="tab-strip" role="tablist" aria-label="Open tabs">
      {tabs.map((tabId, index) => {
        const home = isHomeTab(tabId);
        const title = home ? "Home" : titles.get(tabId) ?? "Untitled";
        const homeTitle = home ? `Home · ${HOME_TEMPLATE_LABELS[homeTabs[tabId]?.template ?? "default"]}` : title;
        const selected = active === tabId;
        const canClose = !(home && tabs.length === 1);
        return (
          <div
            key={tabId}
            ref={(element) => {
              if (element) tabRefs.current.set(tabId, element);
              else tabRefs.current.delete(tabId);
            }}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`tab ${home ? "tab-home" : ""} ${selected ? "active" : ""}`}
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
                if (canClose) void closeTab(tabId);
              }
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                selectTab(tabId);
              } else if (event.key === "ArrowRight") {
                event.preventDefault();
                focusTab(index + 1);
              } else if (event.key === "ArrowLeft") {
                event.preventDefault();
                focusTab(index - 1);
              } else if (event.key === "Home") {
                event.preventDefault();
                focusTab(0);
              } else if (event.key === "End") {
                event.preventDefault();
                focusTab(tabs.length - 1);
              }
            }}
            onClick={() => selectTab(tabId)}
            title={homeTitle}
          >
            {home ? <House size={13} className="tab-home-icon" aria-hidden="true" /> : null}
            <span className="tab-title">{title}</span>
            {canClose ? (
              <button
                type="button"
                className="tab-close"
                aria-label={`Close ${homeTitle}`}
                title={`Close ${homeTitle}`}
                onClick={(event) => {
                  event.stopPropagation();
                  void closeTab(tabId);
                }}
              >
                <X size={12} />
              </button>
            ) : null}
          </div>
        );
      })}
      <button
        type="button"
        className="icon-button tab-new"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        onClick={() => openHomeTab()}
      >
        <Plus size={15} />
      </button>
    </div>
  );
}

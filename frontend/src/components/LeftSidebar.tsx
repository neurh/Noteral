import { useEffect, useRef } from "react";
import { ChevronDown, Plus } from "lucide-react";
import { useAppStore } from "../store";
import { PageTree } from "./PageTree";
import { PageList } from "./PageList";
import { LeftSidebarTabs } from "./LeftSidebarTabs";
import { TrashView } from "./TrashView";

export function LeftSidebar() {
  const open = useAppStore((state) => state.settings.leftOpen);
  const width = useAppStore((state) => state.settings.leftWidth);
  const tab = useAppStore((state) => state.leftTab);
  const workspace = useAppStore((state) => state.workspace);
  const favorites = useAppStore((state) => state.favorites);
  const recent = useAppStore((state) => state.recent);
  const pages = useAppStore((state) => state.pages);
  const createPage = useAppStore((state) => state.createPage);
  const setOverlay = useAppStore((state) => state.setOverlay);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const persistSettings = useAppStore((state) => state.persistSettingsNow);
  const resizing = useRef<{ x: number; width: number } | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const start = resizing.current;
      if (!start) return;
      const next = Math.max(220, Math.min(420, start.width + (event.clientX - start.x)));
      updateSettings({ leftWidth: next }, false);
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = null;
      document.body.classList.remove("resizing");
      void persistSettings();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateSettings, persistSettings]);

  if (!open) return null;
  const favoritePages = pages.filter((page) => favorites.includes(page.id));
  return (
    <aside className="left-sidebar" ref={asideRef} style={{ width }} aria-label="Sidebar">
      <LeftSidebarTabs />
      <div className="workspace-switcher">
        <button
          type="button"
          className="workspace-button"
          onClick={() => setOverlay("workspaces")}
          aria-label={`Workspace: ${workspace?.name ?? "None"}. Switch workspace`}
          title="Switch workspace"
        >
          <span className="workspace-avatar" aria-hidden="true">{(workspace?.name ?? "W").slice(0, 1).toUpperCase()}</span>
          <span className="workspace-name">{workspace?.name ?? "Workspace"}</span>
          <ChevronDown size={13} />
        </button>
        <button type="button" className="icon-button" aria-label="New page" title="New page" onClick={() => void createPage()}>
          <Plus size={16} />
        </button>
      </div>
      <div className="left-content">
        {tab === "tree" ? <PageTree /> : null}
        {tab === "favorites" ? <PageList pages={favoritePages} empty="Star pages you want close at hand." /> : null}
        {tab === "recent" ? <PageList pages={recent} empty="Pages you open will appear here." /> : null}
        {tab === "trash" ? <TrashView /> : null}
      </div>
      <div
        className="resize-handle resize-handle-left"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize sidebar"
        title="Drag to resize sidebar"
        onPointerDown={(event) => {
          resizing.current = { x: event.clientX, width: asideRef.current?.getBoundingClientRect().width ?? width };
          document.body.classList.add("resizing");
        }}
      />
    </aside>
  );
}

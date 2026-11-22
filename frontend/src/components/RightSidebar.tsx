import { useEffect, useRef } from "react";
import { ArrowUpRight, ExternalLink, Info, Link2, List, RefreshCw } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { editorBridge } from "../lib/editorBridge";
import { formatDate } from "../lib/format";
import { useAppStore, type RightTab } from "../store";
import { usePluginPanels } from "../plugins/runtime";
import { WindowControls } from "./WindowControls";

const tabs: Array<{ id: RightTab; label: string; icon: typeof List }> = [
  { id: "outline", label: "Outline", icon: List },
  { id: "backlinks", label: "Backlinks", icon: Link2 },
  { id: "info", label: "Page info", icon: Info },
];

export function RightSidebar() {
  const open = useAppStore((state) => state.settings.rightOpen);
  const width = useAppStore((state) => state.settings.rightWidth);
  const platform = useAppStore((state) => state.bootstrap?.platform ?? "");
  const tab = useAppStore((state) => state.rightTab);
  const setTab = useAppStore((state) => state.setRightTab);
  const outline = useAppStore((state) => state.outline);
  const backlinks = useAppStore((state) => state.backlinks);
  const activeId = useAppStore((state) => state.activePageId);
  const page = useAppStore((state) => state.documents[state.activePageId]);
  const workspace = useAppStore((state) => state.workspace);
  const liveWords = useAppStore((state) => state.liveWordCount);
  const liveBlocks = useAppStore((state) => state.liveBlockCount);
  const pluginPanels = usePluginPanels();
  const selectPage = useAppStore((state) => state.selectPage);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const persistSettings = useAppStore((state) => state.persistSettingsNow);
  const notify = useAppStore((state) => state.notify);
  const resizing = useRef(false);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      if (!resizing.current) return;
      const next = Math.max(260, Math.min(420, window.innerWidth - event.clientX));
      updateSettings({ rightWidth: next }, false);
    };
    const onUp = () => {
      if (!resizing.current) return;
      resizing.current = false;
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

  async function exportPage(kind: "json" | "markdown") {
    if (!workspace || !activeId) return;
    try {
      const result = kind === "json" ? await api.exportJson(workspace.id, activeId) : await api.exportMarkdown(workspace.id, activeId);
      if (result) notify(`Exported to ${result.path}`, "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  return (
    <aside className="right-sidebar" style={{ width }} aria-label="Inspector">
      <div
        className="resize-handle resize-handle-right"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        title="Drag to resize inspector"
        onPointerDown={() => {
          resizing.current = true;
          document.body.classList.add("resizing");
        }}
      />
      <div className="right-tabs">
        <div className="right-tabs-views" role="tablist" aria-label="Inspector views">
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
                className={`right-tab ${selected ? "active" : ""}`}
                onClick={() => setTab(item.id)}
              >
                <Icon size={15} />
              </button>
            );
          })}
        </div>
        {platform !== "darwin" ? <WindowControls /> : null}
      </div>
      <div className="right-content">
        {!page ? <div className="empty-hint small"><p>Open a page to see its details.</p></div> : null}
        {page && tab === "outline" ? (
          <div className="outline-panel">
            <div className="sidebar-section-heading"><span>On this page</span></div>
            {outline.length === 0 ? (
              <div className="empty-hint small"><p>Add headings and they will appear here.</p></div>
            ) : (
              <nav aria-label="Page outline" className="outline-list">
                {outline.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="outline-item"
                    style={{ paddingLeft: 10 + Math.max(0, item.level - 1) * 13 }}
                    onClick={() => editorBridge.get(page.id)?.scrollToBlock(item.id)}
                    title={item.text}
                  >
                    <span className="outline-level" aria-hidden="true">{item.level}</span>
                    <span>{item.text}</span>
                  </button>
                ))}
              </nav>
            )}
          </div>
        ) : null}
        {page && tab === "backlinks" ? (
          <div className="backlinks-panel">
            <div className="sidebar-section-heading"><span>Linked from</span></div>
            {backlinks.length === 0 ? (
              <div className="empty-hint small"><p>No pages link here yet. Use “Link to page” from the slash menu.</p></div>
            ) : (
              <div className="backlink-list">
                {backlinks.map((item) => (
                  <button key={item.id} type="button" className="backlink-item" onClick={() => void selectPage(item.id)} title={item.title}>
                    <ArrowUpRight size={13} />
                    <span>{item.title}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
        {page && tab === "info" ? (
          <div className="info-panel">
            <div className="sidebar-section-heading"><span>Page info</span></div>
            <dl className="info-list">
              <div><dt>Title</dt><dd>{page.title}</dd></div>
              <div><dt>Page ID</dt><dd className="mono" title={page.id}>{page.id}</dd></div>
              <div><dt>Workspace</dt><dd>{workspace?.name ?? "—"}</dd></div>
              <div><dt>Words</dt><dd>{liveWords}</dd></div>
              <div><dt>Blocks</dt><dd>{liveBlocks}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(page.createdAt)}</dd></div>
              <div><dt>Updated</dt><dd>{formatDate(page.updatedAt)}</dd></div>
            </dl>
            <div className="info-actions">
              <button type="button" className="secondary-button" onClick={() => void exportPage("markdown")}><ExternalLink size={14} /> Markdown</button>
              <button type="button" className="secondary-button" onClick={() => void exportPage("json")}><ExternalLink size={14} /> JSON</button>
              <button type="button" className="secondary-button" onClick={() => void useAppStore.getState().reloadPage(page.id)}><RefreshCw size={14} /> Reload</button>
            </div>
          </div>
        ) : null}
        {pluginPanels.length > 0 ? (
          <div className="plugin-panels">
            <div className="sidebar-section-heading"><span>Plugin panels</span></div>
            {pluginPanels.map((panel) => (
              <section className="plugin-panel" key={`${panel.pluginId}:${panel.panelId}`} title={`${panel.pluginName} · ${panel.title}`}>
                <h4>{panel.title}</h4>
                <p>{panel.text}</p>
              </section>
            ))}
          </div>
        ) : null}
      </div>
    </aside>
  );
}

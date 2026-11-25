import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, ReactNode } from "react";
import { ArrowUpRight, ExternalLink, Info, Link2, List, MessagesSquare, PanelBottom, PanelTop, RefreshCw, SquareSplitVertical } from "lucide-react";
import { AssistantPanel } from "../assistant/AssistantPanel";
import { api, errorMessage } from "../lib/api";
import { editorBridge } from "../lib/editorBridge";
import { formatDate } from "../lib/format";
import { useAppStore } from "../store";
import { pluginRuntime } from "../plugins/runtime";
import { Markdown } from "../lib/markdownView";
import { openMarkdownLink } from "../lib/links";
import { BUILTIN_SIDEBAR_TAB_INFO, useContributions } from "../lib/contributions";
import type { SidebarTabContribution } from "../lib/contributions";
import { useCustomizations } from "../lib/customizations";
import type { SidebarGroup } from "../lib/customizations";
import { MAX_SIDEBAR_GROUPS, activateSidebarTab, availableTabs, groupOfTab, moveSidebarTab, resizeSidebarGroups, resolveSidebar } from "../lib/sidebarLayout";
import { Popover } from "./database/Popover";
import { PageIcon } from "./PageIcon";
import { ViewFrame } from "./ViewFrame";

const BUILTIN_ICONS: Record<string, typeof List> = { outline: List, backlinks: Link2, info: Info, assistant: MessagesSquare };
const TAB_MIME = "application/x-noteral-sidebar-tab";
const ASSISTANT_WIDTH_KEY = "noteral.assistantWidth";

function readAssistantWidth() {
  try {
    const value = Number(localStorage.getItem(ASSISTANT_WIDTH_KEY));
    return Number.isFinite(value) && value >= 320 ? Math.min(640, value) : 400;
  } catch {
    return 400;
  }
}

interface TabMeta {
  key: string;
  title: string;
  icon: ReactNode;
  contribution?: SidebarTabContribution;
}

function tabMeta(key: string, contributed: Map<string, SidebarTabContribution>): TabMeta {
  const builtin = BUILTIN_SIDEBAR_TAB_INFO[key];
  if (builtin) {
    const Icon = BUILTIN_ICONS[key] ?? List;
    return { key, title: builtin.title, icon: <Icon size={15} /> };
  }
  const tab = contributed.get(key);
  const title = tab?.title ?? key;
  const letter = <span className="right-tab-letter" aria-hidden="true">{title.trim().charAt(0).toUpperCase() || "?"}</span>;
  return { key, title, contribution: tab, icon: <PageIcon value={tab?.icon ?? ""} size={15} fallback={letter} /> };
}

function draggedTab(event: ReactDragEvent): boolean {
  return event.dataTransfer.types.includes(TAB_MIME);
}

export function RightSidebar() {
  const open = useAppStore((state) => state.settings.rightOpen);
  const width = useAppStore((state) => state.settings.rightWidth);
  const focused = useAppStore((state) => state.rightTab);
  const setFocused = useAppStore((state) => state.setRightTab);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const persistSettings = useAppStore((state) => state.persistSettingsNow);
  const snapshot = useContributions();
  const doc = useCustomizations();
  const [assistantWidth, setAssistantWidth] = useState(readAssistantWidth);
  const [menu, setMenu] = useState<{ key: string; anchor: HTMLElement } | null>(null);
  const [dragging, setDragging] = useState(false);
  const [dropAt, setDropAt] = useState<{ group: number; index: number } | null>(null);
  const resizing = useRef<{ x: number; width: number; assistant: boolean } | null>(null);
  const splitDrag = useRef<{ y: number; index: number; heights: number[] } | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const groupRefs = useRef<(HTMLElement | null)[]>([]);

  const contributed = useMemo(() => new Map(snapshot.sidebarTabs.map((tab) => [tab.key, tab])), [snapshot.sidebarTabs]);
  const available = useMemo(() => availableTabs(snapshot.sidebarTabs.map((tab) => tab.key)), [snapshot.sidebarTabs]);
  const groups = useMemo(() => resolveSidebar(doc.sidebar, available), [doc.sidebar, available]);
  const assistant = groups.some((group) => group.active === "assistant");

  // The store's rightTab is the tab other parts of the app asked for (e.g. "open the assistant").
  useEffect(() => {
    if (!focused || !available.includes(focused)) return;
    const group = groups[groupOfTab(groups, focused)];
    if (group && group.active !== focused) activateSidebarTab(focused, available);
  }, [focused, available, groups]);

  useEffect(() => {
    const onMove = (event: PointerEvent) => {
      const split = splitDrag.current;
      if (split) {
        const delta = event.clientY - split.y;
        const heights = [...split.heights];
        const a = split.index;
        const total = heights[a] + heights[a + 1];
        heights[a] = Math.max(90, Math.min(total - 90, split.heights[a] + delta));
        heights[a + 1] = total - heights[a];
        const sum = heights.reduce((acc, value) => acc + value, 0) || 1;
        resizeSidebarGroups(heights.map((value) => value / sum), available);
        return;
      }
      const start = resizing.current;
      if (!start) return;
      const delta = start.x - event.clientX;
      if (start.assistant) setAssistantWidth(Math.round(Math.max(320, Math.min(640, start.width + delta))));
      else updateSettings({ rightWidth: Math.max(240, Math.min(900, start.width + delta)) }, false);
    };
    const onUp = () => {
      if (splitDrag.current) {
        splitDrag.current = null;
        document.body.classList.remove("resizing", "resizing-rows");
        return;
      }
      const start = resizing.current;
      if (!start) return;
      resizing.current = null;
      document.body.classList.remove("resizing");
      if (start.assistant) {
        const value = Math.round(asideRef.current?.getBoundingClientRect().width ?? 400);
        try {
          localStorage.setItem(ASSISTANT_WIDTH_KEY, String(value));
        } catch {
          /* per-viewer convenience only */
        }
      } else void persistSettings();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, [updateSettings, persistSettings, available]);

  if (!open) return null;

  const select = (key: string) => {
    activateSidebarTab(key, available);
    setFocused(key);
  };

  const move = (key: string, group: number, index?: number) => {
    try {
      moveSidebarTab(key, group, index, available);
      setFocused(key);
    } catch (error) {
      useAppStore.getState().notify(errorMessage(error), "error");
    }
  };

  const onStripDragOver = (event: ReactDragEvent<HTMLElement>, groupIndex: number) => {
    if (!draggedTab(event)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const buttons = [...event.currentTarget.querySelectorAll<HTMLElement>("[data-tab-key]")];
    let index = buttons.length;
    for (let i = 0; i < buttons.length; i++) {
      const rect = buttons[i].getBoundingClientRect();
      if (event.clientX < rect.left + rect.width / 2) {
        index = i;
        break;
      }
    }
    setDropAt({ group: groupIndex, index });
  };

  const onStripDrop = (event: ReactDragEvent<HTMLElement>, groupIndex: number) => {
    const key = event.dataTransfer.getData(TAB_MIME);
    setDropAt(null);
    setDragging(false);
    if (!key) return;
    event.preventDefault();
    const target = dropAt?.group === groupIndex ? dropAt.index : undefined;
    const from = groupOfTab(groups, key);
    // Indexes after the tab's own position shift by one once it is taken out.
    const own = from === groupIndex ? groups[from].tabs.indexOf(key) : -1;
    move(key, groupIndex, target !== undefined && own >= 0 && own < target ? target - 1 : target);
  };

  const startSplitResize = (event: React.PointerEvent, index: number) => {
    const heights = groupRefs.current.slice(0, groups.length).map((node) => node?.getBoundingClientRect().height ?? 200);
    splitDrag.current = { y: event.clientY, index, heights };
    document.body.classList.add("resizing", "resizing-rows");
    event.preventDefault();
  };

  const menuTab = menu ? tabMeta(menu.key, contributed) : null;
  const menuGroup = menu ? groupOfTab(groups, menu.key) : -1;

  return (
    <aside className={`right-sidebar${assistant ? " is-assistant" : ""}${groups.length > 1 ? " is-split" : ""}`} ref={asideRef} style={{ width: assistant ? assistantWidth : width }} aria-label="Inspector">
      <div
        className="resize-handle resize-handle-right"
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize inspector"
        title="Drag to resize inspector"
        onPointerDown={(event) => {
          resizing.current = { x: event.clientX, width: asideRef.current?.getBoundingClientRect().width ?? width, assistant };
          document.body.classList.add("resizing");
        }}
      />
      {groups.map((group, groupIndex) => (
        <Fragment key={group.id}>
          {groupIndex > 0 ? (
            <div
              className="sidebar-split-handle"
              role="separator"
              aria-orientation="horizontal"
              aria-label="Resize panels"
              onPointerDown={(event) => startSplitResize(event, groupIndex - 1)}
            />
          ) : null}
          <section
            className="sidebar-group"
            ref={(node) => {
              groupRefs.current[groupIndex] = node;
            }}
            style={{ flexGrow: groups.length > 1 ? Math.max(0.05, group.size || 1) : 1 }}
            aria-label={tabMeta(group.active, contributed).title}
          >
            <div className="right-tabs">
              <div
                className={`right-tabs-views${dropAt?.group === groupIndex ? " is-drop-target" : ""}`}
                role="tablist"
                aria-label="Inspector views"
                onDragOver={(event) => onStripDragOver(event, groupIndex)}
                onDragLeave={(event) => {
                  if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropAt(null);
                }}
                onDrop={(event) => onStripDrop(event, groupIndex)}
              >
                {group.tabs.map((key, index) => {
                  const meta = tabMeta(key, contributed);
                  const selected = group.active === key;
                  return (
                    <Fragment key={key}>
                      {dropAt?.group === groupIndex && dropAt.index === index ? <span className="right-tab-caret" aria-hidden="true" /> : null}
                      <button
                        type="button"
                        role="tab"
                        data-tab-key={key}
                        aria-selected={selected}
                        aria-label={meta.title}
                        title={meta.contribution ? `${meta.title} · ${meta.contribution.owner.name}` : meta.title}
                        className={`right-tab ${selected ? "active" : ""}`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData(TAB_MIME, key);
                          event.dataTransfer.effectAllowed = "move";
                          setDragging(true);
                        }}
                        onDragEnd={() => {
                          setDragging(false);
                          setDropAt(null);
                        }}
                        onClick={() => select(key)}
                        onContextMenu={(event) => {
                          event.preventDefault();
                          setMenu({ key, anchor: event.currentTarget });
                        }}
                      >
                        {meta.icon}
                      </button>
                    </Fragment>
                  );
                })}
                {dropAt?.group === groupIndex && dropAt.index === group.tabs.length ? <span className="right-tab-caret" aria-hidden="true" /> : null}
              </div>
              {groups.length < MAX_SIDEBAR_GROUPS && group.tabs.length > 1 ? (
                <button type="button" className="right-tab right-split-button" title="Split: move this tab to a new panel below" aria-label="Split panel" onClick={() => move(group.active, -1)}>
                  <SquareSplitVertical size={14} />
                </button>
              ) : null}
            </div>
            <div className="right-content">
              <TabBody tabKey={group.active} contribution={contributed.get(group.active)} />
            </div>
          </section>
        </Fragment>
      ))}
      {dragging && groups.length < MAX_SIDEBAR_GROUPS ? (
        <div
          className="sidebar-split-drop"
          onDragOver={(event) => {
            if (!draggedTab(event)) return;
            event.preventDefault();
            event.currentTarget.classList.add("is-over");
          }}
          onDragLeave={(event) => event.currentTarget.classList.remove("is-over")}
          onDrop={(event) => {
            const key = event.dataTransfer.getData(TAB_MIME);
            setDragging(false);
            setDropAt(null);
            if (!key) return;
            event.preventDefault();
            move(key, -1);
          }}
        >
          <PanelBottom size={14} /> Drop to open in a new panel
        </div>
      ) : null}
      {menu && menuTab ? (
        <Popover anchor={menu.anchor} onClose={() => setMenu(null)} width={220} label={`${menuTab.title} tab`}>
          <div className="db-menu">
            <div className="db-menu-label">{menuTab.title}{menuTab.contribution ? <small> · {menuTab.contribution.owner.name}</small> : null}</div>
            {groups.length < MAX_SIDEBAR_GROUPS && groups[menuGroup]?.tabs.length > 1 ? (
              <button type="button" className="db-menu-item" onClick={() => { setMenu(null); move(menu.key, -1); }}>
                <SquareSplitVertical size={14} /> Open in new panel below
              </button>
            ) : null}
            {menuGroup > 0 ? (
              <button type="button" className="db-menu-item" onClick={() => { setMenu(null); move(menu.key, menuGroup - 1); }}>
                <PanelTop size={14} /> Move to panel above
              </button>
            ) : null}
            {menuGroup >= 0 && menuGroup < groups.length - 1 ? (
              <button type="button" className="db-menu-item" onClick={() => { setMenu(null); move(menu.key, menuGroup + 1); }}>
                <PanelBottom size={14} /> Move to panel below
              </button>
            ) : null}
            {groups.length > 1 ? (
              <button type="button" className="db-menu-item" onClick={() => { setMenu(null); mergeAll(groups, available); }}>
                <List size={14} /> Merge all panels
              </button>
            ) : null}
          </div>
        </Popover>
      ) : null}
    </aside>
  );
}

function mergeAll(groups: SidebarGroup[], available: readonly string[]) {
  const first = groups[0];
  for (const group of groups.slice(1)) for (const key of group.tabs) moveSidebarTab(key, 0, undefined, available);
  if (first) activateSidebarTab(first.active, available);
}

function TabBody({ tabKey, contribution }: { tabKey: string; contribution?: SidebarTabContribution }) {
  if (tabKey === "assistant") return <AssistantPanel />;
  if (BUILTIN_SIDEBAR_TAB_INFO[tabKey]) return <BuiltinPanel tab={tabKey} />;
  if (!contribution) return <div className="empty-hint small"><p>This tab is not available right now.</p></div>;
  const { view, owner } = contribution;
  if (view.html) {
    return (
      <ViewFrame
        surface="sidebar"
        key={contribution.key}
        viewKey={contribution.key}
        html={view.html}
        owner={owner}
        permissions={contribution.permissions}
        fill
        className="sidebar-view-frame"
        title={contribution.title}
      />
    );
  }
  return (
    <div className="sidebar-markdown-tab">
      <div className="sidebar-section-heading"><span>{contribution.title}</span></div>
      <div className="plugin-panel">
        <Markdown source={view.markdown ?? ""} className="plugin-panel-body" onLink={openMarkdownLink} />
        {view.actions?.length && owner.kind === "plugin" ? (
          <div className="plugin-panel-actions">
            {view.actions.map((action) => (
              <button key={action.id} type="button" className="secondary-button" onClick={() => pluginRuntime.panelAction(owner.id, contribution.id, action.id)}>
                {action.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function BuiltinPanel({ tab }: { tab: string }) {
  const outline = useAppStore((state) => state.outline);
  const backlinks = useAppStore((state) => state.backlinks);
  const activeId = useAppStore((state) => state.activePageId);
  const page = useAppStore((state) => state.documents[state.activePageId]);
  const workspace = useAppStore((state) => state.workspace);
  const liveWords = useAppStore((state) => state.liveWordCount);
  const liveBlocks = useAppStore((state) => state.liveBlockCount);
  const selectPage = useAppStore((state) => state.selectPage);
  const notify = useAppStore((state) => state.notify);

  async function exportPage(kind: "json" | "markdown") {
    if (!workspace || !activeId) return;
    try {
      const result = kind === "json" ? await api.exportJson(workspace.id, activeId) : await api.exportMarkdown(workspace.id, activeId);
      if (result) notify(`Exported to ${result.path}`, "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  if (!page) return <div className="empty-hint small"><p>Open a page to see its details.</p></div>;
  return (
    <>
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
    </>
  );
}

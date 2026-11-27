import { ContributedMenuItems, contributedMenuEntries } from "./ContributedMenuItems";
import { popups, type PopupMenuItem } from "../lib/popups";
import { dialogs } from "../lib/dialogs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  Columns2,
  House,
  Maximize2,
  Minimize2,
  Plus,
  Rows2,
  X,
} from "lucide-react";
import { HOME_TEMPLATE_LABELS } from "../lib/home";
import {
  beginTabDrag,
  endTabDrag,
  hasTabDrag,
  readTabDrag,
  writeTabDrag,
} from "../lib/dragTab";
import { paneList, type PaneNode } from "../lib/panes";
import { isHomeTab, isVirtualTab, isWebTab, kindOf, useAppStore } from "../store";
import { useBrowserStore } from "../browser/store";
import { WebTabIcon } from "../browser/WebTabIcon";
import { PageIcon } from "./PageIcon";
import { KindIcon } from "./KindIcon";

interface TabStripProps {
  pane: PaneNode;
}

/** Show a page in the left sidebar's tree (it expands to the active page by itself). */
function revealInTree(pageId: string) {
  const state = useAppStore.getState();
  state.selectTab(pageId);
  state.setLeftTab("tree");
  if (!state.settings.leftOpen) state.updateSettings({ leftOpen: true });
  window.setTimeout(() => {
    const row = document.querySelector<HTMLElement>(`[data-tree-id="${CSS.escape(pageId)}"]`);
    row?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, 120);
}

/**
 * The tab bar of a single pane. Tabs can be reordered inside the pane, moved
 * into another pane, or dropped on a pane edge (handled by the pane body) to
 * create a new split.
 */
export function TabStrip({ pane }: TabStripProps) {
  const pages = useAppStore((state) => state.pages);
  const homeTabs = useAppStore((state) => state.homeTabs);
  const webTabs = useBrowserStore((state) => state.data.tabs);
  const layout = useAppStore((state) => state.layout);
  const maximizedPaneId = useAppStore((state) => state.maximizedPaneId);
  const selectTab = useAppStore((state) => state.selectTab);
  const closeTab = useAppStore((state) => state.closeTab);
  const openHomeTab = useAppStore((state) => state.openHomeTab);
  const moveTab = useAppStore((state) => state.moveTab);
  const splitPane = useAppStore((state) => state.splitPane);
  const toggleMaximize = useAppStore((state) => state.toggleMaximize);
  const closePane = useAppStore((state) => state.closePane);

  const [dragging, setDragging] = useState("");
  const [caret, setCaret] = useState<{ beforeTabId: string | null } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; left: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef(new Map<string, HTMLDivElement>());
  const stripRef = useRef<HTMLDivElement | null>(null);

  const panes = useMemo(() => paneList(layout), [layout]);
  const pageById = useMemo(() => new Map(pages.map((page) => [page.id, page])), [pages]);
  const paneCount = panes.length;
  const paneIndex = Math.max(0, panes.findIndex((item) => item.id === pane.id));
  const isMaximized = maximizedPaneId === pane.id;
  const dropAfterLast = caret !== null && caret.beforeTabId === null;

  const toggleMenu = () => {
    if (menuOpen) {
      setMenuOpen(false);
      return;
    }
    const anchor = anchorRef.current;
    if (!anchor) return;
    // Fixed positioning keeps the menu out of the pane's overflow and lets it
    // choose the side with room instead of running off the window.
    const rect = anchor.getBoundingClientRect();
    const width = 220;
    const margin = 8;
    const preferredLeft = rect.right >= width + margin ? rect.right - width : rect.left;
    setMenuPos({
      top: Math.min(rect.bottom + 6, window.innerHeight - 96),
      left: Math.max(margin, Math.min(preferredLeft, window.innerWidth - width - margin)),
    });
    setMenuOpen(true);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (anchorRef.current?.contains(target) || menuRef.current?.contains(target)) return;
      setMenuOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    const onResize = () => setMenuOpen(false);
    window.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
    };
  }, [menuOpen]);

  const openTabMenu = (event: { clientX: number; clientY: number; preventDefault: () => void }, tabId: string) => {
    const state = useAppStore.getState();
    const page = isVirtualTab(tabId) ? undefined : pageById.get(tabId);
    const index = pane.tabs.indexOf(tabId);
    const closable = (id: string) => !(isHomeTab(id) && paneCount === 1 && pane.tabs.length === 1);
    const others = pane.tabs.filter((id) => id !== tabId);
    const right = pane.tabs.slice(index + 1);
    const closeMany = async (ids: string[]) => {
      for (const id of ids) if (closable(id)) await closeTab(id);
    };
    const moveToSplit = (side: "right" | "bottom") => {
      splitPane(pane.id, side);
      const after = useAppStore.getState();
      const target = paneList(after.layout).find((item) => item.id === after.focusedPaneId);
      if (!target || target.id === pane.id) return;
      const placeholder = target.tabs[0];
      moveTab(tabId, target.id, null);
      if (placeholder && placeholder !== tabId) void closeTab(placeholder);
      selectTab(tabId);
    };
    const otherPanes = panes.filter((item) => item.id !== pane.id);
    const favorite = page ? state.favorites.includes(page.id) : false;
    const items: PopupMenuItem[] = [
      { id: "close", label: "Close", icon: "x", hint: "Ctrl+W", disabled: !closable(tabId), run: () => void closeTab(tabId) },
      { id: "close-others", label: "Close others", disabled: !others.length, run: () => void closeMany(others) },
      { id: "close-right", label: "Close tabs to the right", disabled: !right.length, run: () => void closeMany(right) },
      { id: "close-all", label: "Close all", disabled: pane.tabs.length < 2 && !closable(tabId), run: () => void closeMany([...pane.tabs]) },
      { type: "separator" },
      { id: "split-right", label: "Move to split right", icon: "columns-2", disabled: pane.tabs.length < 2, run: () => moveToSplit("right") },
      { id: "split-down", label: "Move to split down", icon: "rows-2", disabled: pane.tabs.length < 2, run: () => moveToSplit("bottom") },
      ...(otherPanes.length
        ? [{
            label: "Move to pane",
            icon: "panels-top-left",
            children: otherPanes.map((item) => ({
              id: `pane:${item.id}`,
              label: `Pane ${panes.indexOf(item) + 1}${item.activeTabId ? ` · ${titleFor(item.activeTabId)}` : ""}`,
              run: () => {
                moveTab(tabId, item.id, null);
                selectTab(tabId);
              },
            })),
          } satisfies PopupMenuItem]
        : []),
      { id: "new-tab", label: "New tab", icon: "plus", hint: "Ctrl+T", run: () => openHomeTab(undefined, pane.id) },
      { id: "new-browser-tab", label: "New browser tab", icon: "globe", run: () => void useBrowserStore.getState().open("", { paneId: pane.id }) },
    ];
    if (isWebTab(tabId)) {
      const browser = useBrowserStore.getState();
      const location = browser.tab(tabId).entries[browser.tab(tabId).index] ?? "";
      if (/^https?:/i.test(location)) {
        items.push(
          { type: "separator" },
          { id: "web-copy", label: "Copy address", icon: "link", run: () => void navigator.clipboard?.writeText(location) },
          { id: "web-duplicate", label: "Duplicate tab", icon: "copy", run: () => void browser.open(location, { paneId: pane.id }) },
        );
      }
    }
    if (page) {
      items.push(
        { type: "separator" },
        { id: "favorite", label: favorite ? "Remove from favorites" : "Add to favorites", icon: "star", run: () => void state.toggleFavorite(page.id) },
        {
          id: "rename",
          label: "Rename…",
          icon: "pencil",
          run: () => {
            void dialogs.prompt({ title: "Rename page", value: page.title, placeholder: "Untitled" }).then((title) => {
              if (title !== null && title.trim() !== page.title) void state.renamePage(page.id, title.trim());
            });
          },
        },
        { id: "duplicate", label: "Duplicate", icon: "copy", run: () => void state.duplicatePage(page.id, { open: true }) },
        { id: "copy-link", label: "Copy link", icon: "link", run: () => void navigator.clipboard?.writeText(`noteral://page/${page.id}`) },
        { id: "copy-title", label: "Copy title", icon: "type", run: () => void navigator.clipboard?.writeText(page.title || "Untitled") },
        { id: "reveal", label: "Reveal in sidebar", icon: "folder-tree", run: () => revealInTree(page.id) },
      );
    }
    const contributed = contributedMenuEntries({ menu: "tabItem", tabKey: tabId, ...(page ? { pageId: page.id, kind: page.kind ?? "page" } : {}) });
    if (contributed.length) items.push({ type: "separator" }, ...contributed);
    if (page) items.push({ type: "separator" }, { id: "trash", label: "Move to trash", icon: "trash-2", danger: true, run: () => void state.trashPage(page.id) });
    void popups.contextMenu(event, items, { width: 230 });
  };

  const titleFor = useCallback(
    (tabId: string) => {
      if (isHomeTab(tabId)) {
        const settings = homeTabs[tabId];
        return (settings ? HOME_TEMPLATE_LABELS[settings.template] : "") || "Home";
      }
      if (isWebTab(tabId)) return webTabs[tabId]?.title || "New tab";
      return pages.find((page) => page.id === tabId)?.title || "Untitled";
    },
    [homeTabs, pages, webTabs],
  );

  const focusTab = useCallback(
    (index: number) => {
      const tabId = pane.tabs[index];
      if (!tabId) return;
      const focus = () => tabRefs.current.get(tabId)?.focus();
      if (tabRefs.current.has(tabId)) focus();
      else requestAnimationFrame(focus);
    },
    [pane.tabs],
  );

  const onTabKeyDown = (event: ReactKeyboardEvent, index: number) => {
    switch (event.key) {
      case "ArrowLeft":
        event.preventDefault();
        focusTab(Math.max(0, index - 1));
        break;
      case "ArrowRight":
        event.preventDefault();
        focusTab(Math.min(pane.tabs.length - 1, index + 1));
        break;
      case "Home":
        event.preventDefault();
        focusTab(0);
        break;
      case "End":
        event.preventDefault();
        focusTab(pane.tabs.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        selectTab(pane.tabs[index]);
        break;
      default:
        break;
    }
  };

  const onTabDragStart = (event: ReactDragEvent, tabId: string) => {
    beginTabDrag(tabId);
    writeTabDrag(event.dataTransfer, tabId);
    setDragging(tabId);
  };

  const onTabDragEnd = () => {
    endTabDrag();
    setDragging("");
    setCaret(null);
  };

  const onTabDragOver = (event: ReactDragEvent, index: number) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const after = event.clientX > rect.left + rect.width / 2;
    setCaret({ beforeTabId: after ? pane.tabs[index + 1] ?? null : pane.tabs[index] });
  };

  const onTabDrop = (event: ReactDragEvent) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    const tabId = readTabDrag(event.dataTransfer);
    const before = caret?.beforeTabId ?? null;
    setCaret(null);
    setDragging("");
    if (!tabId || tabId === before) return;
    moveTab(tabId, pane.id, before);
  };

  // Dropping on the empty part of the strip appends to the end of the pane.
  const onStripDragOver = (event: ReactDragEvent) => {
    if (!hasTabDrag(event.dataTransfer)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    setCaret({ beforeTabId: null });
  };

  const onStripDragLeave = (event: ReactDragEvent) => {
    const next = event.relatedTarget as Node | null;
    if (next && event.currentTarget.contains(next)) return;
    setCaret(null);
  };

  return (
    <div className="pane-tabs">
      <div
        className="tab-strip"
        role="tablist"
        aria-label={paneCount > 1 ? `Tabs in pane ${paneIndex + 1}` : "Tabs"}
        onDragEnd={onTabDragEnd}
      >
        <div
          className="tab-strip-tabs"
          ref={stripRef}
          onDragOver={onStripDragOver}
          onDragLeave={onStripDragLeave}
          onDrop={onTabDrop}
        >
          {pane.tabs.map((tabId, index) => {
            const selected = pane.activeTabId === tabId;
            const home = isHomeTab(tabId);
            const canClose = !(home && paneCount === 1 && pane.tabs.length === 1);
            const dropBefore = caret !== null && caret.beforeTabId === tabId;
            const dropAfter = dropAfterLast && index === pane.tabs.length - 1;
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
                draggable
                title={home ? "Home" : titleFor(tabId)}
                className={[
                  "tab",
                  home ? "tab-home" : "",
                  selected ? "active" : "",
                  dragging === tabId ? "dragging" : "",
                  dropBefore ? "drop-before" : "",
                  dropAfter ? "drop-after" : "",
                ]
                  .filter(Boolean)
                  .join(" ")}
                onClick={() => selectTab(tabId)}
                onContextMenu={(event) => openTabMenu(event, tabId)}
                onAuxClick={(event) => {
                  if (event.button === 1 && canClose) {
                    event.preventDefault();
                    void closeTab(tabId);
                  }
                }}
                onKeyDown={(event) => onTabKeyDown(event, index)}
                onDragStart={(event) => onTabDragStart(event, tabId)}
                onDragOver={(event) => onTabDragOver(event, index)}
                onDrop={onTabDrop}
              >
                {home ? (
                  <House size={13} className="tab-home-icon" />
                ) : isWebTab(tabId) ? (
                  <WebTabIcon tabId={tabId} />
                ) : (
                  <span className="tab-icon" aria-hidden="true">
                    <PageIcon value={pageById.get(tabId)?.icon} size={13} fallback={<KindIcon page={pageById.get(tabId)} size={13} />} />
                  </span>
                )}
                <span className="tab-title">{titleFor(tabId)}</span>
                {canClose ? (
                  <button
                    type="button"
                    className="tab-close"
                    tabIndex={-1}
                    aria-label={`Close ${titleFor(tabId)}`}
                    title="Close tab (Ctrl+W)"
                    onClick={(event) => {
                      event.stopPropagation();
                      void closeTab(tabId);
                    }}
                  >
                    <X size={13} />
                  </button>
                ) : null}
              </div>
            );
          })}
          <button
            type="button"
            className="icon-button tab-new"
            title="New tab (Ctrl+T)"
            aria-label="New tab"
            onClick={() => openHomeTab(undefined, pane.id)}
          >
            <Plus size={15} />
          </button>
        </div>
        <div className="tab-bar-actions">
          <button
            type="button"
            className="icon-button"
            title="Split right (Ctrl+\\)"
            aria-label="Split right"
            onClick={() => splitPane(pane.id, "right")}
          >
            <Columns2 size={15} />
          </button>
          <button
            type="button"
            className="icon-button"
            title="Split down (Ctrl+Shift+\\)"
            aria-label="Split down"
            onClick={() => splitPane(pane.id, "bottom")}
          >
            <Rows2 size={15} />
          </button>
          {paneCount > 1 ? (
            <button
              type="button"
              className={`icon-button${isMaximized ? " is-on" : ""}`}
              title={isMaximized ? "Restore panes" : "Maximize pane"}
              aria-label={isMaximized ? "Restore panes" : "Maximize pane"}
              aria-pressed={isMaximized}
              onClick={() => toggleMaximize(pane.id)}
            >
              {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
            </button>
          ) : null}
          <div className="menu-anchor" ref={anchorRef}>
            <button
              type="button"
              className={`icon-button${menuOpen ? " is-on" : ""}`}
              title="Tabs in this pane"
              aria-label="Tabs in this pane"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={toggleMenu}
            >
              <ChevronDown size={15} />
            </button>
            {menuOpen && menuPos
              ? createPortal(
                  <div
                    className="menu tab-bar-menu"
                    role="menu"
                    ref={menuRef}
                    style={{ position: "fixed", top: menuPos.top, left: menuPos.left, width: 220 }}
                  >
                    <div className="menu-actions" role="group" aria-label="Pane actions">
                      <button
                        type="button"
                        role="menuitem"
                        className="icon-button"
                        title="Split right (Ctrl+\\)"
                        aria-label="Split right"
                        onClick={() => {
                          setMenuOpen(false);
                          splitPane(pane.id, "right");
                        }}
                      >
                        <Columns2 size={15} />
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        className="icon-button"
                        title="Split down (Ctrl+Shift+\\)"
                        aria-label="Split down"
                        onClick={() => {
                          setMenuOpen(false);
                          splitPane(pane.id, "bottom");
                        }}
                      >
                        <Rows2 size={15} />
                      </button>
                      {paneCount > 1 ? (
                        <button
                          type="button"
                          role="menuitem"
                          className={`icon-button${isMaximized ? " is-on" : ""}`}
                          title={isMaximized ? "Restore panes" : "Maximize pane"}
                          aria-label={isMaximized ? "Restore panes" : "Maximize pane"}
                          onClick={() => {
                            setMenuOpen(false);
                            toggleMaximize(pane.id);
                          }}
                        >
                          {isMaximized ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
                        </button>
                      ) : null}
                      <span className="menu-actions-grow" />
                      <button
                        type="button"
                        role="menuitem"
                        className="icon-button danger"
                        title="Close pane"
                        aria-label="Close pane"
                        onClick={() => {
                          setMenuOpen(false);
                          closePane(pane.id);
                        }}
                      >
                        <X size={15} />
                      </button>
                    </div>
                    <div className="menu-separator" />
                    {pane.tabs.map((tabId) => {
                      const active = pane.activeTabId === tabId;
                      const home = isHomeTab(tabId);
                      const closable = !(home && paneCount === 1 && pane.tabs.length === 1);
                      return (
                        <div key={tabId} className="menu-item-row">
                          <button
                            type="button"
                            role="menuitemradio"
                            aria-checked={active}
                            onClick={() => {
                              setMenuOpen(false);
                              selectTab(tabId);
                            }}
                          >
                            {home ? (
                              <House size={13} className="tab-home-icon" />
                            ) : isWebTab(tabId) ? (
                              <WebTabIcon tabId={tabId} />
                            ) : (
                              <span className="tab-icon" aria-hidden="true">
                                <PageIcon value={pageById.get(tabId)?.icon} size={13} fallback={<KindIcon page={pageById.get(tabId)} size={13} />} />
                              </span>
                            )}
                            <span className="tab-menu-name">{titleFor(tabId)}</span>
                            {active ? <Check size={13} className="menu-check" /> : null}
                          </button>
                          {closable ? (
                            <button
                              type="button"
                              className="menu-item-close"
                              tabIndex={-1}
                              title="Close tab"
                              aria-label={`Close ${titleFor(tabId)}`}
                              onClick={() => {
                                setMenuOpen(false);
                                void closeTab(tabId);
                              }}
                            >
                              <X size={13} />
                            </button>
                          ) : null}
                        </div>
                      );
                    })}
                    <ContributedMenuItems
                      context={{
                        menu: "tab",
                        tabKey: pane.activeTabId,
                        pageId: pane.activeTabId && !isVirtualTab(pane.activeTabId) ? pane.activeTabId : undefined,
                        kind: pane.activeTabId && !isVirtualTab(pane.activeTabId) ? kindOf(pageById.get(pane.activeTabId)) : isWebTab(pane.activeTabId) ? "web" : "home",
                      }}
                      onDone={() => setMenuOpen(false)}
                    />
                  </div>,
                  document.body,
                )
              : null}
          </div>
        </div>
      </div>
    </div>
  );
}

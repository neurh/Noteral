import { LoaderCircle } from "lucide-react";
import { type PaneNode } from "../lib/panes";
import { isHomeTab, useAppStore } from "../store";
import { HomeView } from "./HomeView";
import { PageView } from "./PageView";

interface EditorStackProps {
  pane: PaneNode;
}

/**
 * The stacked editors of one pane. Only the pane's active tab is visible; the
 * other tabs stay mounted so their editor state (scroll, cursor, bounds) is
 * preserved while switching.
 */
export function EditorStack({ pane }: EditorStackProps) {
  const documents = useAppStore((state) => state.documents);

  return (
    <div className="editor-stack">
      {pane.tabs.map((tabId) => {
        if (isHomeTab(tabId)) {
          return pane.activeTabId === tabId ? <HomeView key={tabId} tabId={tabId} /> : null;
        }
        const page = documents[tabId];
        if (!page) {
          const active = pane.activeTabId === tabId;
          return (
            <div
              key={tabId}
              className={`page-pane page-loading${active ? " active" : ""}`}
              aria-hidden={!active}
            >
              <LoaderCircle size={20} className="spin" />
              <span>Opening page…</span>
            </div>
          );
        }
        return (
          <PageView
            key={`${page.id}:${page.loadVersion}`}
            page={page}
            active={pane.activeTabId === tabId}
          />
        );
      })}
    </div>
  );
}

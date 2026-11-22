import { LoaderCircle } from "lucide-react";
import { isHomeTab, useAppStore } from "../store";
import { HomeView } from "./HomeView";
import { PageView } from "./PageView";

export function EditorStack() {
  const tabs = useAppStore((state) => state.tabs);
  const documents = useAppStore((state) => state.documents);
  const activeTabId = useAppStore((state) => state.activeTabId);

  if (tabs.length === 0) return <HomeView />;

  return (
    <div className="editor-stack">
      {tabs.map((tabId) => {
        if (isHomeTab(tabId)) {
          return activeTabId === tabId ? <HomeView key={tabId} tabId={tabId} /> : null;
        }
        const page = documents[tabId];
        if (!page) {
          return (
            <div
              key={tabId}
              className={`page-pane page-loading ${activeTabId === tabId ? "active" : ""}`}
              aria-hidden={activeTabId !== tabId}
            >
              <LoaderCircle size={20} className="spin" />
              <span>Opening page…</span>
            </div>
          );
        }
        return <PageView key={`${page.id}:${page.loadVersion}`} page={page} active={activeTabId === tabId} />;
      })}
    </div>
  );
}

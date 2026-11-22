import { FilePlus2, LoaderCircle } from "lucide-react";
import { useAppStore } from "../store";
import { PageView } from "./PageView";

export function EditorStack() {
  const tabs = useAppStore((state) => state.tabs);
  const documents = useAppStore((state) => state.documents);
  const active = useAppStore((state) => state.activePageId);
  const createPage = useAppStore((state) => state.createPage);

  if (tabs.length === 0) {
    return (
      <div className="empty-editor" role="main">
        <div className="empty-editor-card">
          <h1>Make room for a thought.</h1>
          <p>Pages are local, quick, and yours. Start with a blank page or open one from the sidebar.</p>
          <button type="button" className="primary-button" onClick={() => void createPage()}>
            <FilePlus2 size={16} /> New page
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="editor-stack" role="main">
      {tabs.map((pageId) => {
        const page = documents[pageId];
        if (!page) {
          return (
            <div key={pageId} className="page-pane page-loading" aria-hidden={active !== pageId}>
              <LoaderCircle size={20} className="spin" />
              <span>Opening page…</span>
            </div>
          );
        }
        return <PageView key={`${page.id}:${page.loadVersion}`} page={page} active={active === pageId} />;
      })}
    </div>
  );
}

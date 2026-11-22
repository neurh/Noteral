import { useEffect, useRef, useState } from "react";
import { ArrowLeft, ArrowRight, Check, Copy, Download, FilePlus2, Maximize2, MoreHorizontal, Pencil, Star, Trash2 } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { editorBridge } from "../lib/editorBridge";
import { useAppStore } from "../store";

export function PageHeader() {
  const activeId = useAppStore((state) => state.activePageId);
  const page = useAppStore((state) => state.pages.find((item) => item.id === activeId) ?? null);
  const favorite = useAppStore((state) => state.favorites.includes(activeId));
  const history = useAppStore((state) => state.history);
  const historyIndex = useAppStore((state) => state.historyIndex);
  const workspace = useAppStore((state) => state.workspace);
  const goBack = useAppStore((state) => state.goBack);
  const goForward = useAppStore((state) => state.goForward);
  const toggleFavorite = useAppStore((state) => state.toggleFavorite);
  const createPage = useAppStore((state) => state.createPage);
  const duplicatePage = useAppStore((state) => state.duplicatePage);
  const trashPage = useAppStore((state) => state.trashPage);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const fullWidth = useAppStore((state) => state.settings.fullWidth);
  const notify = useAppStore((state) => state.notify);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchor = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMenuOpen(false);
  }, [activeId]);

  useEffect(() => {
    if (!menuOpen) return;
    const closeOutside = (event: MouseEvent) => {
      if (menuAnchor.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("mousedown", closeOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("mousedown", closeOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [menuOpen]);

  function focusTitle() {
    setMenuOpen(false);
    if (!activeId) return;
    editorBridge.get(activeId)?.focusTitle();
  }

  async function exportPage(kind: "json" | "markdown") {
    setMenuOpen(false);
    if (!workspace || !activeId) return;
    try {
      const result = kind === "json" ? await api.exportJson(workspace.id, activeId) : await api.exportMarkdown(workspace.id, activeId);
      if (result) notify(`Exported to ${result.path}`, "success");
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  const canBack = historyIndex > 0;
  const canForward = historyIndex < history.length - 1;
  const title = page?.title || "Untitled";

  return (
    <header className="page-header" aria-label="Page navigation">
      <div className="page-header-left">
        <button
          type="button"
          className="icon-button"
          aria-label="Go back"
          title="Go back (Alt+← or ⌘[)"
          disabled={!canBack}
          onClick={goBack}
        >
          <ArrowLeft size={16} />
        </button>
        <button
          type="button"
          className="icon-button"
          aria-label="Go forward"
          title="Go forward (Alt+→ or ⌘])"
          disabled={!canForward}
          onClick={goForward}
        >
          <ArrowRight size={16} />
        </button>
      </div>

      {page ? (
        <button type="button" className="page-header-title" title={`${title} — click to rename`} onClick={focusTitle}>
          <span className="page-header-title-text">{title}</span>
        </button>
      ) : (
        <span className="page-header-title is-empty">No page open</span>
      )}

      <div className="page-header-right">
        {page ? (
          <>
            <button
              type="button"
              className={`icon-button page-header-favorite ${favorite ? "on" : ""}`}
              aria-label={favorite ? `Remove ${title} from favorites` : `Add ${title} to favorites`}
              aria-pressed={favorite}
              title={favorite ? "Remove favorite" : "Add favorite"}
              onClick={() => void toggleFavorite(page.id)}
            >
              <Star size={16} fill={favorite ? "currentColor" : "none"} />
            </button>
            <div className="page-header-menu-anchor" ref={menuAnchor}>
              <button
                type="button"
                className="icon-button"
                aria-label="Page actions"
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                title="Page actions"
                onClick={() => setMenuOpen((open) => !open)}
              >
                <MoreHorizontal size={17} />
              </button>
              {menuOpen ? (
                <div className="menu page-header-menu" role="menu" aria-label={`Actions for ${title}`}>
                  <button type="button" role="menuitem" onClick={focusTitle}><Pencil size={14} /> Rename</button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void toggleFavorite(page.id); }}>
                    <Star size={14} /> {favorite ? "Remove favorite" : "Add favorite"}
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void createPage(page.id); }}>
                    <FilePlus2 size={14} /> New child page
                  </button>
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); void duplicatePage(page.id); }}>
                    <Copy size={14} /> Duplicate
                  </button>
                  <div className="menu-separator" />
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={fullWidth}
                    onClick={() => updateSettings({ fullWidth: !fullWidth })}
                  >
                    <Maximize2 size={14} /> Full width
                    <span className="menu-check" aria-hidden="true">{fullWidth ? <Check size={13} /> : null}</span>
                  </button>
                  <div className="menu-separator" />
                  <button type="button" role="menuitem" onClick={() => void exportPage("markdown")}><Download size={14} /> Export Markdown</button>
                  <button type="button" role="menuitem" onClick={() => void exportPage("json")}><Download size={14} /> Export JSON</button>
                  <div className="menu-separator" />
                  <button
                    type="button"
                    role="menuitem"
                    className="danger"
                    onClick={() => {
                      setMenuOpen(false);
                      void trashPage(page.id);
                    }}
                  >
                    <Trash2 size={14} /> Move to trash
                  </button>
                </div>
              ) : null}
            </div>
          </>
        ) : null}
      </div>
    </header>
  );
}

import { ChevronDown, ChevronUp, Maximize2, PanelRight, PictureInPicture2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useRowPeek } from "../../lib/rowPeek";
import { useAppStore } from "../../store";
import { PageIcon } from "../PageIcon";
import { PageView } from "../PageView";

/**
 * Shows a database row page over the app: a centered window ("Center peek")
 * or a panel on the right ("Side peek"). Mounted once, in App.
 */
export function RowPeekHost() {
  const { rowId, mode, siblings, open, setMode, close } = useRowPeek();
  const page = useAppStore((state) => (rowId ? state.documents[rowId] : undefined));
  const meta = useAppStore((state) => (rowId ? state.pages.find((item) => item.id === rowId) : undefined));
  const inTab = useAppStore((state) => (rowId ? state.tabs.includes(rowId) : false));
  const parent = useAppStore((state) => (meta?.parentId ? state.pages.find((item) => item.id === meta.parentId) : undefined));
  const panel = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<Element | null>(null);

  // Close when the row is deleted or opened in a tab elsewhere.
  useEffect(() => {
    if (rowId && (!meta || inTab)) close();
  }, [rowId, meta, inTab, close]);

  useEffect(() => {
    if (!rowId) return;
    restoreFocus.current = document.activeElement;
    return () => {
      const target = restoreFocus.current;
      if (target instanceof HTMLElement && target.isConnected) target.focus();
    };
  }, [rowId]);

  const index = siblings.indexOf(rowId);
  const step = (delta: number) => {
    const next = siblings[index + delta];
    if (next) void useAppStore.getState().ensurePageLoaded(next).then((loaded) => loaded && open(next, mode));
  };

  useEffect(() => {
    if (!rowId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        // Let open menus and dialogs inside the page close first.
        const target = event.target as HTMLElement | null;
        if (target?.closest(".bn-container [role=menu], .popover, .modal")) return;
        event.preventDefault();
        close();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rowId, close]);

  if (!rowId || !page || !meta) return null;

  const openFull = () => {
    close();
    void useAppStore.getState().selectPage(rowId);
  };

  const content = (
    <div
      className={`row-peek is-${mode}`}
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div ref={panel} className="row-peek-panel" role="dialog" aria-modal={mode === "modal"} aria-label={meta.title || "Untitled"}>
        <div className="row-peek-bar">
          <div className="row-peek-nav">
            <button type="button" className="icon-button tiny" aria-label="Previous row" title="Previous row" disabled={index <= 0} onClick={() => step(-1)}>
              <ChevronUp size={15} />
            </button>
            <button type="button" className="icon-button tiny" aria-label="Next row" title="Next row" disabled={index < 0 || index >= siblings.length - 1} onClick={() => step(1)}>
              <ChevronDown size={15} />
            </button>
          </div>
          <div className="row-peek-crumb">
            {parent ? (
              <>
                <PageIcon value={parent.icon} size={14} />
                <span className="row-peek-parent">{parent.title || "Untitled"}</span>
                <span className="row-peek-sep">/</span>
              </>
            ) : null}
            <span className="row-peek-title">{meta.title || "Untitled"}</span>
          </div>
          <div className="row-peek-actions">
            <button
              type="button"
              className="icon-button tiny"
              aria-label={mode === "modal" ? "Switch to side peek" : "Switch to center peek"}
              title={mode === "modal" ? "Side peek" : "Center peek"}
              onClick={() => setMode(mode === "modal" ? "side" : "modal")}
            >
              {mode === "modal" ? <PanelRight size={15} /> : <PictureInPicture2 size={15} />}
            </button>
            <button type="button" className="icon-button tiny" aria-label="Open as full page" title="Open as full page" onClick={openFull}>
              <Maximize2 size={14} />
            </button>
            <button type="button" className="icon-button tiny" aria-label="Close" title="Close (Esc)" onClick={close}>
              <X size={15} />
            </button>
          </div>
        </div>
        <div className="row-peek-body">
          <PageView key={`${page.id}:${page.loadVersion}`} page={page} active />
        </div>
      </div>
    </div>
  );
  return createPortal(content, document.body);
}

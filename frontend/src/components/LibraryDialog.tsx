import { useEffect, useMemo, useState } from "react";
import { FileText, LoaderCircle, Search } from "lucide-react";
import { api, list, type SearchHit } from "../lib/api";
import { splitSnippet } from "../lib/format";
import { useAppStore } from "../store";
import { Modal } from "./Modal";

export function LibraryDialog() {
  const open = useAppStore((state) => state.overlay === "library");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const workspace = useAppStore((state) => state.workspace);
  const pages = useAppStore((state) => state.pages);
  const selectPage = useAppStore((state) => state.selectPage);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [selected, setSelected] = useState(0);

  const localPages = useMemo(
    () =>
      [...pages]
        .sort((a, b) => (b.updatedAt ?? "").localeCompare(a.updatedAt ?? ""))
        .map((page) => ({ pageId: page.id, title: page.title, snippet: "", updatedAt: page.updatedAt })),
    [pages],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      setHits([]);
      setError("");
      setSelected(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !workspace) return;
    const text = query.trim();
    if (!text) {
      setHits([]);
      setLoading(false);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    const timer = setTimeout(async () => {
      try {
        const results = list(await api.search(workspace.id, text, 30));
        if (!cancelled) {
          setHits(results);
          setSelected(0);
          setError("");
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, 140);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [open, query, workspace]);

  const results = query.trim() ? hits : localPages;
  function choose(pageId: string) {
    setOverlay(null);
    void selectPage(pageId);
  }

  return (
    <Modal
      open={open}
      title="Library"
      subtitle={workspace ? `${workspace.name} · ${pages.length.toLocaleString()} pages` : "Search every page in this workspace"}
      onClose={() => setOverlay(null)}
      width="large"
    >
      <div className="library-search">
        <Search size={17} aria-hidden="true" />
        <input
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(0);
          }}
          placeholder="Search titles and note text…"
          aria-label="Search library"
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setSelected((current) => Math.min(results.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setSelected((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter" && results[selected]) {
              event.preventDefault();
              choose(results[selected].pageId);
            }
          }}
        />
        {loading ? <LoaderCircle size={16} className="spin" aria-label="Searching" /> : null}
      </div>
      {error ? <div className="inline-error">{error}</div> : null}
      <div className="library-results" role="listbox" aria-label="Search results">
        {!loading && results.length === 0 ? (
          <div className="empty-hint">
            <Search size={20} />
            <p>{query.trim() ? "Nothing matched that search." : "No pages yet."}</p>
          </div>
        ) : null}
        {results.map((hit, index) => (
          <button
            key={hit.pageId}
            type="button"
            role="option"
            aria-selected={index === selected}
            className={`library-result ${index === selected ? "active" : ""}`}
            onMouseEnter={() => setSelected(index)}
            onClick={() => choose(hit.pageId)}
          >
            <span className="library-result-icon" aria-hidden="true"><FileText size={16} /></span>
            <span className="library-result-copy">
              <span className="library-result-title">{hit.title}</span>
              {hit.snippet ? (
                <span className="library-result-snippet">
                  {splitSnippet(hit.snippet).map((part, partIndex) =>
                    part.mark ? <mark key={partIndex}>{part.text}</mark> : <span key={partIndex}>{part.text}</span>,
                  )}
                </span>
              ) : (
                <span className="library-result-snippet muted">Open page</span>
              )}
            </span>
          </button>
        ))}
      </div>
      <p className="library-footnote">Search is local, indexed on save, and scoped to this workspace.</p>
    </Modal>
  );
}

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { BlockNoteEditor } from "@blocknote/core";
import { ArrowDown, ArrowUp, CaseSensitive, ChevronRight, X } from "lucide-react";
import { findInDoc, matchIndexFrom, type FindMatch, type FindNode } from "../lib/findInDoc";

/** How the bar was opened; a new `nonce` re-focuses an already open bar. */
export interface FindRequest {
  nonce: number;
  query: string;
  replace: boolean;
}

interface FindBarProps {
  // The editor's exact schema does not matter here: only text and positions do.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  editor: BlockNoteEditor<any, any, any>;
  request: FindRequest;
  scrollRef: RefObject<HTMLElement | null>;
  onClose: () => void;
}

const ALL = "noteral-find";
const CURRENT = "noteral-find-current";

// The CSS Custom Highlight API paints matches without touching the document,
// so highlighting never adds undo steps or marks the page dirty.
const highlights = (typeof CSS !== "undefined" && "highlights" in CSS
  ? (CSS as unknown as { highlights: Map<string, unknown> }).highlights
  : null);
const HighlightCtor = (globalThis as unknown as { Highlight?: new (...ranges: Range[]) => unknown }).Highlight;

function clearHighlights() {
  highlights?.delete(ALL);
  highlights?.delete(CURRENT);
}

export function FindBar({ editor, request, scrollRef, onClose }: FindBarProps) {
  const [query, setQuery] = useState(request.query);
  const [replacement, setReplacement] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [showReplace, setShowReplace] = useState(request.replace);
  const [docVersion, setDocVersion] = useState(0);
  const [current, setCurrent] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  // Where the next result should start: the caret when the bar opened, or the
  // end of the text just replaced.
  const anchor = useRef(editor.prosemirrorState.selection.from);
  const reveal = useRef(true);

  useEffect(() => {
    // Ctrl+F on an open bar selects the query again; Ctrl+H also opens Replace.
    if (request.query) setQuery(request.query);
    if (request.replace) setShowReplace(true);
    anchor.current = editor.prosemirrorState.selection.from;
    reveal.current = true;
    const target = request.replace && request.query ? replaceRef : inputRef;
    requestAnimationFrame(() => {
      target.current?.focus();
      target.current?.select();
    });
  }, [editor, request]);

  useEffect(() => editor.onChange(() => setDocVersion((value) => value + 1)), [editor]);

  const matches = useMemo<FindMatch[]>(
    () => findInDoc(editor.prosemirrorState.doc as unknown as FindNode, query, { caseSensitive }),
    // docVersion stands in for the document, which mutates in place.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [editor, query, caseSensitive, docVersion],
  );

  // Pick the result nearest the anchor whenever the set of results changes.
  useLayoutEffect(() => {
    setCurrent(matchIndexFrom(matches, anchor.current));
  }, [matches]);

  const view = editor.prosemirrorView;

  const rangeOf = useCallback(
    (match: FindMatch): Range | null => {
      try {
        const start = view.domAtPos(match.from);
        const end = view.domAtPos(match.to);
        const range = document.createRange();
        range.setStart(start.node, start.offset);
        range.setEnd(end.node, end.offset);
        return range;
      } catch {
        return null;
      }
    },
    [view],
  );

  useLayoutEffect(() => {
    if (!highlights || !HighlightCtor) return;
    const ranges = matches.map(rangeOf).filter((range): range is Range => range !== null);
    highlights.set(ALL, new HighlightCtor(...ranges));
    const active = current >= 0 ? matches[current] : undefined;
    const activeRange = active ? rangeOf(active) : null;
    if (activeRange) highlights.set(CURRENT, new HighlightCtor(activeRange));
    else highlights.delete(CURRENT);
  }, [matches, current, rangeOf]);

  useEffect(() => clearHighlights, []);

  // Bring the current result into view after navigation, not while typing in
  // the page (that would yank the page away from the caret).
  useLayoutEffect(() => {
    if (!reveal.current) return;
    const active = current >= 0 ? matches[current] : undefined;
    const container = scrollRef.current;
    if (!active || !container) return;
    reveal.current = false;
    const rect = rangeOf(active)?.getBoundingClientRect();
    if (!rect) return;
    const box = container.getBoundingClientRect();
    const margin = 72;
    if (rect.top < box.top + margin || rect.bottom > box.bottom - margin) {
      container.scrollTo({ top: container.scrollTop + rect.top - box.top - box.height / 3, behavior: "auto" });
    }
  }, [current, matches, rangeOf, scrollRef]);

  function step(delta: number) {
    if (!matches.length) return;
    reveal.current = true;
    setCurrent((index) => {
      const next = (Math.max(index, 0) + delta + matches.length) % matches.length;
      anchor.current = matches[next].from;
      return next;
    });
  }

  function close(selectMatch: boolean) {
    const active = current >= 0 ? matches[current] : undefined;
    clearHighlights();
    onClose();
    if (selectMatch && active) {
      editor._tiptapEditor.commands.setTextSelection({ from: active.from, to: active.to });
    }
    editor.focus();
  }

  function replaceCurrent() {
    const active = current >= 0 ? matches[current] : undefined;
    if (!active || !editor.isEditable) return;
    anchor.current = active.from + replacement.length;
    reveal.current = true;
    editor.transact((tr) => {
      tr.insertText(replacement, active.from, active.to);
    });
  }

  function replaceAll() {
    if (!matches.length || !editor.isEditable) return;
    // Back to front so earlier positions stay valid; one transaction is one undo step.
    editor.transact((tr) => {
      for (let index = matches.length - 1; index >= 0; index -= 1) {
        tr.insertText(replacement, matches[index].from, matches[index].to);
      }
    });
  }

  const count = !query ? "" : matches.length ? `${current + 1} of ${matches.length}` : "No results";

  return (
    <div className={`find-bar ${showReplace ? "with-replace" : ""}`} role="search" aria-label="Find in page">
      <div className="find-row">
        <button
          type="button"
          className={`icon-button tiny find-toggle ${showReplace ? "open" : ""}`}
          onClick={() => setShowReplace((value) => !value)}
          aria-label={showReplace ? "Hide replace" : "Show replace"}
          aria-expanded={showReplace}
          title="Replace (Ctrl+H)"
        >
          <ChevronRight size={14} />
        </button>
        <div className="find-field">
          <input
            ref={inputRef}
            className="find-input"
            value={query}
            placeholder="Find in page"
            aria-label="Find in page"
            spellCheck={false}
            onChange={(event) => {
              reveal.current = true;
              setQuery(event.target.value.replace(/[\r\n]+/g, " "));
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                step(event.shiftKey ? -1 : 1);
              } else if (event.key === "Escape") {
                event.preventDefault();
                close(true);
              }
            }}
          />
          <span className={`find-count ${query && !matches.length ? "empty" : ""}`} aria-live="polite">{count}</span>
        </div>
        <button
          type="button"
          className={`icon-button tiny ${caseSensitive ? "is-on" : ""}`}
          onClick={() => setCaseSensitive((value) => !value)}
          aria-label="Match case"
          aria-pressed={caseSensitive}
          title="Match case"
        >
          <CaseSensitive size={15} />
        </button>
        <button type="button" className="icon-button tiny" onClick={() => step(-1)} disabled={!matches.length} aria-label="Previous match" title="Previous (Shift+Enter)">
          <ArrowUp size={14} />
        </button>
        <button type="button" className="icon-button tiny" onClick={() => step(1)} disabled={!matches.length} aria-label="Next match" title="Next (Enter)">
          <ArrowDown size={14} />
        </button>
        <button type="button" className="icon-button tiny" onClick={() => close(false)} aria-label="Close find" title="Close (Esc)">
          <X size={14} />
        </button>
      </div>
      {showReplace ? (
        <div className="find-row">
          <span className="find-gutter" aria-hidden="true" />
          <div className="find-field">
            <input
              ref={replaceRef}
              className="find-input"
              value={replacement}
              placeholder="Replace with"
              aria-label="Replace with"
              spellCheck={false}
              onChange={(event) => setReplacement(event.target.value.replace(/[\r\n]+/g, " "))}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  if (event.metaKey || event.ctrlKey) replaceAll();
                  else replaceCurrent();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  close(true);
                }
              }}
            />
          </div>
          <button type="button" className="find-action" onClick={replaceCurrent} disabled={!matches.length || current < 0}>
            Replace
          </button>
          <button type="button" className="find-action" onClick={replaceAll} disabled={!matches.length} title="Replace all (Ctrl+Enter)">
            All
          </button>
        </div>
      ) : null}
    </div>
  );
}

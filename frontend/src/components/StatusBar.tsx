import { CloudOff, LockKeyhole } from "lucide-react";
import { usePluginStatuses } from "../plugins/runtime";
import { useAppStore } from "../store";

export function StatusBar() {
  const document = useAppStore((state) => state.documents[state.activePageId]);
  const liveWords = useAppStore((state) => state.liveWordCount);
  const liveBlocks = useAppStore((state) => state.liveBlockCount);
  const statuses = usePluginStatuses();
  const notify = useAppStore((state) => state.notify);

  const state = document?.saveState ?? "idle";
  const label =
    state === "saving"
      ? "Saving…"
      : state === "dirty"
        ? "Unsaved changes"
        : state === "error"
          ? "Save failed"
          : document
            ? "Saved"
            : "Ready";

  return (
    <footer className="status-bar" aria-label="Status">
      <div className="status-left">
        <span className={`save-state save-${state}`} title={document?.error ?? "Saves are confirmed by the local backend before this indicator changes."}>
          <span className="save-dot" aria-hidden="true" />
          <span aria-live="polite">{label}</span>
        </span>
        {document ? (
          <>
            <span className="status-divider" aria-hidden="true">·</span>
            <span>{liveWords.toLocaleString()} words</span>
            <span className="status-divider" aria-hidden="true">·</span>
            <span>{liveBlocks.toLocaleString()} blocks</span>
          </>
        ) : null}
        {document?.error ? (
          <button
            type="button"
            className="status-retry"
            title="Try saving again"
            onClick={() => {
              notify("Retrying save…", "info");
              void useAppStore.getState().saveNow(document.id);
            }}
          >
            Retry
          </button>
        ) : null}
      </div>
      <div className="status-right">
        {statuses.map((status) => (
          <span key={`${status.pluginId}:${status.itemId}`} className="plugin-status" title={status.title}>
            <span className="status-divider" aria-hidden="true">·</span>
            {status.text}
          </span>
        ))}
        <span className="status-divider" aria-hidden="true">·</span>
        <span className="local-badge" title="Your notes stay on this device"><LockKeyhole size={11} /> Local-first</span>
        <CloudOff size={12} className="offline-icon" aria-label="No cloud connection" />
      </div>
    </footer>
  );
}

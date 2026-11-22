import { useState } from "react";
import { FileText, RotateCcw, Trash2 } from "lucide-react";
import { relativeTime } from "../lib/format";
import { useAppStore } from "../store";
import { PageIcon } from "./PageIcon";

export function TrashView() {
  const trash = useAppStore((state) => state.trash);
  const restorePage = useAppStore((state) => state.restorePage);
  const deletePagePermanently = useAppStore((state) => state.deletePagePermanently);
  const emptyTrash = useAppStore((state) => state.emptyTrash);
  const [pending, setPending] = useState<string | null>(null);

  async function restore(pageId: string) {
    setPending(pageId);
    try {
      await restorePage(pageId);
    } finally {
      setPending(null);
    }
  }

  async function deleteForever(pageId: string, title: string) {
    if (!window.confirm(`Delete “${title}” forever? Its child pages will be deleted too. This cannot be undone.`)) return;
    setPending(pageId);
    try {
      await deletePagePermanently(pageId);
    } finally {
      setPending(null);
    }
  }

  async function empty() {
    if (!window.confirm("Permanently delete everything in the trash? This cannot be undone.")) return;
    setPending("empty");
    try {
      await emptyTrash();
    } finally {
      setPending(null);
    }
  }

  if (trash.length === 0) {
    return (
      <div className="trash-view">
        <div className="sidebar-section-heading"><span>Trash</span></div>
        <div className="empty-hint trash-empty">
          <Trash2 size={20} />
          <p>Trash is empty.</p>
          <span>Pages you move to trash will appear here.</span>
        </div>
      </div>
    );
  }

  return (
    <div className="trash-view">
      <div className="sidebar-section-heading">
        <span>Trash</span>
        <button
          type="button"
          className="text-button danger"
          onClick={() => void empty()}
          disabled={pending !== null}
        >
          Empty trash
        </button>
      </div>
      <div className="page-list trash-list" role="list">
        {trash.map((page) => (
          <div key={page.id} className="page-list-row trash-row" role="listitem">
            <div className="page-list-main trash-main">
              <span className="tree-icon" aria-hidden="true"><PageIcon value={page.icon} size={14} fallback={<FileText size={14} />} /></span>
              <span className="page-list-copy">
                <span className="page-list-title">{page.title}</span>
                <span className="page-list-time">Deleted {relativeTime(page.deletedAt)}</span>
              </span>
            </div>
            <button
              type="button"
              className="icon-button tiny trash-action"
              aria-label={`Restore ${page.title}`}
              title="Restore"
              disabled={pending !== null}
              onClick={() => void restore(page.id)}
            >
              <RotateCcw size={13} />
            </button>
            <button
              type="button"
              className="icon-button tiny trash-action trash-delete"
              aria-label={`Delete ${page.title} permanently`}
              title="Delete forever"
              disabled={pending !== null}
              onClick={() => void deleteForever(page.id, page.title)}
            >
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <p className="trash-note">Restore a page to put it back with its child pages.</p>
    </div>
  );
}

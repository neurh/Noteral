import { useEffect, useRef, useState } from "react";
import { ArrowRight, Check, Layers, Pencil, Plus } from "lucide-react";
import type { Workspace } from "../lib/api";
import { useAppStore } from "../store";
import { Modal } from "./Modal";

function pagesLabel(count: number): string {
  return `${count.toLocaleString()} ${count === 1 ? "page" : "pages"}`;
}

function relativeTime(value: string): string {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "recently";
  const diff = Date.now() - then;
  if (diff < 60_000) return "just now";
  const minutes = Math.round(diff / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(then));
}

export function WorkspaceDialog() {
  const open = useAppStore((state) => state.overlay === "workspaces");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const workspaces = useAppStore((state) => state.workspaces);
  const workspace = useAppStore((state) => state.workspace);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const createWorkspace = useAppStore((state) => state.createWorkspace);
  const renameWorkspace = useAppStore((state) => state.renameWorkspace);
  const refreshWorkspaces = useAppStore((state) => state.refreshWorkspaces);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [opening, setOpening] = useState<string | null>(null);
  const newButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (open) void refreshWorkspaces();
  }, [open, refreshWorkspaces]);

  useEffect(() => {
    if (!open) {
      setCreating(false);
      setName("");
      setEditing(null);
      setDraft("");
      setOpening(null);
    }
  }, [open]);

  async function create() {
    const clean = name.trim();
    if (!clean || busy) return;
    const previousId = useAppStore.getState().workspace?.id;
    setBusy(true);
    await createWorkspace(clean);
    setBusy(false);
    if (useAppStore.getState().workspace?.id === previousId) return;
    setName("");
    setCreating(false);
    setOverlay(null);
  }

  async function switchTo(id: string) {
    if (opening) return;
    setOpening(id);
    await openWorkspace(id);
    setOpening(null);
    if (useAppStore.getState().workspace?.id === id) setOverlay(null);
  }

  function focusPencil(id: string) {
    requestAnimationFrame(() => {
      const trigger = Array.from(document.querySelectorAll<HTMLButtonElement>(".workspace-pencil")).find(
        (button) => button.dataset.workspaceId === id,
      );
      trigger?.focus();
    });
  }

  async function commitRename(item: Workspace, restoreFocus = false) {
    const clean = draft.trim();
    setEditing(null);
    if (restoreFocus) focusPencil(item.id);
    if (clean && clean !== item.name) await renameWorkspace(item.id, clean);
  }

  function cancelRename(item: Workspace) {
    setEditing(null);
    focusPencil(item.id);
  }

  function startRename(item: Workspace) {
    setEditing(item.id);
    setDraft(item.name);
  }

  function cancelCreate() {
    setCreating(false);
    setName("");
    requestAnimationFrame(() => newButton.current?.focus());
  }

  const others = workspaces.filter((item) => item.id !== workspace?.id);
  const countLabel = `${workspaces.length.toLocaleString()} ${workspaces.length === 1 ? "workspace" : "workspaces"}`;

  return (
    <Modal
      open={open}
      title="Workspaces"
      subtitle="Each workspace is its own library — pages, attachments, and search stay separate."
      onClose={() => setOverlay(null)}
      width="medium"
      bodyClassName="workspaces-body"
      footer={
        creating ? (
          <div className="workspace-create">
            <input
              className="inline-input workspace-create-input"
              value={name}
              placeholder="Workspace name"
              aria-label="New workspace name"
              autoFocus
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void create();
                } else if (event.key === "Escape") {
                  event.preventDefault();
                  event.stopPropagation();
                  cancelCreate();
                }
              }}
            />
            <button type="button" className="text-button" onClick={cancelCreate} disabled={busy}>
              Cancel
            </button>
            <button type="button" className="primary-button" disabled={!name.trim() || busy} onClick={() => void create()}>
              {busy ? "Creating…" : "Create workspace"}
            </button>
          </div>
        ) : (
          <div className="workspace-footer">
            <span className="workspace-footer-count">{countLabel} on this device</span>
            <button
              ref={newButton}
              type="button"
              className={workspaces.length === 0 ? "primary-button" : "secondary-button"}
              onClick={() => setCreating(true)}
            >
              <Plus size={15} />
              New workspace
            </button>
          </div>
        )
      }
    >
      <div className="workspace-manager">
        {workspace ? (
          <section className="workspace-section" aria-labelledby="workspace-current-label">
            <h3 id="workspace-current-label" className="workspace-section-label">
              Current workspace
            </h3>
            <div className="workspace-current">
              <span className="workspace-avatar workspace-avatar-hero" aria-hidden="true">
                {workspace.name.slice(0, 1).toUpperCase()}
              </span>
              <div className="workspace-current-copy">
                {editing === workspace.id ? (
                  <input
                    className="workspace-name-input workspace-name-input-hero"
                    value={draft}
                    autoFocus
                    aria-label="Workspace name"
                    onChange={(event) => setDraft(event.target.value)}
                    onBlur={() => void commitRename(workspace)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        void commitRename(workspace, true);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        event.stopPropagation();
                        cancelRename(workspace);
                      }
                    }}
                  />
                ) : (
                  <span className="workspace-current-name">{workspace.name}</span>
                )}
                <span className="workspace-current-meta">{pagesLabel(workspace.pageCount)} · Active now</span>
              </div>
              <span className="workspace-current-pill">
                <Check size={12} />
                <span>Current</span>
              </span>
              <button
                type="button"
                className="icon-button workspace-pencil"
                data-workspace-id={workspace.id}
                aria-label={`Rename ${workspace.name}`}
                title="Rename workspace"
                onClick={() => startRename(workspace)}
              >
                <Pencil size={14} />
              </button>
            </div>
          </section>
        ) : workspaces.length === 0 ? (
          <div className="workspace-empty">
            <span className="workspace-empty-icon" aria-hidden="true">
              <Layers size={18} />
            </span>
            <p className="workspace-empty-title">No workspaces yet</p>
            <p className="workspace-empty-copy">Create a workspace to keep a separate library of pages, attachments, and search.</p>
          </div>
        ) : null}

        {others.length > 0 ? (
          <section className="workspace-section" aria-labelledby="workspace-switch-label">
            <div className="workspace-section-head">
              <h3 id="workspace-switch-label" className="workspace-section-label">
                {workspace ? "Switch workspace" : "Open a workspace"}
              </h3>
              <span className="workspace-count" aria-hidden="true">
                {others.length.toLocaleString()}
              </span>
            </div>
            <ul className="workspace-list">
              {others.map((item) => (
                <li key={item.id} className={`workspace-item ${opening === item.id ? "is-opening" : ""}`}>
                  {editing === item.id ? (
                    <div className="workspace-item-editing">
                      <span className="workspace-avatar" aria-hidden="true">
                        {item.name.slice(0, 1).toUpperCase()}
                      </span>
                      <input
                        className="workspace-name-input"
                        value={draft}
                        autoFocus
                        aria-label={`Rename ${item.name}`}
                        onChange={(event) => setDraft(event.target.value)}
                        onBlur={() => void commitRename(item)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            void commitRename(item, true);
                          } else if (event.key === "Escape") {
                            event.preventDefault();
                            event.stopPropagation();
                            cancelRename(item);
                          }
                        }}
                      />
                    </div>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="workspace-open"
                        aria-busy={opening === item.id}
                        onClick={() => void switchTo(item.id)}
                      >
                        <span className="workspace-avatar" aria-hidden="true">
                          {item.name.slice(0, 1).toUpperCase()}
                        </span>
                        <span className="workspace-item-copy">
                          <span className="workspace-item-name">{item.name}</span>
                          <span className="workspace-item-meta">
                            {pagesLabel(item.pageCount)} · Last opened {relativeTime(item.lastOpenedAt)}
                          </span>
                        </span>
                        <span className="workspace-item-action" aria-hidden="true">
                          {opening === item.id ? "Opening…" : <><span>Open</span><ArrowRight size={14} /></>}
                        </span>
                      </button>
                      <button
                        type="button"
                        className="icon-button workspace-pencil"
                        data-workspace-id={item.id}
                        aria-label={`Rename ${item.name}`}
                        title="Rename workspace"
                        onClick={() => startRename(item)}
                      >
                        <Pencil size={14} />
                      </button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </Modal>
  );
}

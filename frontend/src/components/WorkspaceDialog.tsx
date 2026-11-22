import { useEffect, useState } from "react";
import { Check, FolderPlus, Pencil } from "lucide-react";
import { useAppStore } from "../store";
import { Modal } from "./Modal";

export function WorkspaceDialog() {
  const open = useAppStore((state) => state.overlay === "workspaces");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const workspaces = useAppStore((state) => state.workspaces);
  const workspace = useAppStore((state) => state.workspace);
  const openWorkspace = useAppStore((state) => state.openWorkspace);
  const createWorkspace = useAppStore((state) => state.createWorkspace);
  const renameWorkspace = useAppStore((state) => state.renameWorkspace);
  const refreshWorkspaces = useAppStore((state) => state.refreshWorkspaces);
  const [name, setName] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open) void refreshWorkspaces();
  }, [open, refreshWorkspaces]);

  async function create() {
    const clean = name.trim();
    if (!clean || busy) return;
    setBusy(true);
    await createWorkspace(clean);
    setBusy(false);
    setName("");
    setOverlay(null);
  }

  async function commitRename(id: string) {
    const clean = draft.trim();
    setEditing(null);
    if (clean) await renameWorkspace(id, clean);
  }

  return (
    <Modal open={open} title="Workspaces" subtitle="Separate libraries with their own pages, assets, and search index." onClose={() => setOverlay(null)} width="medium">
      <div className="workspace-list">
        {workspaces.map((item) => (
          <div key={item.id} className={`workspace-row ${item.id === workspace?.id ? "current" : ""}`}>
            <span className="workspace-avatar large" aria-hidden="true">{item.name.slice(0, 1).toUpperCase()}</span>
            {editing === item.id ? (
              <input
                className="inline-input grow"
                value={draft}
                autoFocus
                aria-label="Workspace name"
                onChange={(event) => setDraft(event.target.value)}
                onBlur={() => void commitRename(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void commitRename(item.id);
                  } else if (event.key === "Escape") {
                    setEditing(null);
                  }
                }}
              />
            ) : (
              <button
                type="button"
                className="workspace-row-main"
                onClick={() => {
                  if (item.id !== workspace?.id) {
                    void openWorkspace(item.id);
                    setOverlay(null);
                  }
                }}
              >
                <span className="workspace-row-name">{item.name}</span>
                <span className="workspace-row-meta">{item.pageCount.toLocaleString()} {item.pageCount === 1 ? "page" : "pages"}</span>
              </button>
            )}
            {item.id === workspace?.id ? <span className="current-badge"><Check size={13} /> Current</span> : null}
            <button
              type="button"
              className="icon-button tiny"
              aria-label={`Rename ${item.name}`}
              title="Rename workspace"
              onClick={() => {
                setEditing(item.id);
                setDraft(item.name);
              }}
            >
              <Pencil size={13} />
            </button>
          </div>
        ))}
      </div>
      <div className="workspace-create">
        <FolderPlus size={16} aria-hidden="true" />
        <input
          className="inline-input grow"
          value={name}
          placeholder="New workspace name"
          aria-label="New workspace name"
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void create();
          }}
        />
        <button type="button" className="primary-button" disabled={!name.trim() || busy} onClick={() => void create()}>
          Create
        </button>
      </div>
    </Modal>
  );
}

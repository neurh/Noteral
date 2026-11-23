import { FileText, Folder, Plus, Table2 } from "lucide-react";
import { useMemo } from "react";
import { kindOf, useAppStore, type ItemKind } from "../store";
import { rowsOf } from "../lib/database";
import { KindIcon } from "./KindIcon";
import { newItemData } from "./NewItemMenu";
import { PageIcon } from "./PageIcon";

function relative(value: string): string {
  const time = Date.parse(value);
  if (Number.isNaN(time)) return "";
  const diff = Date.now() - time;
  const minutes = Math.round(diff / 60000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

const CREATE: { kind: ItemKind; name: string; icon: typeof FileText }[] = [
  { kind: "page", name: "New page", icon: FileText },
  { kind: "folder", name: "New folder", icon: Folder },
  { kind: "database", name: "New database", icon: Table2 },
];

/** The contents of a folder: its pages, folders and databases. */
export function FolderView({ folderId }: { folderId: string }) {
  const pages = useAppStore((state) => state.pages);
  const selectPage = useAppStore((state) => state.selectPage);
  const createItem = useAppStore((state) => state.createItem);
  const children = useMemo(
    () => pages.filter((page) => page.parentId === folderId).sort((a, b) => a.position - b.position || a.title.localeCompare(b.title)),
    [pages, folderId],
  );
  const countOf = (id: string, kind: ItemKind) => (kind === "database" ? rowsOf(pages, id).length : pages.filter((page) => page.parentId === id).length);

  return (
    <section className="folder-view" aria-label="Folder contents">
      <div className="folder-actions">
        {CREATE.map(({ kind, name, icon: Icon }) => (
          <button key={kind} type="button" className="secondary-button folder-create" onClick={() => void createItem(kind, folderId, { data: newItemData(kind) })}>
            <Icon size={14} /> {name}
          </button>
        ))}
      </div>
      {children.length ? (
        <div className="folder-list" role="list">
          {children.map((page) => {
            const kind = kindOf(page);
            const count = countOf(page.id, kind);
            return (
              <button key={page.id} type="button" role="listitem" className="folder-item" onClick={() => void selectPage(page.id)}>
                <span className={`folder-item-icon kind-${kind}`}>
                  <PageIcon value={page.icon} size={17} fallback={<KindIcon page={page} size={16} />} />
                </span>
                <span className="folder-item-title">{page.title || "Untitled"}</span>
                <span className="folder-item-meta">
                  {kind === "page" ? (count ? `${count} ${count === 1 ? "subpage" : "subpages"}` : "Page") : null}
                  {kind === "folder" ? `${count} ${count === 1 ? "item" : "items"}` : null}
                  {kind === "database" ? `${count} ${count === 1 ? "entry" : "entries"}` : null}
                </span>
                <span className="folder-item-date">{relative(page.updatedAt)}</span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="folder-empty">
          <Folder size={20} />
          <p>This folder is empty.</p>
          <button type="button" className="text-button" onClick={() => void createItem("page", folderId)}>
            <Plus size={13} /> Add a page
          </button>
        </div>
      )}
    </section>
  );
}

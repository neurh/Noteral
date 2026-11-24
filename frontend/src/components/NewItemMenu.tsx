import { FileText, Folder, Shapes, Table2 } from "lucide-react";
import { useContributions } from "../lib/contributions";
import { PageIcon } from "./PageIcon";
import { useAppStore, type ItemKind } from "../store";
import { defaultSchema, serializeSchema } from "../lib/database";
import { Popover } from "./database/Popover";

interface NewItemMenuProps {
  anchor: HTMLElement;
  parentId?: string;
  onClose: () => void;
  /** Called with the new item's id, e.g. to expand its parent in the tree. */
  onCreated?: (id: string, kind: ItemKind) => void;
}

const ITEMS: { kind: ItemKind; name: string; hint: string; icon: typeof FileText }[] = [
  { kind: "page", name: "Page", hint: "A blank page to write in", icon: FileText },
  { kind: "folder", name: "Folder", hint: "Group pages together", icon: Folder },
  { kind: "database", name: "Database", hint: "Table, board, calendar and more", icon: Table2 },
];

/** Builds the payload for a new item of the given kind. */
export function newItemData(kind: ItemKind): string {
  return kind === "database" ? serializeSchema(defaultSchema()) : "";
}

export function NewItemMenu({ anchor, parentId = "", onClose, onCreated }: NewItemMenuProps) {
  const createItem = useAppStore((state) => state.createItem);
  const { nodeTypes } = useContributions();
  async function create(kind: ItemKind, data = newItemData(kind), title?: string) {
    onClose();
    const meta = await createItem(kind, parentId, { data, ...(title ? { title } : {}) });
    if (meta) onCreated?.(meta.id, kind);
  }
  return (
    <Popover anchor={anchor} onClose={onClose} width={248} label="Create new">
      <div className="db-menu new-item-menu" role="menu">
        <div className="db-menu-label">{parentId ? "Add inside" : "Create new"}</div>
        {ITEMS.map(({ kind, name, hint, icon: Icon }) => (
          <button key={kind} type="button" role="menuitem" className="db-menu-item new-item" onClick={() => void create(kind)}>
            <span className={`new-item-icon kind-${kind}`}>
              <Icon size={16} />
            </span>
            <span className="new-item-text">
              <span className="new-item-name">{name}</span>
              <span className="new-item-hint">{hint}</span>
            </span>
          </button>
        ))}
        {nodeTypes.length ? <div className="db-menu-label">Custom</div> : null}
        {nodeTypes.map((node) => (
          <button
            key={node.key}
            type="button"
            role="menuitem"
            className="db-menu-item new-item"
            title={`Added by ${node.owner.name}`}
            onClick={() => void create("custom", JSON.stringify({ type: node.type, data: node.defaultData ?? null }), node.title)}
          >
            <span className="new-item-icon kind-custom">
              {node.icon ? <PageIcon value={node.icon} size={16} fallback={<Shapes size={16} />} /> : <Shapes size={16} />}
            </span>
            <span className="new-item-text">
              <span className="new-item-name">{node.title}</span>
              <span className="new-item-hint">{node.description || `From ${node.owner.name}`}</span>
            </span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

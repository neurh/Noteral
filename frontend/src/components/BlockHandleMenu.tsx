import { useEffect, useMemo } from "react";
import type { Block } from "@blocknote/core";
import { SideMenuExtension } from "@blocknote/core/extensions";
import {
  DragHandleMenu,
  SideMenu,
  TableColumnHeaderItem,
  TableRowHeaderItem,
  blockTypeSelectItems,
  useBlockNoteEditor,
  useComponentsContext,
  useExtensionState,
  type SideMenuProps,
} from "@blocknote/react";
import { ArrowDown, ArrowUp, Copy, Palette, Repeat2, Trash2 } from "lucide-react";
import {
  canMoveBlocks,
  duplicateBlocks,
  existingBlocks,
  hasInlineContent,
  moveBlocks,
  removeBlocks,
  setBlocksColor,
  targetBlockIds,
  turnBlocksInto,
  type ColorKind,
} from "../lib/blockActions";
import { isBlockSelection, selectBlocks, selectedBlockIds } from "../lib/blockSelection";

type AnyBlock = Block<any, any, any>;

const COLORS = ["default", "gray", "brown", "red", "orange", "yellow", "green", "blue", "purple", "pink"] as const;

const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.userAgent);
const MOD = isMac ? "⌘" : "Ctrl+";
const SHIFT = isMac ? "⇧" : "Shift+";

function colorName(color: string) {
  return color === "default" ? "Default" : color[0].toUpperCase() + color.slice(1);
}

/** The block side menu with Noteral's drag-handle menu. */
export function NoteralSideMenu(props: SideMenuProps) {
  return <SideMenu {...props} dragHandleMenu={BlockHandleMenu} />;
}

/**
 * The menu behind the six dots. It acts on the block selection when the block
 * is part of it, otherwise on that one block — which it selects while open, so
 * it's always clear what the menu will change.
 */
export function BlockHandleMenu() {
  const editor = useBlockNoteEditor<any, any, any>();
  const Components = useComponentsContext()!;
  const block = useExtensionState(SideMenuExtension, { selector: (state) => state?.block }) as AnyBlock | undefined;

  const ids = useMemo(() => (block ? targetBlockIds(editor, block.id) : []), [editor, block]);

  if (!block) return <DragHandleMenu>{null}</DragHandleMenu>;

  const blocks = existingBlocks(editor, ids);
  const textBlocks = blocks.filter(hasInlineContent);
  const allText = blocks.length > 0 && textBlocks.length === blocks.length;
  const typeItems = blockTypeSelectItems(editor).filter((item) => item.type in editor.schema.blockSchema);
  const current = typeItems.find((item) => isItemFor(item, blocks));
  const colorable = (kind: ColorKind) => blocks.some((b) => kind in (b.props as object));
  const heading = blocks.length > 1 ? `${blocks.length} blocks` : (current?.name ?? typeName(block));
  const Item = Components.Generic.Menu.Item;

  return (
    <DragHandleMenu>
      <SelectWhileOpen blockId={block.id} />
      <Components.Generic.Menu.Label className="bn-menu-label handle-menu-heading">{heading}</Components.Generic.Menu.Label>

      {allText && typeItems.length > 0 && (
        <Components.Generic.Menu.Root position="right" sub portalElement={null}>
          <Components.Generic.Menu.Trigger sub>
            <Item className="bn-menu-item handle-menu-item" subTrigger icon={<Repeat2 size={16} />}>
              Turn into
            </Item>
          </Components.Generic.Menu.Trigger>
          <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown handle-menu-dropdown">
            {typeItems.map((item) => {
              const Icon = item.icon;
              return (
                <Item
                  key={`${item.type}-${JSON.stringify(item.props ?? {})}`}
                  className="bn-menu-item handle-menu-item"
                  icon={<Icon size={16} />}
                  checked={current === item}
                  onClick={() => turnBlocksInto(editor, ids, { type: item.type, props: item.props })}
                >
                  {item.name}
                </Item>
              );
            })}
          </Components.Generic.Menu.Dropdown>
        </Components.Generic.Menu.Root>
      )}

      {(colorable("textColor") || colorable("backgroundColor")) && (
        <Components.Generic.Menu.Root position="right" sub portalElement={null}>
          <Components.Generic.Menu.Trigger sub>
            <Item className="bn-menu-item handle-menu-item" subTrigger icon={<Palette size={16} />}>
              Color
            </Item>
          </Components.Generic.Menu.Trigger>
          <Components.Generic.Menu.Dropdown sub className="bn-menu-dropdown handle-menu-dropdown handle-color-menu">
            {(["textColor", "backgroundColor"] as const).filter(colorable).map((kind) => (
              <ColorSection key={kind} kind={kind} blocks={blocks} onPick={(color) => setBlocksColor(editor, ids, kind, color)} />
            ))}
          </Components.Generic.Menu.Dropdown>
        </Components.Generic.Menu.Root>
      )}

      <Components.Generic.Menu.Divider className="bn-menu-divider" />

      <Item className="bn-menu-item handle-menu-item" icon={<Copy size={16} />} onClick={() => duplicateBlocks(editor, ids)}>
        <MenuText label="Duplicate" keys={`${MOD}D`} />
      </Item>
      <Item
        className="bn-menu-item handle-menu-item"
        icon={<ArrowUp size={16} />}
        disabled={!canMoveBlocks(editor, ids, -1)}
        onClick={() => moveBlocks(editor, ids, -1)}
      >
        <MenuText label="Move up" keys={`${MOD}${SHIFT}↑`} />
      </Item>
      <Item
        className="bn-menu-item handle-menu-item"
        icon={<ArrowDown size={16} />}
        disabled={!canMoveBlocks(editor, ids, 1)}
        onClick={() => moveBlocks(editor, ids, 1)}
      >
        <MenuText label="Move down" keys={`${MOD}${SHIFT}↓`} />
      </Item>

      {blocks.length === 1 && (
        <>
          <TableRowHeaderItem>Header row</TableRowHeaderItem>
          <TableColumnHeaderItem>Header column</TableColumnHeaderItem>
        </>
      )}

      <Components.Generic.Menu.Divider className="bn-menu-divider" />

      <Item className="bn-menu-item handle-menu-item is-danger" icon={<Trash2 size={16} />} onClick={() => removeBlocks(editor, ids)}>
        <MenuText label={blocks.length > 1 ? `Delete ${blocks.length} blocks` : "Delete"} keys="Del" />
      </Item>
    </DragHandleMenu>
  );
}

/**
 * BlockNote mounts the handle menu whenever the handle shows (on hover), but the
 * dropdown's children exist only while it's open, so this runs on open alone.
 */
function SelectWhileOpen({ blockId }: { blockId: string }) {
  const editor = useBlockNoteEditor<any, any, any>();
  useEffect(() => {
    const view = editor.prosemirrorView;
    if (!selectedBlockIds(view.state.selection).includes(blockId)) selectBlocks(view, [blockId]);
    return () => {
      // The menu took focus; hand it back so the selection's keys keep working,
      // unless the click that closed the menu went somewhere else.
      requestAnimationFrame(() => {
        const active = document.activeElement;
        const lost = !active || active === document.body;
        if (lost && !editor.prosemirrorView.isDestroyed && isBlockSelection(editor.prosemirrorView.state.selection)) {
          editor.prosemirrorView.focus();
        }
      });
    };
  }, [editor, blockId]);
  return null;
}

function MenuText({ label, keys }: { label: string; keys?: string }) {
  return (
    <span className="handle-menu-text">
      <span>{label}</span>
      {keys && <kbd className="handle-menu-keys">{keys}</kbd>}
    </span>
  );
}

function ColorSection({ kind, blocks, onPick }: { kind: ColorKind; blocks: AnyBlock[]; onPick: (color: string) => void }) {
  const Components = useComponentsContext()!;
  const values = new Set(blocks.filter((b) => kind in (b.props as object)).map((b) => String((b.props as Record<string, unknown>)[kind] ?? "default")));
  const current = values.size === 1 ? [...values][0] : undefined;
  return (
    <>
      <Components.Generic.Menu.Label className="bn-menu-label handle-menu-heading">
        {kind === "textColor" ? "Text" : "Background"}
      </Components.Generic.Menu.Label>
      {COLORS.map((color) => (
        <Components.Generic.Menu.Item
          key={color}
          className="bn-menu-item handle-menu-item"
          checked={current === color}
          icon={
            <span
              className={`handle-swatch is-${kind === "textColor" ? "text" : "background"}`}
              {...(kind === "textColor" ? { "data-text-color": color } : { "data-background-color": color })}
            >
              {kind === "textColor" ? "A" : null}
            </span>
          }
          onClick={() => onPick(color)}
        >
          {colorName(color)}
        </Components.Generic.Menu.Item>
      ))}
    </>
  );
}

function isItemFor(item: { type: string; props?: Record<string, unknown> }, blocks: AnyBlock[]) {
  if (!blocks.length) return false;
  return blocks.every(
    (b) =>
      b.type === item.type &&
      Object.entries(item.props ?? {}).every(([key, value]) => (b.props as Record<string, unknown>)[key] === value),
  );
}

function typeName(block: AnyBlock) {
  if (block.type === "database") return "Database";
  const spaced = block.type.replace(/([A-Z])/g, " $1");
  return spaced[0].toUpperCase() + spaced.slice(1).toLowerCase();
}

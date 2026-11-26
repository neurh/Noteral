import type { ReactNode } from "react";
import { commandRegistry } from "../lib/commands";
import { contributions, useContributions } from "../lib/contributions";
import type { PopupMenuItem } from "../lib/popups";
import type { MenuItemContribution, MenuSlot } from "../lib/contributions";
import { pluginRuntime } from "../plugins/runtime";
import { useAppStore } from "../store";
import { PageIcon } from "./PageIcon";

/** What a menu was opened on. Plugin command handlers receive it as their argument. */
export interface MenuContext {
  menu: MenuSlot;
  pageId?: string;
  kind?: string;
  nodeType?: string;
  blockId?: string;
  blockType?: string;
  tabKey?: string;
  /** Every selected page (treeSelection menu). */
  pageIds?: string[];
}

function matches(item: MenuItemContribution, context: MenuContext): boolean {
  if (item.menu !== context.menu) return false;
  if (item.kinds?.length && (!context.kind || !item.kinds.includes(context.kind as never))) return false;
  if (item.nodeTypes?.length && (!context.nodeType || !item.nodeTypes.includes(context.nodeType))) return false;
  if (item.blockTypes?.length && (!context.blockType || !item.blockTypes.includes(context.blockType))) return false;
  return true;
}

/** Contributed items as popup menu entries (for menus opened with lib/popups). */
export function contributedMenuEntries(context: MenuContext, items: MenuItemContribution[] = contributions.current().menuItems): PopupMenuItem[] {
  return items
    .filter((item) => matches(item, context))
    .map((item) => ({ id: item.key, label: item.title, icon: item.icon, danger: item.danger, run: () => runMenuItem(item, context) }));
}

export function useMenuItems(context: MenuContext): MenuItemContribution[] {
  const { menuItems } = useContributions();
  return menuItems.filter((item) => matches(item, context));
}

/** Runs a contributed menu item: a plugin's own command (with the context) or an app command. */
export function runMenuItem(item: MenuItemContribution, context: MenuContext) {
  const clean = Object.fromEntries(Object.entries(context).filter(([, value]) => value !== undefined && value !== ""));
  if (item.owner.kind === "plugin" && !item.command.includes(":")) {
    void pluginRuntime.runMenuCommand(item.owner.id, item.command, clean);
    return;
  }
  const command = commandRegistry.get(item.command);
  if (!command) {
    useAppStore.getState().notify(`“${item.title}” runs a command that isn't available (${item.command}).`, "error");
    return;
  }
  void Promise.resolve(command.run()).catch((error: unknown) => {
    useAppStore.getState().notify(error instanceof Error ? error.message : String(error), "error");
  });
}

interface Props {
  context: MenuContext;
  /** Called after an item runs, to close the menu. */
  onDone: () => void;
  /** Render one item; defaults to a `.menu` button (role menuitem). */
  renderItem?: (item: MenuItemContribution, run: () => void, icon: ReactNode) => ReactNode;
  /** Separator before the items; defaults to `.menu-separator`. */
  separator?: ReactNode;
}

/**
 * Menu items added by plugins and customizations for one app menu. Renders nothing when
 * there are none, so it can sit at the end of any menu.
 */
export function ContributedMenuItems({ context, onDone, renderItem, separator }: Props) {
  const items = useMenuItems(context);
  if (!items.length) return null;
  return (
    <>
      {separator ?? <div className="menu-separator" />}
      {items.map((item) => {
        const run = () => {
          onDone();
          runMenuItem(item, context);
        };
        const icon = item.icon ? <PageIcon value={item.icon} size={14} /> : <span className="menu-item-dot" aria-hidden="true" />;
        if (renderItem) return <span key={item.key} style={{ display: "contents" }}>{renderItem(item, run, icon)}</span>;
        return (
          <button
            key={item.key}
            type="button"
            role="menuitem"
            className={`contributed-menu-item${item.danger ? " danger" : ""}`}
            title={`${item.title} — ${item.owner.name}`}
            onClick={run}
          >
            {icon}
            <span className="contributed-menu-title">{item.title}</span>
            <span className="contributed-menu-owner">{item.owner.name}</span>
          </button>
        );
      })}
    </>
  );
}

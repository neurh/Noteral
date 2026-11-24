// The right sidebar is a stack of groups; each group is a panel with its own tab strip.
// The arrangement is saved with the customizations document (base, not a layer) so it
// survives restarts; tabs that are not available right now (a plugin that is off) are
// skipped when resolving and new tabs land in the last group.
import { BUILTIN_SIDEBAR_TABS, customizations } from "./customizations";
import type { SidebarGroup, SidebarLayout } from "./customizations";

export const MAX_SIDEBAR_GROUPS = 6;

let groupSequence = 0;
export function newGroupId(): string {
  groupSequence += 1;
  return `g${Date.now().toString(36)}${groupSequence.toString(36)}`;
}

/** The groups to show for the tabs that exist now. Always returns at least one group. */
export function resolveSidebar(stored: SidebarLayout | undefined, available: readonly string[]): SidebarGroup[] {
  const exists = new Set(available);
  const placed = new Set<string>();
  const groups: SidebarGroup[] = [];
  for (const group of stored?.groups ?? []) {
    const tabs = group.tabs.filter((tab) => exists.has(tab) && !placed.has(tab));
    tabs.forEach((tab) => placed.add(tab));
    if (!tabs.length) continue;
    groups.push({ ...group, tabs, active: tabs.includes(group.active) ? group.active : tabs[0] });
  }
  const rest = available.filter((tab) => !placed.has(tab));
  if (rest.length) {
    if (groups.length) {
      const last = groups[groups.length - 1];
      groups[groups.length - 1] = { ...last, tabs: [...last.tabs, ...rest] };
    } else {
      groups.push({ id: "main", tabs: [...rest], active: rest[0], size: 1 });
    }
  }
  if (!groups.length) groups.push({ id: "main", tabs: [], active: "", size: 1 });
  return groups;
}

/** Available tab keys in default order: built-ins first, then contributions. */
export function availableTabs(contributionKeys: readonly string[]): string[] {
  return [...BUILTIN_SIDEBAR_TABS, ...contributionKeys];
}

function save(groups: SidebarGroup[]) {
  customizations.update((draft) => {
    const kept = groups.filter((group) => group.tabs.length).slice(0, MAX_SIDEBAR_GROUPS);
    draft.sidebar = kept.length ? { groups: kept } : undefined;
  });
}

function current(available: readonly string[]): SidebarGroup[] {
  return resolveSidebar(customizations.get().sidebar, available).map((group) => ({ ...group, tabs: [...group.tabs] }));
}

export function groupOfTab(groups: SidebarGroup[], key: string): number {
  return groups.findIndex((group) => group.tabs.includes(key));
}

/** Make a tab the active one in its group. Returns false if the tab is unknown. */
export function activateSidebarTab(key: string, available: readonly string[]): boolean {
  const groups = current(available);
  const index = groupOfTab(groups, key);
  if (index < 0) return false;
  if (groups[index].active === key) return true;
  groups[index] = { ...groups[index], active: key };
  save(groups);
  return true;
}

/**
 * Move a tab to a group at a position. `group` -1 (or one past the end) makes a new group
 * at the bottom; groups left empty disappear.
 */
export function moveSidebarTab(key: string, group: number, index: number | undefined, available: readonly string[]): SidebarGroup[] {
  const groups = current(available);
  const from = groupOfTab(groups, key);
  if (from < 0) throw new Error(`Unknown sidebar tab "${key}". Use sidebar.list to see tab keys.`);
  const source = groups[from];
  if (group === from && source.tabs.length === 1) return groups;
  source.tabs = source.tabs.filter((tab) => tab !== key);
  if (source.active === key) source.active = source.tabs[Math.max(0, source.tabs.indexOf(key) - 1)] ?? source.tabs[0] ?? "";
  let target: SidebarGroup;
  if (group < 0 || group >= groups.length) {
    if (groups.filter((item) => item.tabs.length).length >= MAX_SIDEBAR_GROUPS) throw new Error(`The sidebar has at most ${MAX_SIDEBAR_GROUPS} groups.`);
    target = { id: newGroupId(), tabs: [], active: key, size: 1 };
    groups.push(target);
  } else {
    target = groups[group];
  }
  const at = index === undefined ? target.tabs.length : Math.max(0, Math.min(index, target.tabs.length));
  target.tabs.splice(at, 0, key);
  target.active = key;
  if (!source.active && source.tabs.length) source.active = source.tabs[0];
  const kept = groups.filter((item) => item.tabs.length);
  save(kept);
  return kept;
}

export function setSidebarGroups(groups: { tabs: string[]; active?: string; size?: number }[], available: readonly string[]): SidebarGroup[] {
  const exists = new Set(available);
  const seen = new Set<string>();
  const unknown: string[] = [];
  const next: SidebarGroup[] = [];
  for (const group of groups.slice(0, MAX_SIDEBAR_GROUPS)) {
    const tabs: string[] = [];
    for (const tab of group.tabs) {
      if (!exists.has(tab)) unknown.push(tab);
      else if (!seen.has(tab)) {
        seen.add(tab);
        tabs.push(tab);
      }
    }
    if (!tabs.length) continue;
    next.push({ id: newGroupId(), tabs, active: group.active && tabs.includes(group.active) ? group.active : tabs[0], size: group.size ?? 1 });
  }
  if (unknown.length) throw new Error(`Unknown sidebar tabs: ${unknown.join(", ")}. Use sidebar.list to see tab keys.`);
  if (!next.length) throw new Error("Give at least one group with tabs.");
  save(next);
  return resolveSidebar({ groups: next }, available);
}

export function resizeSidebarGroups(sizes: number[], available: readonly string[]) {
  const groups = current(available);
  sizes.forEach((size, index) => {
    if (groups[index]) groups[index] = { ...groups[index], size: Math.max(0.1, Math.min(10, size)) };
  });
  save(groups);
}

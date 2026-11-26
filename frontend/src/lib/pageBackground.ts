// Page backgrounds bound to the workspace store. A page's background is kept in
// the workspace UI settings (`homePrefs.pageBackgrounds[pageId]`, saved with
// the tabs through SaveUITabs), so it is per workspace, survives reloads and
// needs no page-schema change. The pure model lives in ./pageBackgroundModel.
//
// Valid `ascii` option keys and values (see ASCII_BACKGROUND_OPTIONS_DOC):
//   scene    (required) "ascii-moon" | "ascii-sunset" | "ascii-galaxy" | "ascii-rain" | "ascii-dunes" | "ascii-topo"
//            (short forms "moon", "sunset", "galaxy", "rain", "dunes", "topo" are accepted)
//   speed    number 0.25–3 (default 1)
//   ink      "#rrggbb" glyph tint (default: the scene's colors)
//   density  "fine" | "normal" | "large" (default "normal")
//   still    boolean, true = one still frame (default false)
//   cursor   boolean, false = ignore hover/clicks (default true)

import { useMemo } from "react";
import { useAppStore } from "../store";
import { normalizePageBackground, readPageBackgrounds, withPageBackground, type PageBackground } from "./pageBackgroundModel";

export {
  ASCII_BACKGROUND_OPTIONS_DOC,
  DEFAULT_PAGE_BACKGROUND_DIM,
  normalizePageBackground,
  pageAsciiOptions,
  pageBackgroundDim,
  pageBackgroundOpacity,
  pageBackgroundStyle,
  PAGE_ASCII_SCENES,
} from "./pageBackgroundModel";
export type { PageAsciiOptions, PageBackground, PageBackgroundKind } from "./pageBackgroundModel";

/** The background of a page in the open workspace, or null when it has none. */
export function getPageBackground(pageId: string): PageBackground | null {
  const raw = useAppStore.getState().homePrefs.pageBackgrounds?.[pageId];
  return raw === undefined ? null : normalizePageBackground(raw);
}

/**
 * Set (or clear with null) the background of a page in the open workspace and
 * save it. The input is validated with normalizePageBackground; invalid input
 * throws instead of being stored.
 */
export async function setPageBackground(pageId: string, background: PageBackground | null): Promise<void> {
  const state = useAppStore.getState();
  if (!state.workspace) throw new Error("No workspace is open.");
  if (typeof pageId !== "string" || !state.pages.some((page) => page.id === pageId)) throw new Error("Page not found.");
  const clean = background === null ? null : normalizePageBackground(background);
  if (background !== null && !clean) throw new Error("Invalid page background.");
  const map = withPageBackground(readPageBackgrounds(state.homePrefs), pageId, clean);
  useAppStore.setState((current) => {
    const homePrefs = { ...current.homePrefs };
    if (Object.keys(map).length) homePrefs.pageBackgrounds = map;
    else delete homePrefs.pageBackgrounds;
    return { homePrefs };
  });
  await useAppStore.getState().persistTabsNow();
}

/** React hook: the page's background, re-rendering when it changes. */
export function usePageBackground(pageId: string): PageBackground | null {
  const raw = useAppStore((state) => state.homePrefs.pageBackgrounds?.[pageId]);
  return useMemo(() => (raw === undefined ? null : normalizePageBackground(raw)), [raw]);
}

import { openExternal } from "../components/home/widgets";
import { isWebTab, useAppStore } from "../store";
import { useBrowserStore } from "./store";

/**
 * The rail's browser button: shows the browser tab you used last (focused pane
 * first), or opens a new one when there is none.
 */
export function showBrowser() {
  const app = useAppStore.getState();
  if (isWebTab(app.activeTabId)) return;
  const focused = app.tabs.filter(isWebTab);
  if (focused.length) {
    app.selectTab(focused[focused.length - 1]);
    return;
  }
  useBrowserStore.getState().open();
}

/** Open a new browser tab at `location`, or at the home page set in Settings. */
export function newBrowserTab(location?: string) {
  return useBrowserStore.getState().open(location);
}

/** Web links from pages open here when the user turned that on. */
export function shouldOpenInApp(href: string): boolean {
  return /^https?:\/\//i.test(href) && useBrowserStore.getState().data.prefs.openLinksInApp;
}

let wrapped = false;

/**
 * Route window.open for web links (the editor's link toolbar and Ctrl+click on
 * links use it) into a browser tab when the user asked for that.
 */
export function routeWindowOpen() {
  if (wrapped || typeof window === "undefined") return;
  wrapped = true;
  const native = window.open.bind(window);
  window.open = ((url?: string | URL, target?: string, features?: string) => {
    const href = url === undefined ? "" : String(url);
    if (shouldOpenInApp(href)) {
      newBrowserTab(href);
      return null;
    }
    return native(url, target, features);
  }) as typeof window.open;
}

export interface OpenLinkOptions {
  /** Open behind the current tab (Ctrl/⌘+click). */
  background?: boolean;
  /** Skip the in-app browser and use the system browser (Shift+click). */
  external?: boolean;
}

/**
 * Open a link clicked in a page: `noteral://page/<id>` opens the page, web
 * addresses open in a browser tab here, anything else (mail, other apps) goes
 * to the system.
 */
export function openPageLink(href: string, options: OpenLinkOptions = {}) {
  const app = useAppStore.getState();
  const page = /^noteral:\/\/page\/([\w-]+)/i.exec(href);
  if (page) {
    if (app.pages.some((item) => item.id === page[1])) void app.selectPage(page[1]);
    else app.notify("That page no longer exists.", "error");
    return;
  }
  if (/^https?:\/\//i.test(href) && !options.external && useBrowserStore.getState().data.prefs.openLinksInApp) {
    useBrowserStore.getState().open(href, { background: options.background });
    return;
  }
  if (/^(https?:|mailto:|tel:)/i.test(href)) openExternal(href);
}

import { openExternal } from "../components/home/widgets";
import { useAppStore } from "../store";
import { newBrowserTab, shouldOpenInApp } from "../browser/open";

/**
 * Opens a link clicked in rendered Markdown. `noteral://page/<id>` opens a
 * page in the app; web and mail links open in the system browser, or in a
 * browser tab when "Open links from pages here" is on (the default).
 */
export function openMarkdownLink(href: string) {
  const page = /^noteral:\/\/page\/([\w-]+)/i.exec(href);
  if (page) {
    const state = useAppStore.getState();
    if (state.pages.some((item) => item.id === page[1])) void state.selectPage(page[1]);
    else state.notify("That page no longer exists.", "error");
    return;
  }
  if (shouldOpenInApp(href)) newBrowserTab(href);
  else if (/^(https?:|mailto:)/i.test(href)) openExternal(href);
}

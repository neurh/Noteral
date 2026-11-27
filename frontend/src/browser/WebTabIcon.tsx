import { useState } from "react";
import { Globe, LoaderCircle } from "lucide-react";
import { currentLocation, faviconUrl } from "./model";
import { useBrowserStore } from "./store";

/** A browser tab's icon: the site's favicon, a spinner while loading, or a globe. */
export function WebTabIcon({ tabId, size = 13 }: { tabId: string; size?: number }) {
  const location = useBrowserStore((state) => currentLocation(state.tab(tabId)));
  const loading = useBrowserStore((state) => {
    const view = state.views[tabId];
    if (!view || view.location !== location) return false;
    return state.tab(tabId).mode === "reader" ? view.reader?.status === "loading" : view.loading;
  });
  const icon = useBrowserStore((state) => (state.views[tabId]?.location === location ? state.views[tabId]?.icon : undefined));
  return (
    <span className="tab-icon web-tab-icon" aria-hidden="true">
      {loading ? <LoaderCircle size={size} className="spin" /> : <Favicon location={location} icon={icon} size={size} />}
    </span>
  );
}

/** A site's favicon (the one the page names, else /favicon.ico), falling back to a globe. */
export function Favicon({ location, icon, size = 14 }: { location: string; icon?: string; size?: number }) {
  const sources = [icon && /^https?:/i.test(icon) ? icon : "", faviconUrl(location)].filter(Boolean);
  const [failed, setFailed] = useState<string[]>([]);
  const src = sources.find((item) => !failed.includes(item));
  if (!src) return <Globe size={size} />;
  return <img className="favicon" src={src} width={size} height={size} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed((list) => [...list, src])} />;
}

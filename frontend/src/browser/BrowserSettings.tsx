import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { DEFAULT_PREFS, READER_SIZES, SEARCH_ENGINES, hostOf, normalizeUrl, resolveInput, searchEngine, searchUrl, validSearchTemplate } from "./model";
import { useBrowserStore } from "./store";
import { Favicon } from "./WebTabIcon";

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span className="switch">
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} aria-label={label} />
      <span className="switch-track">
        <span className="switch-thumb" />
      </span>
    </span>
  );
}

/** Settings > Browser: search engine, home page and how pages open. */
export function BrowserSettings() {
  const prefs = useBrowserStore((state) => state.data.prefs);
  const historyCount = useBrowserStore((state) => state.data.history.length);
  const setPrefs = useBrowserStore((state) => state.setPrefs);
  const clearHistory = useBrowserStore((state) => state.clearHistory);
  const [custom, setCustom] = useState(prefs.customSearchUrl);
  const [home, setHome] = useState(prefs.homePage);
  const [homeMode, setHomeMode] = useState<"noteral" | "address">(prefs.homePage ? "address" : "noteral");
  const [confirmClear, setConfirmClear] = useState(false);
  const [editingCustom, setEditingCustom] = useState(prefs.searchEngine === "custom");

  useEffect(() => setCustom(prefs.customSearchUrl), [prefs.customSearchUrl]);
  useEffect(() => {
    setHome(prefs.homePage);
    if (prefs.homePage) setHomeMode("address");
  }, [prefs.homePage]);

  const customValid = validSearchTemplate(custom);
  const engine = searchEngine(prefs);

  const saveCustom = (value: string) => {
    setCustom(value);
    if (validSearchTemplate(value)) setPrefs({ customSearchUrl: value.trim(), searchEngine: "custom" });
  };

  const saveHome = () => {
    const value = home.trim();
    if (!value) {
      setPrefs({ homePage: "" });
      return;
    }
    const url = normalizeUrl(value) ?? resolveInput(value, engine);
    setHome(url);
    setPrefs({ homePage: url });
  };

  return (
    <>
      <section className="settings-group" aria-labelledby="settings-engine-label">
        <div className="settings-group-head">
          <h4 id="settings-engine-label">Search engine</h4>
          <p>What the address bar and the browser home page search with. Results open as the engine's own page.</p>
        </div>
        <div className="browser-engines" role="radiogroup" aria-labelledby="settings-engine-label">
          {SEARCH_ENGINES.map((item) => {
            const selected = prefs.searchEngine === item.id && !editingCustom;
            return (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`browser-engine${selected ? " active" : ""}`}
                onClick={() => {
                  setEditingCustom(false);
                  setPrefs({ searchEngine: item.id });
                }}
              >
                <span className="browser-engine-icon">
                  <Favicon location={searchUrl("", item)} size={16} />
                </span>
                <span className="browser-engine-text">
                  <span className="browser-engine-name">
                    {item.name}
                    {item.id === DEFAULT_PREFS.searchEngine ? <span className="browser-engine-tag">Default</span> : null}
                  </span>
                  <span className="browser-engine-host">{item.hosts[0]}</span>
                </span>
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={prefs.searchEngine === "custom" || editingCustom}
            className={`browser-engine${prefs.searchEngine === "custom" || editingCustom ? " active" : ""}`}
            onClick={() => {
              setEditingCustom(true);
              if (validSearchTemplate(custom)) setPrefs({ searchEngine: "custom", customSearchUrl: custom.trim() });
              else requestAnimationFrame(() => document.getElementById("settings-custom-engine")?.focus());
            }}
          >
            <span className="browser-engine-icon">
              <Favicon location={customValid ? custom.replace(/%s/g, "q") : ""} size={16} />
            </span>
            <span className="browser-engine-text">
              <span className="browser-engine-name">Custom</span>
              <span className="browser-engine-host">{customValid ? hostOf(custom.replace(/%s/g, "q")) : "Any search address"}</span>
            </span>
          </button>
        </div>
        {prefs.searchEngine === "custom" || editingCustom ? (
        <div className="setting-control browser-setting-field">
          <label htmlFor="settings-custom-engine">Custom search address</label>
          <p>
            Paste a results address with <code>%s</code> where the words go, like <code>https://search.example.com/?q=%s</code>.
          </p>
          <input
            id="settings-custom-engine"
            className={`text-input${custom && !customValid ? " invalid" : ""}`}
            value={custom}
            placeholder="https://…?q=%s"
            spellCheck={false}
            onChange={(event) => saveCustom(event.target.value)}
          />
          {custom && !customValid ? <span className="browser-setting-error">Needs to start with https:// and contain %s.</span> : null}
        </div>
        ) : null}
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <h4>Home page</h4>
          <p>What Home and new browser tabs open.</p>
        </div>
        <div className="setting-control setting-control-inline">
          <div>
            <label id="settings-home-label">Open with</label>
            <p>Noteral's home has search, bookmarks, history and recent clips.</p>
          </div>
          <div className="segmented" role="group" aria-labelledby="settings-home-label">
            <button
              type="button"
              className={homeMode === "noteral" ? "active" : ""}
              aria-pressed={homeMode === "noteral"}
              onClick={() => {
                setHomeMode("noteral");
                setPrefs({ homePage: "" });
              }}
            >
              Noteral home
            </button>
            <button
              type="button"
              className={homeMode === "address" ? "active" : ""}
              aria-pressed={homeMode === "address"}
              onClick={() => {
                setHomeMode("address");
                requestAnimationFrame(() => document.getElementById("settings-home-page")?.focus());
              }}
            >
              A web address
            </button>
          </div>
        </div>
        {homeMode === "address" ? (
          <div className="setting-control browser-setting-field">
            <label htmlFor="settings-home-page">Home address</label>
            <input
              id="settings-home-page"
              className="text-input"
              value={home}
              placeholder="https://example.com"
              spellCheck={false}
              onChange={(event) => setHome(event.target.value)}
              onBlur={saveHome}
              onKeyDown={(event) => {
                if (event.key === "Enter") saveHome();
              }}
            />
          </div>
        ) : null}
      </section>

      <section className="settings-group">
        <div className="settings-group-head">
          <h4>Pages</h4>
          <p>How sites show and where links go.</p>
        </div>
        <label className="settings-row">
          <span className="settings-row-copy">
            <span className="settings-row-title">Open sites in Reader</span>
            <span className="settings-row-desc">New tabs start with just the text, in your reading font. Switch any tab back to Page.</span>
          </span>
          <Toggle checked={prefs.defaultMode === "reader"} onChange={(value) => setPrefs({ defaultMode: value ? "reader" : "web" })} label="Open sites in Reader" />
        </label>
        <label className="settings-row">
          <span className="settings-row-copy">
            <span className="settings-row-title">Open links from pages here</span>
            <span className="settings-row-desc">Clicking a web link in a note opens it in a browser tab. Turn off to use the system browser; Shift+click always does.</span>
          </span>
          <Toggle checked={prefs.openLinksInApp} onChange={(value) => setPrefs({ openLinksInApp: value })} label="Open links from pages here" />
        </label>
        <div className="setting-control setting-control-inline">
          <div>
            <label id="settings-reader-size-label">Reader text size</label>
            <p>Size of the text in Reader.</p>
          </div>
          <div className="segmented" role="group" aria-labelledby="settings-reader-size-label">
            {READER_SIZES.map((size) => (
              <button key={size} type="button" className={prefs.readerSize === size ? "active" : ""} aria-pressed={prefs.readerSize === size} onClick={() => setPrefs({ readerSize: size })}>
                {size}
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="settings-group">
        <div className="settings-row">
          <span className="settings-row-copy">
            <span className="settings-row-title">Browsing history</span>
            <span className="settings-row-desc">{historyCount ? `${historyCount} ${historyCount === 1 ? "page" : "pages"} in this workspace.` : "Nothing yet."} Bookmarks stay.</span>
          </span>
          <button
            type="button"
            className={`secondary-button${confirmClear ? " danger" : ""}`}
            disabled={!historyCount}
            onBlur={() => setConfirmClear(false)}
            onClick={() => {
              if (!confirmClear) {
                setConfirmClear(true);
                return;
              }
              clearHistory();
              setConfirmClear(false);
            }}
          >
            <Trash2 size={14} /> {confirmClear ? "Confirm clear" : "Clear history"}
          </button>
        </div>
      </section>
    </>
  );
}

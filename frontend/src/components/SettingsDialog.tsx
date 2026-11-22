import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import {
  Check,
  Copy,
  FolderOpen,
  HardDrive,
  Info,
  Keyboard,
  LibraryBig,
  LockKeyhole,
  Monitor,
  Moon,
  Palette,
  Puzzle,
  RotateCcw,
  Sun,
  Type,
} from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { defaultSettings, useAppStore } from "../store";
import { Modal } from "./Modal";

const themes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

const sections = [
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "editor", label: "Editor", icon: Type },
  { id: "data", label: "Data", icon: HardDrive },
  { id: "shortcuts", label: "Shortcuts", icon: Keyboard },
  { id: "about", label: "About", icon: Info },
] as const;

type SectionId = (typeof sections)[number]["id"];

const saveDelays = [
  { value: 300, label: "Fast" },
  { value: 700, label: "Balanced" },
  { value: 1200, label: "Relaxed" },
] as const;

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

interface RangeSettingProps {
  id: string;
  label: string;
  description: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}

function RangeSetting({ id, label, description, value, display, min, max, step, onChange }: RangeSettingProps) {
  return (
    <div className="setting-control">
      <div className="setting-control-head">
        <div>
          <label htmlFor={id}>{label}</label>
          <p>{description}</p>
        </div>
        <output htmlFor={id} className="setting-value">{display}</output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        style={{ "--range-progress": `${((value - min) / (max - min)) * 100}%` } as CSSProperties}
      />
    </div>
  );
}

function SettingsPane({ title, description, children }: { title: string; description: string; children: ReactNode }) {
  return (
    <div className="settings-pane">
      <header className="settings-pane-head">
        <h3>{title}</h3>
        <p>{description}</p>
      </header>
      {children}
    </div>
  );
}

export function SettingsDialog() {
  const open = useAppStore((state) => state.overlay === "settings");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const settings = useAppStore((state) => state.settings);
  const setTheme = useAppStore((state) => state.setTheme);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const persistSettings = useAppStore((state) => state.persistSettingsNow);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const notify = useAppStore((state) => state.notify);
  const [section, setSection] = useState<SectionId>("appearance");
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    if (!open) {
      setCopied(false);
      setConfirmReset(false);
    }
  }, [open]);

  useEffect(() => {
    setConfirmReset(false);
  }, [section]);

  async function copyDataDir() {
    if (!bootstrap?.dataDir) return;
    try {
      await navigator.clipboard.writeText(bootstrap.dataDir);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      notify(errorMessage(error), "error");
    }
  }

  function resetAll() {
    if (!confirmReset) {
      setConfirmReset(true);
      return;
    }
    updateSettings({ ...defaultSettings });
    void persistSettings();
    setConfirmReset(false);
    notify("Settings restored to defaults", "success");
  }

  const platform = bootstrap?.platform ?? "";
  const mod = platform === "darwin" ? "⌘" : "Ctrl";
  const activeSection = sections.find((item) => item.id === section) ?? sections[0];
  const previewFont = settings.editorFont === "sans" ? "var(--font-ui)" : "var(--font-reading)";

  const shortcutGroups = [
    {
      title: "Navigation",
      items: [
        { label: "Command palette", keys: [mod, "K"] },
        { label: "Search the library", keys: [mod, "P"] },
      ],
    },
    {
      title: "Pages and tabs",
      items: [
        { label: "New page", keys: [mod, "N"] },
        { label: "New tab", keys: [mod, "T"] },
        { label: "Save now", keys: [mod, "S"] },
        { label: "Close tab", keys: [mod, "W"] },
      ],
    },
    {
      title: "Layout",
      items: [
        { label: "Toggle sidebar", keys: [mod, "B"] },
        { label: "Toggle inspector", keys: [mod, "⇧", "B"] },
      ],
    },
    {
      title: "While writing",
      items: [
        { label: "Block menu", keys: ["/"] },
        { label: "Bold", keys: [mod, "B"] },
        { label: "Insert a page link", keys: ["/", "link"] },
      ],
    },
  ];

  return (
    <Modal
      open={open}
      title="Settings"
      subtitle="Make Noteral yours — everything is saved on this device."
      onClose={() => setOverlay(null)}
      width="large"
      className="settings-modal"
      bodyClassName="settings-body"
    >
      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Settings sections">
          <p className="settings-nav-kicker">Preferences</p>
          <div className="settings-nav-list">
            {sections.map((item) => {
              const Icon = item.icon;
              const selected = item.id === section;
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`settings-nav-item ${selected ? "active" : ""}`}
                  aria-current={selected ? "page" : undefined}
                  onClick={() => setSection(item.id)}
                >
                  <Icon size={15} strokeWidth={1.9} />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
          <div className="settings-nav-foot">
            <span className="settings-autosave">
              <Check size={12} /> Saved automatically
            </span>
            <button
              type="button"
              className={`settings-reset ${confirmReset ? "confirming" : ""}`}
              onClick={resetAll}
              onBlur={() => setConfirmReset(false)}
              title="Restore all preferences to their defaults"
            >
              <RotateCcw size={12} /> {confirmReset ? "Confirm reset" : "Reset defaults"}
            </button>
          </div>
        </nav>

        <div className="settings-page" role="region" aria-label={`${activeSection.label} settings`}>
          {section === "appearance" ? (
            <SettingsPane title="Appearance" description="Set the mood. Noteral can follow your system theme or stay in one place.">
              <section className="settings-group" aria-labelledby="settings-theme-label">
                <div className="settings-group-head">
                  <h4 id="settings-theme-label">Theme</h4>
                  <p>Warm paper for daylight, a low-light page for late sessions.</p>
                </div>
                <div className="theme-cards" role="group" aria-label="Theme">
                  {themes.map((item) => {
                    const Icon = item.icon;
                    const selected = settings.theme === item.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`theme-card ${selected ? "selected" : ""}`}
                        aria-pressed={selected}
                        onClick={() => setTheme(item.id)}
                      >
                        <span className={`theme-thumb theme-thumb-${item.id}`} aria-hidden="true">
                          <span className="theme-thumb-rail" />
                          <span className="theme-thumb-side" />
                          <span className="theme-thumb-page">
                            <span className="theme-thumb-title" />
                            <span className="theme-thumb-line" />
                            <span className="theme-thumb-line short" />
                            <span className="theme-thumb-line" />
                          </span>
                        </span>
                        <span className="theme-card-label">
                          <Icon size={14} />
                          <span>{item.label}</span>
                          {selected ? <Check size={14} className="theme-card-check" /> : null}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="settings-group">
                <div className="settings-group-head">
                  <h4>Comfort</h4>
                  <p>Small adjustments that make long writing sessions easier.</p>
                </div>
                <label className="settings-row">
                  <span className="settings-row-copy">
                    <span className="settings-row-title">Reduce motion</span>
                    <span className="settings-row-desc">Skip interface transitions and modal easing.</span>
                  </span>
                  <Toggle checked={settings.reduceMotion} onChange={(value) => updateSettings({ reduceMotion: value })} label="Reduce motion" />
                </label>
                <label className="settings-row">
                  <span className="settings-row-copy">
                    <span className="settings-row-title">Show writing stats</span>
                    <span className="settings-row-desc">Display word and block counts in the status bar.</span>
                  </span>
                  <Toggle checked={settings.showStats} onChange={(value) => updateSettings({ showStats: value })} label="Show writing stats" />
                </label>
              </section>

              <section className="settings-group">
                <div className="settings-row">
                  <span className="settings-row-copy">
                    <span className="settings-row-title">Panel layout</span>
                    <span className="settings-row-desc">Restore the sidebar and inspector to their original widths.</span>
                  </span>
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => updateSettings({ leftWidth: 272, rightWidth: 296, leftOpen: true, rightOpen: true })}
                  >
                    <RotateCcw size={14} /> Reset panel widths
                  </button>
                </div>
              </section>
            </SettingsPane>
          ) : null}

          {section === "editor" ? (
            <SettingsPane title="Editor" description="Tune the reading page around the way you write. Changes preview instantly.">
              <section className="settings-group">
                <div className="settings-group-head">
                  <h4>Reading text</h4>
                  <p>The page stays quiet; these controls only change how your words sit on it.</p>
                </div>

                <div className="setting-control setting-control-inline">
                  <div>
                    <label id="settings-typeface-label">Typeface</label>
                    <p>Choose a literary serif or the crisp interface sans.</p>
                  </div>
                  <div className="segmented" role="group" aria-labelledby="settings-typeface-label">
                    <button
                      type="button"
                      className={settings.editorFont === "serif" ? "active" : ""}
                      aria-pressed={settings.editorFont === "serif"}
                      onClick={() => updateSettings({ editorFont: "serif" })}
                    >
                      Serif
                    </button>
                    <button
                      type="button"
                      className={settings.editorFont === "sans" ? "active" : ""}
                      aria-pressed={settings.editorFont === "sans"}
                      onClick={() => updateSettings({ editorFont: "sans" })}
                    >
                      Sans
                    </button>
                  </div>
                </div>

                <RangeSetting
                  id="settings-font-size"
                  label="Text size"
                  description="Size of body text and lists."
                  value={settings.fontSize}
                  display={`${settings.fontSize} px`}
                  min={15}
                  max={20}
                  step={1}
                  onChange={(value) => updateSettings({ fontSize: value })}
                />
                <RangeSetting
                  id="settings-line-height"
                  label="Line spacing"
                  description="A little more air between lines."
                  value={settings.lineHeight}
                  display={settings.lineHeight.toFixed(2)}
                  min={1.5}
                  max={1.9}
                  step={0.02}
                  onChange={(value) => updateSettings({ lineHeight: value })}
                />
                <RangeSetting
                  id="settings-page-width"
                  label="Reading width"
                  description="The maximum measure of the writing page."
                  value={settings.pageWidth}
                  display={`${settings.pageWidth} px`}
                  min={640}
                  max={900}
                  step={20}
                  onChange={(value) => updateSettings({ pageWidth: value })}
                />

                <div className="reading-preview" aria-label="Reading text preview">
                  <div className="reading-preview-head">
                    <span>Preview</span>
                    <span>{settings.editorFont === "serif" ? "Newsreader" : "Inter"} · {settings.fontSize}px</span>
                  </div>
                  <div className="reading-preview-sheet" style={{ fontFamily: previewFont }}>
                    <span className="reading-preview-kicker">Field notes</span>
                    <h5>A calmer place to think</h5>
                    <p style={{ fontSize: settings.fontSize, lineHeight: settings.lineHeight }}>
                      Good writing needs room to breathe. Noteral keeps the page quiet, the controls close, and your
                      words on this machine.
                    </p>
                  </div>
                </div>
              </section>

              <section className="settings-group">
                <div className="settings-group-head">
                  <h4>Saving</h4>
                  <p>Every change is written to the local database. Nothing leaves this device.</p>
                </div>
                <div className="setting-control setting-control-inline">
                  <div>
                    <label id="settings-autosave-label">Autosave</label>
                    <p>How long to wait after you stop typing.</p>
                  </div>
                  <div className="segmented" role="group" aria-labelledby="settings-autosave-label">
                    {saveDelays.map((item) => (
                      <button
                        key={item.value}
                        type="button"
                        className={settings.autosaveDelay === item.value ? "active" : ""}
                        aria-pressed={settings.autosaveDelay === item.value}
                        onClick={() => updateSettings({ autosaveDelay: item.value })}
                        title={`${item.value} ms after the last edit`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </div>
                <label className="settings-row">
                  <span className="settings-row-copy">
                    <span className="settings-row-title">Check spelling</span>
                    <span className="settings-row-desc">Underline misspelled words while you write.</span>
                  </span>
                  <Toggle checked={settings.spellcheck} onChange={(value) => updateSettings({ spellcheck: value })} label="Check spelling" />
                </label>
              </section>
            </SettingsPane>
          ) : null}

          {section === "data" ? (
            <SettingsPane title="Data" description="Your notes, attachments, workspaces, and plugin settings live in one portable folder.">
              <section className="settings-group">
                <div className="data-card">
                  <span className="data-card-icon"><HardDrive size={18} /></span>
                  <div className="data-card-main">
                    <span className="data-card-label">Portable library folder</span>
                    <code title={bootstrap?.dataDir}>{bootstrap?.dataDir ?? "…"}</code>
                  </div>
                  <div className="data-card-actions">
                    <button type="button" className="secondary-button" onClick={() => void copyDataDir()}>
                      {copied ? <Check size={14} /> : <Copy size={14} />} {copied ? "Copied" : "Copy"}
                    </button>
                    <button
                      type="button"
                      className="secondary-button"
                      onClick={() => void api.revealDataDir().catch((error) => notify(errorMessage(error), "error"))}
                    >
                      <FolderOpen size={14} /> Open
                    </button>
                  </div>
                </div>
                <div className="settings-callout">
                  <LockKeyhole size={16} />
                  <div>
                    <strong>No account. No sync. No telemetry.</strong>
                    <p>Back up the folder while Noteral is closed. Move it with the app to take your library anywhere.</p>
                  </div>
                </div>
              </section>

              <section className="settings-group">
                <div className="settings-group-head">
                  <h4>Workspace tools</h4>
                  <p>Jump to the library or manage the extensions that live beside your notes.</p>
                </div>
                <div className="settings-row">
                  <span className="settings-row-copy">
                    <span className="settings-row-title">Search this workspace</span>
                    <span className="settings-row-desc">Find a page by title or its full text.</span>
                  </span>
                  <button type="button" className="secondary-button" onClick={() => setOverlay("library")}>
                    <LibraryBig size={14} /> Open library
                  </button>
                </div>
                <div className="settings-row">
                  <span className="settings-row-copy">
                    <span className="settings-row-title">Plugins</span>
                    <span className="settings-row-desc">Review installed extensions and their permissions.</span>
                  </span>
                  <button type="button" className="secondary-button" onClick={() => setOverlay("plugins")}>
                    <Puzzle size={14} /> Manage plugins
                  </button>
                </div>
              </section>
            </SettingsPane>
          ) : null}

          {section === "shortcuts" ? (
            <SettingsPane title="Shortcuts" description={`A small set of keys that keep your hands on the page. Use ${mod} on this platform.`}>
              {shortcutGroups.map((group) => (
                <section className="settings-group" key={group.title}>
                  <div className="settings-group-head">
                    <h4>{group.title}</h4>
                  </div>
                  <dl className="shortcut-list">
                    {group.items.map((item) => (
                      <div className="shortcut-row" key={item.label}>
                        <dt>{item.label}</dt>
                        <dd>
                          {item.keys.map((key, index) => (
                            <kbd key={`${key}-${index}`}>{key}</kbd>
                          ))}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </section>
              ))}
            </SettingsPane>
          ) : null}

          {section === "about" ? (
            <SettingsPane title="About" description="A quiet, local-first place to write — built to keep your library yours.">
              <div className="about-hero">
                <div className="about-mark" aria-hidden="true">N</div>
                <div className="about-hero-copy">
                  <h4>Noteral</h4>
                  <p>Notes with a little more room to think.</p>
                </div>
                <span className="about-version">v{bootstrap?.version ?? "0.1.0"}</span>
              </div>

              <dl className="about-facts">
                <div><dt>Platform</dt><dd>{platform === "linux" ? "Linux" : platform === "darwin" ? "macOS" : platform === "windows" ? "Windows" : platform || "—"}</dd></div>
                <div><dt>Storage</dt><dd>SQLite + versioned BlockNote JSON</dd></div>
                <div><dt>Plugin SDK</dt><dd>1.x · sandboxed</dd></div>
                <div><dt>Data folder</dt><dd className="about-path" title={bootstrap?.dataDir}>{bootstrap?.dataDir ?? "—"}</dd></div>
              </dl>

              <div className="settings-callout">
                <LockKeyhole size={16} />
                <div>
                  <strong>Made for this machine.</strong>
                  <p>No accounts, no cloud, no background sync. Your words stay in the folder you choose.</p>
                </div>
              </div>

              <div className="about-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => void api.revealDataDir().catch((error) => notify(errorMessage(error), "error"))}
                >
                  <FolderOpen size={14} /> Open data folder
                </button>
              </div>
            </SettingsPane>
          ) : null}
        </div>
      </div>
    </Modal>
  );
}

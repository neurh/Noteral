import { useEffect, useState } from "react";
import { Check, FolderOpen, Monitor, Moon, RotateCcw, Sun } from "lucide-react";
import { api, errorMessage } from "../lib/api";
import { useAppStore } from "../store";
import { Modal } from "./Modal";

const themes = [
  { id: "light", label: "Light", icon: Sun },
  { id: "dark", label: "Dark", icon: Moon },
  { id: "system", label: "System", icon: Monitor },
] as const;

export function SettingsDialog() {
  const open = useAppStore((state) => state.overlay === "settings");
  const setOverlay = useAppStore((state) => state.setOverlay);
  const settings = useAppStore((state) => state.settings);
  const setTheme = useAppStore((state) => state.setTheme);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const bootstrap = useAppStore((state) => state.bootstrap);
  const notify = useAppStore((state) => state.notify);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) setCopied(false);
  }, [open]);

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

  return (
    <Modal open={open} title="Settings" subtitle="Noteral keeps your library portable and on this device." onClose={() => setOverlay(null)} width="medium">
      <section className="settings-section">
        <h3>Appearance</h3>
        <div className="theme-options" role="group" aria-label="Theme">
          {themes.map((item) => {
            const Icon = item.icon;
            const selected = settings.theme === item.id;
            return (
              <button
                key={item.id}
                type="button"
                className={`theme-option ${selected ? "selected" : ""}`}
                aria-pressed={selected}
                onClick={() => setTheme(item.id)}
              >
                <Icon size={17} />
                <span>{item.label}</span>
                {selected ? <Check size={14} /> : null}
              </button>
            );
          })}
        </div>
      </section>
      <section className="settings-section">
        <h3>Data</h3>
        <p className="settings-copy">Your notes, attachments, workspaces, and plugin settings live in one portable folder. Move it while Noteral is closed.</p>
        <div className="data-path">
          <code title={bootstrap?.dataDir}>{bootstrap?.dataDir ?? "…"}</code>
          <button type="button" className="secondary-button" onClick={() => void copyDataDir()}>{copied ? "Copied" : "Copy"}</button>
          <button type="button" className="secondary-button" onClick={() => void api.revealDataDir().catch((error) => notify(errorMessage(error), "error"))}><FolderOpen size={14} /> Open</button>
        </div>
      </section>
      <section className="settings-section">
        <h3>Layout</h3>
        <div className="settings-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => updateSettings({ leftWidth: 272, rightWidth: 296, leftOpen: true, rightOpen: true })}
          >
            <RotateCcw size={14} /> Reset panel widths
          </button>
          <button type="button" className="secondary-button" onClick={() => setOverlay("plugins")}>Plugins</button>
        </div>
      </section>
      <section className="settings-section">
        <h3>About</h3>
        <div className="about-grid">
          <span>Version</span><span>{bootstrap?.version ?? "0.1.0"}</span>
          <span>Platform</span><span>{bootstrap?.platform ?? "—"}</span>
          <span>Storage</span><span>SQLite + versioned BlockNote JSON</span>
          <span>Plugin SDK</span><span>1.x (sandboxed)</span>
        </div>
      </section>
      <section className="settings-section shortcuts-section">
        <h3>Keyboard</h3>
        <div className="shortcut-grid">
          <kbd>Ctrl/Cmd K</kbd><span>Command palette</span>
          <kbd>Ctrl/Cmd N</kbd><span>New page</span>
          <kbd>Ctrl/Cmd W</kbd><span>Close tab</span>
          <kbd>Ctrl/Cmd S</kbd><span>Save now</span>
          <kbd>Ctrl/Cmd B</kbd><span>Toggle sidebar</span>
          <kbd>Ctrl/Cmd Shift B</kbd><span>Toggle inspector</span>
        </div>
      </section>
    </Modal>
  );
}

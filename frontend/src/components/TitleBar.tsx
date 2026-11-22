import { useEffect, useState } from "react";
import { PanelRight } from "lucide-react";
import { useAppStore } from "../store";
import { TabStrip } from "./TabStrip";
import { WindowControls } from "./WindowControls";

export function TitleBar() {
  const platform = useAppStore((state) => state.bootstrap?.platform ?? "");
  const leftOpen = useAppStore((state) => state.settings.leftOpen);
  const rightOpen = useAppStore((state) => state.settings.rightOpen);
  const updateSettings = useAppStore((state) => state.updateSettings);
  const isMac = platform === "darwin";
  const [wide, setWide] = useState(() => window.innerWidth > 1180);

  useEffect(() => {
    const media = window.matchMedia("(min-width: 1181px)");
    const update = () => setWide(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  const inspectorVisible = rightOpen && wide;

  return (
    <header className={`titlebar ${isMac ? "titlebar-mac" : ""} ${isMac && leftOpen ? "titlebar-after-sidebar" : ""}`}>
      <TabStrip />
      <div className="titlebar-spacer" aria-hidden="true" />
      <div className="titlebar-right no-drag">
        {wide ? (
          <button
            type="button"
            className={`icon-button ${rightOpen ? "is-on" : ""}`}
            aria-label={rightOpen ? "Hide inspector" : "Show inspector"}
            aria-pressed={rightOpen}
            title={rightOpen ? "Hide inspector (Ctrl+Shift+B)" : "Show inspector (Ctrl+Shift+B)"}
            onClick={() => updateSettings({ rightOpen: !rightOpen })}
          >
            <PanelRight size={17} />
          </button>
        ) : null}
        {!isMac && !inspectorVisible ? <WindowControls /> : null}
      </div>
    </header>
  );
}

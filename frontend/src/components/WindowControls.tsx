import { Window } from "@wailsio/runtime";
import { Minus, Square, X } from "lucide-react";

export function WindowControls() {
  return (
    <div className="window-controls">
      <button type="button" className="window-button" aria-label="Minimise" title="Minimise" onClick={() => void Window.Minimise()}>
        <Minus size={15} />
      </button>
      <button type="button" className="window-button" aria-label="Maximise" title="Maximise" onClick={() => void Window.ToggleMaximise()}>
        <Square size={12} />
      </button>
      <button type="button" className="window-button window-close" aria-label="Close" title="Close" onClick={() => void Window.Close()}>
        <X size={15} />
      </button>
    </div>
  );
}

import { useAppStore } from "../store";

/** Open the assistant in the right sidebar, or close it when it is already showing. */
export function toggleAssistant(force?: boolean) {
  const state = useAppStore.getState();
  const showing = state.settings.rightOpen && state.rightTab === "assistant";
  const next = force ?? !showing;
  if (!next) {
    if (showing) state.updateSettings({ rightOpen: false });
    return;
  }
  state.setRightTab("assistant");
  if (!state.settings.rightOpen) state.updateSettings({ rightOpen: true });
  // Focus the composer once it has rendered.
  window.setTimeout(() => document.querySelector<HTMLTextAreaElement>(".assistant-input textarea")?.focus(), 60);
}

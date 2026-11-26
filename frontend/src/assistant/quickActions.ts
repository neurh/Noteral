/**
 * The AI button's ⌄ menu (top bar, right of the search box): one-click prompts for the
 * open page, starters that prefill the composer, chat shortcuts, and items plugins add to
 * the "assistant" menu slot.
 */
import { contributedMenuEntries } from "../components/ContributedMenuItems";
import type { PopupMenuItem } from "../lib/popups";
import { useAppStore } from "../store";
import { useComposer } from "./Composer";
import { toggleAssistant } from "./open";
import { useAssistant } from "./store";
import type { AssistantMode } from "./types";

function focusComposer(caretAtEnd = true) {
  window.setTimeout(() => {
    const input = document.querySelector<HTMLTextAreaElement>(".assistant-input textarea");
    if (!input) return;
    input.focus();
    if (caretAtEnd) input.setSelectionRange(input.value.length, input.value.length);
  }, 80);
}

function needMode(mode: AssistantMode) {
  const assistant = useAssistant.getState();
  const rank: Record<AssistantMode, number> = { ask: 0, edit: 1, creator: 2 };
  if (rank[assistant.settings.mode] < rank[mode]) assistant.setMode(mode);
}

/** Open the assistant and send a prompt right away. */
export function sendToAssistant(prompt: string, mode: AssistantMode = "ask") {
  toggleAssistant(true);
  void (async () => {
    await useAssistant.getState().init();
    needMode(mode);
    await useAssistant.getState().send(prompt);
  })().catch((error: unknown) => useAppStore.getState().notify(error instanceof Error ? error.message : String(error), "error"));
}

/** Open the assistant with the composer prefilled, for the user to finish. */
export function draftInAssistant(text: string, mode?: AssistantMode) {
  toggleAssistant(true);
  if (mode) needMode(mode);
  useComposer.getState().setDraft(text);
  focusComposer();
}

export function assistantQuickActions(): PopupMenuItem[] {
  const state = useAppStore.getState();
  const page = state.pages.find((item) => item.id === state.activePageId);
  const onPage = Boolean(page && page.kind !== "database" && page.kind !== "folder");
  const onDatabase = page?.kind === "database";
  const items: PopupMenuItem[] = [
    { id: "new", label: "New chat", icon: "square-pen", run: () => {
      useAssistant.getState().newChat();
      toggleAssistant(true);
    } },
    { id: "ask", label: "Ask about this page…", icon: "message-circle-question", disabled: !page, run: () => draftInAssistant("About this page: ") },
    { type: "separator" },
    { type: "header", label: "This page" },
    { id: "summarize", label: "Summarize", icon: "align-left", disabled: !onPage, run: () => sendToAssistant("Summarize the open page in a few short bullet points.") },
    { id: "todos", label: "Pull out action items", icon: "list-todo", disabled: !onPage, run: () => sendToAssistant("List every action item in the open page as a checklist, with owners and dates when they're mentioned.") },
    { id: "fix", label: "Fix spelling and grammar", icon: "spell-check", disabled: !onPage, run: () => sendToAssistant("Fix spelling and grammar in the open page. Keep the wording and formatting otherwise unchanged.", "edit") },
    {
      label: "Rewrite…",
      icon: "replace",
      disabled: !onPage,
      children: [
        { id: "rewrite-short", label: "Shorter", run: () => sendToAssistant("Rewrite the open page to be about half as long, keeping every key point.", "edit") },
        { id: "rewrite-clear", label: "Clearer", run: () => sendToAssistant("Rewrite the open page in plainer, clearer language. Keep its structure.", "edit") },
        { id: "rewrite-formal", label: "More formal", run: () => sendToAssistant("Rewrite the open page in a more formal, professional tone.", "edit") },
        { id: "rewrite-casual", label: "More casual", run: () => sendToAssistant("Rewrite the open page in a friendlier, more casual tone.", "edit") },
        { type: "separator" },
        { id: "rewrite-custom", label: "Custom…", run: () => draftInAssistant("Rewrite the open page so that ", "edit") },
      ],
    },
    { id: "translate", label: "Translate…", icon: "languages", disabled: !onPage, run: () => draftInAssistant("Translate the open page into ", "edit") },
    { id: "continue", label: "Continue writing", icon: "pen-line", disabled: !onPage, run: () => sendToAssistant("Continue writing the open page from where it ends, in the same voice. Add a few paragraphs at the end.", "edit") },
    ...(onDatabase
      ? [
          { id: "db-insights", label: "Find patterns in this database", icon: "chart-no-axes-column", run: () => sendToAssistant("Look through the open database and tell me the notable patterns, outliers and totals.") },
        ]
      : []),
    { type: "separator" },
    { type: "header", label: "Create" },
    { id: "outline", label: "Draft an outline…", icon: "list-tree", run: () => draftInAssistant("Draft an outline into the page about ", "edit") },
    { id: "table", label: "Create a database…", icon: "table-2", run: () => draftInAssistant("Create a database for ", "edit") },
    { id: "widget", label: "Build a widget…", icon: "layout-panel-left", run: () => draftInAssistant("Add a widget that ", "creator") },
    { id: "theme", label: "Restyle the app…", icon: "palette", run: () => draftInAssistant("Restyle the app to look ", "creator") },
    { id: "background", label: "Give this page a background…", icon: "image", disabled: !page, run: () => draftInAssistant("Give the open page a background: ", "creator") },
  ];
  const contributed = contributedMenuEntries({ menu: "assistant", ...(page ? { pageId: page.id, kind: page.kind ?? "page" } : {}) });
  if (contributed.length) items.push({ type: "separator" }, ...contributed);
  items.push(
    { type: "separator" },
    { id: "history", label: "Chat history", icon: "history", run: () => {
      toggleAssistant(true);
      useAssistant.getState().setView("history");
    } },
    { id: "settings", label: "Assistant settings", icon: "sliders-horizontal", run: () => {
      toggleAssistant(true);
      useAssistant.getState().setView("providers");
    } },
  );
  return items;
}

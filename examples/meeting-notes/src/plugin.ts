import type { PluginBlock } from "@noteral/sdk";

const template: PluginBlock[] = [
  { type: "heading", props: { level: 2 }, text: "Meeting notes" },
  { type: "paragraph", text: "Date: " + new Date().toISOString().slice(0, 10) },
  { type: "heading", props: { level: 3 }, text: "Attendees" },
  { type: "bulletListItem", text: "" },
  { type: "heading", props: { level: 3 }, text: "Agenda" },
  { type: "numberedListItem", text: "" },
  { type: "heading", props: { level: 3 }, text: "Decisions" },
  { type: "paragraph", text: "" },
  { type: "heading", props: { level: 3 }, text: "Action items" },
  { type: "checkListItem", props: { checked: false }, text: "Owner — action — due date" },
];

(window as unknown as { Noteral: { definePlugin(setup: (context: import("@noteral/sdk").PluginContext) => void | Promise<void>): void } }).Noteral.definePlugin((context) => {
  context.commands.on("insert-meeting-notes", async () => {
    await context.editor.insertBlocks(template);
    context.ui.notify("Meeting notes template inserted");
  });
});

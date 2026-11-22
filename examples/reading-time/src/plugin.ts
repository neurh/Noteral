import type { EditorSnapshot } from "@noteral/sdk";

type NoteralRuntime = {
  definePlugin(setup: (context: import("@noteral/sdk").PluginContext) => void | Promise<void>): void;
};

const runtime = (window as unknown as { Noteral: NoteralRuntime }).Noteral;

function render(snapshot: EditorSnapshot, context: import("@noteral/sdk").PluginContext) {
  const minutes = Math.max(1, Math.ceil(snapshot.wordCount / 220));
  const words = snapshot.wordCount === 1 ? "1 word" : `${snapshot.wordCount} words`;
  context.status.set("reading-time", `${words} · ${minutes} min read`, "Estimated at 220 words per minute");
  context.panels.set("reading-stats", `${words} on this page.\nAbout ${minutes} min at 220 words per minute.`);
}

runtime.definePlugin(async (context) => {
  await context.editor.snapshot().then((snapshot) => render(snapshot, context));
  context.events.on("document:changed", (data) => {
    render(data as EditorSnapshot, context);
  });
});

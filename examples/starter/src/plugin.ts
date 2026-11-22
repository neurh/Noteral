import type { EditorSnapshot } from "@noteral/sdk";

type Runtime = { definePlugin(setup: (context: import("@noteral/sdk").PluginContext) => void | Promise<void>): void };
const runtime = (window as unknown as { Noteral: Runtime }).Noteral;

runtime.definePlugin(async (context) => {
  const update = (snapshot: EditorSnapshot) => {
    context.status.set("words", `${snapshot.wordCount} words`);
    context.panels.set("starter-panel", `This page has ${snapshot.wordCount} words and ${snapshot.blockCount} blocks.`);
  };
  update(await context.editor.snapshot());
  context.events.on("document:changed", (data) => update(data as EditorSnapshot));
  context.commands.on("insert-summary", async () => {
    const snapshot = await context.editor.snapshot();
    await context.editor.insertBlocks([
      { type: "paragraph", text: `This page currently has ${snapshot.wordCount} words.` },
    ]);
  });
});

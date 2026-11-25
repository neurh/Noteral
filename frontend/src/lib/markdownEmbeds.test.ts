// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { blocksById, databaseMarker, databaseMarkerIds, embedsToMarkdown, markdownToEmbedBlocks, type EmbedBlock } from "./markdownEmbeds";
import { docJsonToMarkdown, markdownToDocJson } from "./markdownDoc";

// A stand-in for BlockNote: one paragraph per Markdown paragraph.
const toMd = (blocks: EmbedBlock[]) => blocks.map((block) => String((block.content as { text: string }[] | undefined)?.[0]?.text ?? "")).join("\n\n");
const parse = (markdown: string): EmbedBlock[] =>
  markdown
    .split(/\n{2,}/)
    .filter((part) => part.trim())
    .map((part) => ({ type: "paragraph", content: [{ type: "text", text: part.trim() }] }));
const para = (text: string, id?: string): EmbedBlock => ({ id, type: "paragraph", content: [{ type: "text", text }] });
const titles: Record<string, string> = { db_1: "Tasks", db_2: "Reading -- list" };
const titleOf = (id: string) => titles[id];

describe("markdownEmbeds", () => {
  it("writes database and custom blocks as marker lines", () => {
    const blocks: EmbedBlock[] = [para("Intro"), { id: "b1", type: "database", props: { databaseId: "db_1" } }, para("Outro"), { id: "b2", type: "custom", props: { kind: "kanban", data: "{}" } }];
    expect(embedsToMarkdown(blocks, toMd, titleOf)).toBe("Intro\n\n<!-- database:db_1 Tasks -->\n\nOutro\n\n<!-- block:b2 kanban -->");
  });

  it("keeps titles comment-safe", () => {
    expect(databaseMarker("db_2", titles.db_2)).toBe("<!-- database:db_2 Reading – list -->");
  });

  it("reads markers back into blocks and restores custom blocks by id", () => {
    const custom: EmbedBlock = { id: "b2", type: "custom", props: { kind: "kanban", data: '{"a":1}' }, children: [] };
    const blocks = markdownToEmbedBlocks("Intro\n\n<!-- database:db_1 Tasks -->\n<!-- block:b2 kanban -->\n\n<!-- block:gone x -->\nOutro", parse, { lookup: (id) => (id === "b2" ? custom : undefined) });
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "database", "custom", "paragraph"]);
    expect(blocks[1].props).toEqual({ databaseId: "db_1" });
    expect(blocks[2].props).toEqual(custom.props);
    expect(blocks[2].id).toBeUndefined();
  });

  it("ignores markers inside code fences and inline", () => {
    const markdown = "```html\n<!-- database:db_1 -->\n```\n\nSee <!-- database:db_2 --> here";
    const blocks = markdownToEmbedBlocks(markdown, parse);
    expect(blocks.every((block) => block.type === "paragraph")).toBe(true);
    expect(databaseMarkerIds(markdown)).toEqual(["db_1", "db_2"]);
  });

  it("indexes nested blocks", () => {
    expect([...blocksById([{ id: "a", children: [{ id: "b" }] }]).keys()]).toEqual(["a", "b"]);
  });
});

describe("markdownDoc round-trip", () => {
  const doc = JSON.stringify([
    { id: "p1", type: "heading", props: { level: 2 }, content: [{ type: "text", text: "Plan", styles: {} }], children: [] },
    { id: "d1", type: "database", props: { databaseId: "db_1" }, children: [] },
    { id: "c1", type: "custom", props: { kind: "kanban", data: '{"cols":3}' }, children: [] },
    { id: "p2", type: "paragraph", content: [{ type: "text", text: "Notes", styles: {} }], children: [] },
  ]);

  it("keeps embedded databases and custom blocks through Markdown", () => {
    const markdown = docJsonToMarkdown(doc, titleOf);
    expect(markdown).toContain("<!-- database:db_1 Tasks -->");
    expect(markdown).toContain("<!-- block:c1 kanban -->");
    const edited = markdown.replace("Notes", "More notes");
    const blocks = JSON.parse(markdownToDocJson(edited, doc)) as EmbedBlock[];
    expect(blocks.map((block) => block.type)).toEqual(["heading", "database", "custom", "paragraph"]);
    expect(blocks[1].props).toMatchObject({ databaseId: "db_1" });
    expect(blocks[2].props).toMatchObject({ kind: "kanban", data: '{"cols":3}' });
    expect(blocks.every((block) => typeof block.id === "string" && block.id)).toBe(true);
  });

  it("adds a database from a marker line in new Markdown", () => {
    const blocks = JSON.parse(markdownToDocJson("Before\n\n<!-- database:db_9 -->\n\nAfter")) as EmbedBlock[];
    expect(blocks.map((block) => block.type)).toEqual(["paragraph", "database", "paragraph"]);
  });
});

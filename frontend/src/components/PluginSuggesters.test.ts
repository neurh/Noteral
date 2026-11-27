import { describe, expect, it, vi } from "vitest";

vi.mock("../plugins/runtime", () => ({ pluginRuntime: { invoke: vi.fn() } }));
const { cleanItems } = await import("./PluginSuggesters");

describe("cleanItems", () => {
  it("keeps known fields, drops bad rows and unsafe links, caps the count", () => {
    const items = cleanItems(
      [
        { title: "Ada", subtitle: "Math", insert: "@Ada", link: "https://example.com/ada", extra: 1 },
        { title: "  " },
        null,
        "text",
        { title: "Eve", link: "javascript:alert(1)" },
        { title: "Page", link: "noteral://page/abc", data: { id: 3 } },
        { title: "Over" },
      ],
      3,
    );
    expect(items).toEqual([
      { id: undefined, title: "Ada", subtitle: "Math", group: undefined, insert: "@Ada", link: "https://example.com/ada", data: undefined },
      { id: undefined, title: "Eve", subtitle: undefined, group: undefined, insert: undefined, link: undefined, data: undefined },
      { id: undefined, title: "Page", subtitle: undefined, group: undefined, insert: undefined, link: "noteral://page/abc", data: { id: 3 } },
    ]);
    expect(cleanItems({ title: "x" }, 5)).toEqual([]);
  });
});

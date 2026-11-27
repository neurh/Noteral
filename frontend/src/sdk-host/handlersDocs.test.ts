import { describe, expect, it } from "vitest";
import { DOCS_HANDLERS } from "./handlersDocs";

const docs = DOCS_HANDLERS["plugins.docs"];

describe("plugins.docs", () => {
  it("lists what can be looked up", async () => {
    const result = await docs({});
    expect(result.index?.sections).toContain("Custom database property types");
    expect(result.index?.namespaces.storage).toBeGreaterThan(0);
    expect(result.index?.events.some((event) => event.startsWith("page:saved"))).toBe(true);
  });

  it("finds guide sections by topic", async () => {
    const overlays = await docs({ topic: "floating overlays" });
    expect(overlays.sections?.[0].title).toBe("Floating overlays");
    const types = await docs({ topic: "property types template" });
    expect(types.sections?.[0].title).toBe("Custom database property types");
    expect(types.sections?.[0].text).toContain("data-value");
  });

  it("documents plugin-only methods with parameters and return types", async () => {
    const result = await docs({ method: "storage.set" });
    expect(result.methods?.[0]).toMatchObject({ name: "storage.set", callers: ["plugin"] });
    expect(result.methods?.[0].params).toBeTruthy();
    const list = await docs({ method: "storage.list" });
    expect(Object.keys(list.types ?? {})).toContain("StorageEntryInfo");
  });

  it("lists a namespace and finds types", async () => {
    const ns = await docs({ method: "ui" });
    expect(ns.methods?.some((method) => method.name === "ui.setOverlay")).toBe(true);
    const type = await docs({ type: "PropertyTypeDefinition" });
    expect(type.types?.PropertyTypeDefinition).toContain("valueType");
  });

  it("explains misses", async () => {
    await expect(docs({ method: "nope.nothing" })).rejects.toThrow(/No method or namespace/);
    await expect(docs({ type: "Storage" })).rejects.toThrow(/Similar: .*StorageEntryInfo/);
  });
});

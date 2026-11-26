import { describe, expect, it } from "vitest";
import { newView, type DatabaseSchema } from "./database";
import { adaptViewTo, moveItem, parseRefs, resolveEntries, serializeRefs, sharedViews } from "./databaseRefs";

function schema(...views: ReturnType<typeof newView>[]): DatabaseSchema {
  return { version: 1, titleName: "Name", properties: [], views };
}

describe("database block view refs", () => {
  it("round-trips refs and ignores junk", () => {
    const refs = [{ db: "a", view: "v1" }, { db: "b", view: "v2" }];
    expect(parseRefs(serializeRefs(refs))).toEqual(refs);
    expect(serializeRefs([])).toBe("");
    expect(parseRefs("")).toEqual([]);
    expect(parseRefs("{not json")).toEqual([]);
    expect(parseRefs(JSON.stringify([{ db: "a" }, null, { db: "b", view: "x", extra: 1 }]))).toEqual([{ db: "b", view: "x" }]);
  });

  it("hides views owned by blocks from the shared list", () => {
    const shared = newView("table");
    const owned = { ...newView("board"), owner: "block-1" };
    expect(sharedViews(schema(shared, owned)).map((view) => view.id)).toEqual([shared.id]);
    // A database whose only views belong to blocks still shows something.
    expect(sharedViews(schema(owned)).map((view) => view.id)).toEqual([owned.id]);
  });

  it("resolves tabs across sources and falls back when refs are stale", () => {
    const a1 = newView("table");
    const a2 = { ...newView("board"), owner: "blk" };
    const b1 = { ...newView("chart"), owner: "blk" };
    const schemas = new Map<string, DatabaseSchema | undefined>([
      ["a", schema(a1, a2)],
      ["b", schema(b1)],
    ]);
    const linked = resolveEntries("a", [{ db: "a", view: a2.id }, { db: "b", view: b1.id }, { db: "gone", view: "x" }], schemas);
    expect(linked.linked).toBe(true);
    expect(linked.entries.map((entry) => [entry.source, entry.view.id])).toEqual([["a", a2.id], ["b", b1.id]]);

    const classic = resolveEntries("a", [], schemas);
    expect(classic.linked).toBe(false);
    expect(classic.entries.map((entry) => entry.view.id)).toEqual([a1.id]);

    const stale = resolveEntries("a", [{ db: "b", view: "deleted" }], schemas);
    expect(stale.linked).toBe(false);
  });

  it("moves an item before or after another", () => {
    const ids = ["a", "b", "c", "d"];
    const key = (id: string) => id;
    expect(moveItem(ids, key, "a", "c", false)).toEqual(["b", "a", "c", "d"]);
    expect(moveItem(ids, key, "a", "c", true)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(ids, key, "d", "a", false)).toEqual(["d", "a", "b", "c"]);
    expect(moveItem(ids, key, "x", "a", false)).toBe(ids);
    expect(moveItem(ids, key, "a", "a", true)).toBe(ids);
  });

  it("keeps display settings but drops property settings when a view changes source", () => {
    const old = { ...newView("table"), name: "Open bugs", icon: "🐞", wrap: true, limit: 25, groupBy: "prop_old", filters: [{ id: "f", propertyId: "prop_old", operator: "is", value: "x" }] } as unknown as ReturnType<typeof newView>;
    const fresh = newView("table");
    const adapted = adaptViewTo(old, fresh);
    expect(adapted.id).toBe(fresh.id);
    expect(adapted.name).toBe("Open bugs");
    expect(adapted.icon).toBe("🐞");
    expect(adapted.wrap).toBe(true);
    expect(adapted.limit).toBe(25);
    expect(adapted.groupBy).toBeUndefined();
    expect(adapted.filters).toEqual([]);
  });
});

import { describe, expect, it } from "vitest";
import { diffPages, isEmpty, summary } from "./pageEvents";

const page = (id: string, title: string, parentId = "", extra: Record<string, string> = {}) => ({ id, title, parentId, kind: "", ...extra });

describe("diffPages", () => {
  it("reports created, renamed, moved and deleted pages", () => {
    const before = [page("a", "A"), page("b", "B"), page("c", "C"), page("d", "D")];
    const after = [page("a", "A2"), page("b", "B", "a"), page("d", "D", "", { deletedAt: "now" }), page("e", "E", "a")];
    const changes = diffPages(before, after);
    expect(changes.created).toEqual([{ pageId: "e", title: "E", parentId: "a", kind: "page" }]);
    expect(changes.renamed).toEqual([{ pageId: "a", title: "A2", parentId: null, kind: "page", previousTitle: "A" }]);
    expect(changes.moved).toEqual([{ pageId: "b", title: "B", parentId: "a", kind: "page", previousParentId: null }]);
    expect(changes.deleted.map((item) => item.pageId).sort()).toEqual(["c", "d"]);
    expect(summary(changes, 3)).toEqual({ count: 3, created: ["e"], renamed: ["a"], moved: ["b"], deleted: ["c", "d"] });
  });

  it("is empty when nothing a plugin cares about changed", () => {
    expect(isEmpty(diffPages([page("a", "A")], [{ ...page("a", "A"), icon: "x" } as never]))).toBe(true);
  });
});

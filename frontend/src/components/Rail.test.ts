import { describe, expect, it } from "vitest";
import { nextTreeAction } from "./Rail";

describe("rail page-tree button", () => {
  it("opens the sidebar on the tree when it is closed", () => {
    expect(nextTreeAction(false, "tree")).toBe("open");
    expect(nextTreeAction(false, "favorites")).toBe("open");
    expect(nextTreeAction(false, "recent")).toBe("open");
    expect(nextTreeAction(false, "trash")).toBe("open");
  });

  it("switches an open sidebar to the tree instead of closing it", () => {
    expect(nextTreeAction(true, "favorites")).toBe("switch");
    expect(nextTreeAction(true, "recent")).toBe("switch");
    expect(nextTreeAction(true, "trash")).toBe("switch");
  });

  it("hides the sidebar when the tree is already showing", () => {
    expect(nextTreeAction(true, "tree")).toBe("hide");
  });
});

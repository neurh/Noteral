import { describe, expect, it } from "vitest";
import { kebabIconName, parsePageIcon, resolveIconName } from "./PageIcon";

describe("page icon parsing", () => {
  it("understands lucide names and colors", () => {
    expect(kebabIconName("BookOpen")).toBe("book-open");
    expect(resolveIconName("BookOpen")).toBe("book-open");
    expect(parsePageIcon("lucide:book-open:#b1533d")).toEqual({ kind: "lucide", name: "book-open", color: "#b1533d" });
    expect(parsePageIcon("lucide:BookOpen")).toEqual({ kind: "lucide", name: "book-open", color: undefined });
    expect(parsePageIcon("lucide:not-a-real-icon")).toBeNull();
  });

  it("understands emoji, uploaded images, and legacy values", () => {
    expect(parsePageIcon("emoji:👋🏽")).toEqual({ kind: "emoji", char: "👋🏽" });
    expect(parsePageIcon("🌿")).toEqual({ kind: "emoji", char: "🌿" });
    expect(parsePageIcon("upload:/__assets/ws/assets/icon.png")).toEqual({ kind: "image", src: "/__assets/ws/assets/icon.png" });
    expect(parsePageIcon("✦")).toBeNull();
    expect(parsePageIcon("")).toBeNull();
  });
});

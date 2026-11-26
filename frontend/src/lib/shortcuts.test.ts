import { describe, expect, it } from "vitest";
import { formatShortcut, matchesShortcut, parseShortcut, shortcutId, shortcutProblem } from "./shortcuts";

const key = (init: Partial<KeyboardEvent>) =>
  ({ key: "", code: "", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...init }) as KeyboardEvent;

describe("shortcuts", () => {
  it("parses modifiers in any spelling and order", () => {
    expect(shortcutId(parseShortcut("Mod+Shift+K")!)).toBe("mod+shift+k");
    expect(shortcutId(parseShortcut("shift + cmd + k")!)).toBe("mod+shift+k");
    expect(shortcutId(parseShortcut("Ctrl+Option+Up")!)).toBe("mod+alt+arrowup");
    expect(shortcutId(parseShortcut("F5")!)).toBe("f5");
    expect(parseShortcut("Mod+Hyper+K")).toBeNull();
    expect(parseShortcut("Mod+")).toBeNull();
  });

  it("refuses shortcuts that would clash with typing or the app", () => {
    expect(shortcutProblem("Mod+Shift+K")).toBe("");
    expect(shortcutProblem("Mod+Alt+J")).toBe("");
    expect(shortcutProblem("K")).toMatch(/needs Mod or Alt/);
    expect(shortcutProblem("Shift+K")).toMatch(/needs Mod or Alt/);
    expect(shortcutProblem("Alt+K")).toMatch(/types a character/);
    expect(shortcutProblem("Mod+K")).toMatch(/used by Noteral/);
    expect(shortcutProblem("Ctrl+Z")).toMatch(/used by Noteral/);
    expect(shortcutProblem("Mod+Alt+1")).toMatch(/used by Noteral/);
    expect(shortcutProblem("nonsense+")).toMatch(/not a shortcut/);
  });

  it("matches key presses by physical key, Ctrl or ⌘", () => {
    const shortcut = parseShortcut("Mod+Shift+K")!;
    expect(matchesShortcut(shortcut, key({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true }))).toBe(true);
    expect(matchesShortcut(shortcut, key({ key: "K", code: "KeyK", metaKey: true, shiftKey: true }))).toBe(true);
    expect(matchesShortcut(shortcut, key({ key: "k", code: "KeyK", ctrlKey: true }))).toBe(false);
    expect(matchesShortcut(shortcut, key({ key: "K", code: "KeyK", ctrlKey: true, shiftKey: true, altKey: true }))).toBe(false);
    const slash = parseShortcut("Mod+Shift+/")!;
    expect(matchesShortcut(slash, key({ key: "?", code: "Slash", ctrlKey: true, shiftKey: true }))).toBe(true);
  });

  it("formats in the app's style", () => {
    expect(formatShortcut(parseShortcut("Mod+Shift+K")!)).toBe("Ctrl/⌘ ⇧ K");
    expect(formatShortcut(parseShortcut("Mod+Alt+Down")!)).toBe("Ctrl/⌘ Alt ↓");
  });
});

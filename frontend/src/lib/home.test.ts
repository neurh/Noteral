import { describe, expect, it } from "vitest";
import { defaultHomeTabSettings, normalizeHomeTabSettings } from "./home";

describe("normalizeHomeTabSettings", () => {
  it("uses the default view for missing settings", () => {
    expect(normalizeHomeTabSettings()).toEqual(defaultHomeTabSettings);
    expect(normalizeHomeTabSettings(null)).toEqual(defaultHomeTabSettings);
  });

  it("keeps supported templates and backgrounds", () => {
    expect(normalizeHomeTabSettings({ template: "gallery", background: "dusk" })).toEqual({
      template: "gallery",
      background: "dusk",
    });
  });

  it("falls back when persisted values are unknown", () => {
    expect(normalizeHomeTabSettings({ template: "unknown", background: "neon" })).toEqual(defaultHomeTabSettings);
  });
});

import { describe, expect, it } from "vitest";
import { MAX_SUGGESTERS_PER_PLUGIN, pluginExtensions } from "./pluginExtensions";

const entry = (id: string, trigger = "@", pluginId = "com.test.a") => ({ pluginId, pluginName: "A", id, trigger, minChars: 0, maxItems: 10, onSelect: false });

describe("pluginExtensions", () => {
  it("registers, lists and removes suggesters by owner", () => {
    let calls = 0;
    const stop = pluginExtensions.subscribe(() => (calls += 1));
    pluginExtensions.addSuggester(entry("people"));
    pluginExtensions.addSuggester(entry("tags", "#", "com.test.b"));
    expect(pluginExtensions.getSuggesters().map((item) => item.id)).toEqual(["people", "tags"]);
    expect(pluginExtensions.listSuggesters("com.test.b")).toHaveLength(1);
    pluginExtensions.removeOwner("com.test.a");
    expect(pluginExtensions.getSuggesters().map((item) => item.id)).toEqual(["tags"]);
    pluginExtensions.removeSuggester("com.test.b", "tags");
    expect(pluginExtensions.getSuggesters()).toEqual([]);
    expect(calls).toBe(4);
    stop();
  });

  it("rejects reserved or long triggers and too many suggesters", () => {
    for (const trigger of ["/", ":", " ", "ab", ""]) expect(() => pluginExtensions.addSuggester(entry("x", trigger))).toThrow();
    expect(() => pluginExtensions.addSuggester(entry("emoji", "😀"))).not.toThrow();
    for (let index = 1; index < MAX_SUGGESTERS_PER_PLUGIN; index += 1) pluginExtensions.addSuggester(entry(`s${index}`));
    expect(() => pluginExtensions.addSuggester(entry("one-too-many"))).toThrow(/at most/);
    pluginExtensions.addSuggester(entry("s1", "!"));
    expect(pluginExtensions.listSuggesters("com.test.a").find((item) => item.id === "s1")?.trigger).toBe("!");
    pluginExtensions.removeOwner("com.test.a");
  });

  it("keeps one exposed API per plugin", () => {
    pluginExtensions.expose({ pluginId: "com.test.a", pluginName: "A", version: "1.0.0", methods: ["query"] });
    pluginExtensions.expose({ pluginId: "com.test.a", pluginName: "A", version: "1.0.0", methods: ["query", "count"] });
    expect(pluginExtensions.api("com.test.a")?.methods).toEqual(["query", "count"]);
    expect(() => pluginExtensions.expose({ pluginId: "com.test.b", pluginName: "B", version: "", methods: Array.from({ length: 101 }, (_, i) => `m${i}`) })).toThrow();
    pluginExtensions.removeOwner("com.test.a");
    expect(pluginExtensions.api("com.test.a")).toBeUndefined();
  });
});

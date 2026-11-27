import { describe, expect, it } from "vitest";
import {
  canGo,
  currentLocation,
  emptyBrowserData,
  go,
  navigate,
  newTabState,
  parseBrowserData,
  recordVisit,
  resolveInput,
  searchQueryOf,
  searchUrl,
  searchEngine,
  frameSource,
  cleanLocation,
  SEARCH_ENGINES,
  serializeBrowserData,
  suggest,
  titleForLocation,
  toggleBookmark,
} from "./model";
import { clipMarkdown } from "./clip";

describe("resolveInput", () => {
  it("opens addresses and searches everything else", () => {
    expect(resolveInput("https://example.com/a")).toBe("https://example.com/a");
    expect(resolveInput("example.com")).toBe("https://example.com/");
    expect(resolveInput("en.wikipedia.org/wiki/Notes")).toBe("https://en.wikipedia.org/wiki/Notes");
    expect(resolveInput("localhost:3000")).toBe("http://localhost:3000/");
    expect(resolveInput("192.168.1.4/x")).toBe("http://192.168.1.4/x");
    expect(resolveInput("how to take notes")).toBe("https://html.duckduckgo.com/html/?q=how+to+take+notes");
    expect(resolveInput("notes")).toBe("https://html.duckduckgo.com/html/?q=notes");
    expect(resolveInput("  ")).toBe("");
  });

  it("never turns other schemes into pages", () => {
    expect(searchQueryOf(resolveInput("javascript:alert(1)"))).toBe("javascript:alert(1)");
  });
});

describe("tab history", () => {
  it("goes back and forward, and a new visit drops the forward list", () => {
    let tab = newTabState("");
    tab = navigate(tab, "https://a.com/");
    tab = navigate(tab, "https://b.com/");
    expect(canGo(tab, 1)).toBe(false);
    tab = go(tab, -1);
    expect(currentLocation(tab)).toBe("https://a.com/");
    expect(canGo(tab, 1)).toBe(true);
    tab = navigate(tab, "https://c.com/");
    expect(tab.entries).toEqual(["", "https://a.com/", "https://c.com/"]);
    expect(canGo(tab, 1)).toBe(false);
  });

  it("names tabs", () => {
    expect(titleForLocation("")).toBe("Home");
    expect(titleForLocation(searchUrl("cats"))).toBe("cats – Search");
    expect(titleForLocation("https://www.example.com/x")).toBe("example.com");
    expect(titleForLocation("https://example.com/x", "Example")).toBe("Example");
  });
});

describe("bookmarks, history and suggestions", () => {
  it("toggles bookmarks and dedupes history", () => {
    let data = emptyBrowserData();
    data = toggleBookmark(data, "https://a.com/", "A site");
    expect(data.bookmarks).toHaveLength(1);
    data = recordVisit(data, "https://b.com/", "B docs");
    data = recordVisit(data, "https://a.com/", "A site");
    data = recordVisit(data, "https://b.com/", "B docs");
    expect(data.history.map((item) => item.url)).toEqual(["https://b.com/", "https://a.com/"]);
    expect(suggest(data, "site")).toEqual([{ url: "https://a.com/", title: "A site", bookmark: true }]);
    expect(suggest(data, "b.com")[0].url).toBe("https://b.com/");
    data = toggleBookmark(data, "https://a.com/", "A site");
    expect(data.bookmarks).toHaveLength(0);
  });
});

describe("search engines", () => {
  it("builds and reads back results addresses", () => {
    const google = SEARCH_ENGINES.find((engine) => engine.id === "google")!;
    expect(resolveInput("a & b", google)).toBe("https://www.google.com/search?q=a+%26+b");
    expect(searchQueryOf("https://www.google.com/search?q=a+%26+b")).toBe("a & b");
    expect(searchQueryOf("https://duckduckgo.com/?q=x")).toBe("x");
    expect(searchQueryOf("https://example.com/?q=x")).toBeNull();
  });

  it("uses a valid custom engine and falls back otherwise", () => {
    const custom = searchEngine({ searchEngine: "custom", customSearchUrl: "https://search.example.org/find?term=%s" });
    expect(custom).toMatchObject({ id: "custom", name: "search.example.org", param: "term" });
    expect(searchQueryOf(searchUrl("hi there", custom), [custom])).toBe("hi there");
    expect(searchEngine({ searchEngine: "custom", customSearchUrl: "nope" }).id).toBe("duckduckgo");
    expect(searchEngine({ searchEngine: "missing", customSearchUrl: "" }).id).toBe("duckduckgo");
  });

  it("frames sites through the app unless they allow framing", () => {
    expect(frameSource("https://example.com/a?b=1")).toBe("/__browse?url=https%3A%2F%2Fexample.com%2Fa%3Fb%3D1");
    expect(frameSource("https://www.google.com/search?q=x")).toBe("https://www.google.com/search?q=x&igu=1");
    expect(cleanLocation("https://www.google.com/search?q=x&igu=1")).toBe("https://www.google.com/search?q=x");
    expect(frameSource("")).toBe("");
  });

  it("turns old search locations into results pages", () => {
    const parsed = parseBrowserData(JSON.stringify({ tabs: { "web:a": { entries: ["search:cats"], index: 0 } } }));
    expect(parsed.tabs["web:a"].entries).toEqual(["https://html.duckduckgo.com/html/?q=cats"]);
  });
});

describe("persistence", () => {
  it("round-trips and keeps only open tabs", () => {
    let data = emptyBrowserData();
    data.tabs["web:one"] = navigate(newTabState(""), "https://a.com/");
    data.tabs["web:two"] = newTabState("https://b.com/");
    data = toggleBookmark(data, "https://a.com/", "A");
    const parsed = parseBrowserData(serializeBrowserData(data, ["web:one"]));
    expect(Object.keys(parsed.tabs)).toEqual(["web:one"]);
    expect(currentLocation(parsed.tabs["web:one"])).toBe("https://a.com/");
    expect(parsed.bookmarks[0].url).toBe("https://a.com/");
  });

  it("drops bad data instead of failing", () => {
    expect(parseBrowserData("not json")).toEqual(emptyBrowserData());
    const parsed = parseBrowserData(
      JSON.stringify({
        tabs: { "web:a": { entries: ["javascript:alert(1)", "https://ok.com/"], index: 9 }, "home:x": { entries: [""] } },
        bookmarks: [{ url: "file:///etc/passwd", title: "x" }, { url: "https://ok.com/", title: "Ok" }],
        prefs: { readerSize: 99, defaultMode: "reader", openLinksInApp: "yes" },
      }),
    );
    expect(Object.keys(parsed.tabs)).toEqual(["web:a"]);
    expect(parsed.tabs["web:a"].entries).toEqual(["https://ok.com/"]);
    expect(parsed.tabs["web:a"].index).toBe(0);
    expect(parsed.bookmarks.map((item) => item.url)).toEqual(["https://ok.com/"]);
    expect(parsed.prefs).toMatchObject({ readerSize: 17, defaultMode: "reader", openLinksInApp: true });
  });
});

describe("clipMarkdown", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  it("writes the source under articles", () => {
    const md = clipMarkdown({ kind: "article", url: "https://www.example.com/post", title: "Post", description: "A summary.", body: "Hello **world**." }, now);
    expect(md).toContain("[example.com](https://www.example.com/post)");
    expect(md).toContain("> A summary.");
    expect(md.endsWith("Hello **world**.")).toBe(true);
  });

  it("quotes selections and links bookmarks", () => {
    const quote = clipMarkdown({ kind: "selection", url: "https://a.com/", title: "A", body: "one\n\ntwo" }, now, true);
    expect(quote.startsWith("## A")).toBe(true);
    expect(quote).toContain("> one\n>\n> two");
    const link = clipMarkdown({ kind: "bookmark", url: "https://a.com/", title: "A [x]", description: "About" }, now);
    expect(link.startsWith("[A \\[x\\]](https://a.com/)")).toBe(true);
    expect(link).toContain("About");
  });
});

describe("page tidying", () => {
  it("drops the site name only when it names the site", async () => {
    const { tidyTitle, tidyArticle } = await import("./model");
    expect(tidyTitle("Note-taking - Wikipedia", "https://en.wikipedia.org/wiki/Note-taking")).toBe("Note-taking");
    expect(tidyTitle("How to write | The Verge", "https://www.theverge.com/x")).toBe("How to write");
    expect(tidyTitle("NotePal - Free Online Notepad", "https://notepal.me/")).toBe("NotePal - Free Online Notepad");
    expect(tidyTitle("Plain title", "https://example.com/")).toBe("Plain title");
    expect(tidyArticle("## History\n\n[[edit](https://en.wikipedia.org/w/index.php?action=edit&section=1)]\n\nText")).toBe("## History\n\nText");
  });
});

describe("redirects", () => {
  it("goes straight to search results' targets", async () => {
    const { unwrapRedirect } = await import("./model");
    expect(unwrapRedirect("https://duckduckgo.com/l/?uddg=https%3A%2F%2Fen.wikipedia.org%2Fwiki%2FNote&rut=x")).toBe("https://en.wikipedia.org/wiki/Note");
    expect(unwrapRedirect("https://www.google.com/url?q=https://example.com/a&sa=U")).toBe("https://example.com/a");
    expect(unwrapRedirect("https://duckduckgo.com/l/?uddg=javascript%3Aalert(1)")).toBe("https://duckduckgo.com/l/?uddg=javascript%3Aalert(1)");
    expect(unwrapRedirect("https://example.com/l/?uddg=https%3A%2F%2Fx.com")).toBe("https://example.com/l/?uddg=https%3A%2F%2Fx.com");
  });
});

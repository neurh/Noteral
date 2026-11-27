import { describe, expect, it } from "vitest";
import { dropLeadingTitle, prepareReadme } from "./readme";

const bases = { imageBase: "https://github.com/o/r/raw/HEAD/", linkBase: "https://github.com/o/r/blob/HEAD/" };

describe("prepareReadme", () => {
  it("resolves relative images and links against the repository", () => {
    const out = prepareReadme("![Shot](docs/screenshot.png)\n\nSee [the docs](docs/guide.md) or [site](https://x.dev).", bases);
    expect(out).toContain("![Shot](https://github.com/o/r/raw/HEAD/docs/screenshot.png)");
    expect(out).toContain("[the docs](https://github.com/o/r/blob/HEAD/docs/guide.md)");
    expect(out).toContain("[site](https://x.dev)");
  });

  it("turns common HTML into Markdown and drops badges", () => {
    const md = `<p align="center"><img src="./logo.png" alt="Logo" width="80"></p>
<h2 align="center">Hello</h2>
[![CI](https://github.com/o/r/actions/workflows/ci.yml/badge.svg)](https://github.com/o/r/actions) ![stars](https://img.shields.io/github/stars/o/r)
<a href="https://example.com">Example</a><br>Line two
<!-- hidden -->`;
    const out = prepareReadme(md, bases);
    expect(out).toContain("![Logo](https://github.com/o/r/raw/HEAD/logo.png)");
    expect(out).toContain("## Hello");
    expect(out).not.toMatch(/badge|shields|hidden|<\w/);
    expect(out).toContain("[Example](https://example.com)\nLine two");
  });

  it("unwraps linked screenshots and keeps code blocks verbatim", () => {
    const out = prepareReadme("[![Demo](demo.gif)](https://youtu.be/x)\n\n```html\n<img src=\"a.png\">\n```", bases);
    expect(out).toContain("![Demo](https://github.com/o/r/raw/HEAD/demo.gif)");
    expect(out).toContain('```html\n<img src="a.png">\n```');
  });

  it("refuses script URLs", () => {
    const out = prepareReadme('[x](javascript:alert(1)) <a href="data:text/html,hi">y</a>', bases);
    expect(out).not.toMatch(/javascript|data:/);
  });
});

describe("soft wraps", () => {
  it("joins hard-wrapped paragraph and list lines like GitHub", () => {
    const out = prepareReadme("One line\nwraps here.\n\n- **Item.** Text that\n  keeps going.\n- Next\n\n| a | b |\n| - | - |\n| 1 | 2 |\n\nHard  \nbreak", bases);
    expect(out).toContain("One line wraps here.");
    expect(out).toContain("- **Item.** Text that keeps going.\n- Next");
    expect(out).toContain("| a | b |\n| - | - |\n| 1 | 2 |");
    expect(out).toContain("Hard\nbreak");
  });
});

describe("dropLeadingTitle", () => {
  it("removes a title that repeats the plugin name", () => {
    expect(dropLeadingTitle("# Excalidraw for Noteral\n\nText", "Excalidraw")).toBe("Text");
    expect(dropLeadingTitle("# Install\n\nText", "Excalidraw")).toBe("# Install\n\nText");
  });
});

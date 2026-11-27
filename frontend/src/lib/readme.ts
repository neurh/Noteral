// Turns a GitHub README into the Markdown subset lib/markdownView renders:
// the common inline HTML becomes Markdown, badge rows are dropped, and
// relative image and link paths point at the repository.

export interface ReadmeBases {
  /** Prefix for relative images, e.g. https://github.com/o/r/raw/HEAD/ */
  imageBase: string;
  /** Prefix for relative links, e.g. https://github.com/o/r/blob/HEAD/ */
  linkBase: string;
}

const MAX_CHARS = 60_000;
const BREAK = "\u0001";

/** A line that starts its own block, so it never continues the line above. */
const BLOCK_START = /^\s*(#{1,6}\s|>|\||[-*+]\s|\d+[.)]\s|```|~~~|\u0000|!\[|(?:-{3,}|\*{3,}|_{3,})\s*$)/;

/**
 * GitHub joins hard-wrapped lines into one paragraph; our renderer keeps them
 * as line breaks. Join them here, keeping real breaks (<br>, two trailing
 * spaces, a trailing backslash).
 */
function joinSoftWraps(text: string): string {
  const out: string[] = [];
  let prevJoinable = false;
  for (const raw of text.split("\n")) {
    const hard = / {2,}$|\\$/.test(raw);
    const line = raw.replace(/[ \t]+$/, "").replace(/\\$/, "");
    const blank = !line.trim();
    if (!blank && prevJoinable && !BLOCK_START.test(line)) {
      out[out.length - 1] += ` ${line.trim()}`;
    } else {
      out.push(line);
    }
    const last = out[out.length - 1];
    prevJoinable = !blank && !hard && !last.endsWith(BREAK) && !/^\s*(#{1,6}\s|\||```|~~~|\u0000|!\[)/.test(last);
  }
  return out.join("\n").replace(new RegExp(`[ \\t]*${BREAK}[ \\t]*`, "g"), "\n");
}

function attr(tag: string, name: string): string {
  const match = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return (match?.[1] ?? match?.[2] ?? match?.[3] ?? "").trim();
}

function resolve(url: string, base: string): string {
  const value = url.trim().replace(/^<|>$/g, "");
  if (!value || /^(https?:|mailto:|#)/i.test(value)) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return ""; // javascript:, data: and friends
  if (value.startsWith("//")) return `https:${value}`;
  try {
    return new URL(value.replace(/^\//, ""), base).href;
  } catch {
    return "";
  }
}

/** Badges (shields.io and friends) are noise in a store page. */
function isBadge(src: string): boolean {
  return /(shields\.io|badge|badgen\.net|\/workflows\/.+\/badge|img\.shields|codecov\.io|travis-ci|buymeacoffee|ko-fi)/i.test(src);
}

function escapeAlt(text: string): string {
  return text.replace(/[[\]]/g, "").replace(/\s+/g, " ").trim();
}

export function prepareReadme(markdown: string, bases: ReadmeBases): string {
  let text = markdown.replace(/\r\n?/g, "\n").slice(0, MAX_CHARS);

  // Keep fenced code untouched while rewriting HTML around it.
  const fences: string[] = [];
  text = text.replace(/^(```|~~~)[^\n]*\n[\s\S]*?\n\1[ \t]*$/gm, (block) => {
    fences.push(block);
    return `\u0000${fences.length - 1}\u0000`;
  });

  text = text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<img\b[^>]*>/gi, (tag) => {
      const src = resolve(attr(tag, "src"), bases.imageBase);
      if (!src || isBadge(src)) return "";
      return `![${escapeAlt(attr(tag, "alt"))}](${src})`;
    })
    .replace(/<a\b[^>]*>([\s\S]*?)<\/a>/gi, (tag, inner: string) => {
      const href = resolve(attr(tag, "href"), bases.linkBase);
      const label = inner.trim();
      if (!label) return "";
      if (label.startsWith("![")) return label; // linked image: the image is what matters
      return href ? `[${label}](${href})` : label;
    })
    .replace(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi, (_, level: string, inner: string) => `\n\n${"#".repeat(Number(level))} ${inner.replace(/\s+/g, " ").trim()}\n\n`)
    .replace(/<br\s*\/?>/gi, BREAK)
    .replace(/<\/?(p|div|picture|source|details|summary|center|section|table|tbody|thead|tr|td|th)\b[^>]*>/gi, "\n")
    .replace(/<\/?(b|strong)>/gi, "**")
    .replace(/<\/?(i|em)>/gi, "*")
    .replace(/<\/?code>/gi, "`")
    .replace(/<\/?[a-z][a-z0-9-]*\b[^>]*>/gi, "");

  // Markdown images and linked images ([![alt](img)](link)).
  text = text
    .replace(/\[!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt: string, src: string) => {
      const url = resolve(src, bases.imageBase);
      return !url || isBadge(url) ? "" : `![${escapeAlt(alt)}](${url})`;
    })
    .replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_, alt: string, src: string) => {
      const url = resolve(src, bases.imageBase);
      return !url || isBadge(url) ? "" : `![${escapeAlt(alt)}](${url})`;
    })
    .replace(/(^|[^!])\[([^\]]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (_all, lead: string, label: string, href: string) => {
      if (href.startsWith("#")) return `${lead}${label}`; // in-page anchors go nowhere here
      const url = resolve(href, bases.linkBase);
      return url ? `${lead}[${label}](${url})` : `${lead}${label}`;
    })
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

  // Lines that only held badges are now blank; collapse the gaps.
  text = joinSoftWraps(text)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\u0000(\d+)\u0000/g, (_, index: string) => fences[Number(index)] ?? "");

  return text.trim();
}

/** The README's first heading usually repeats the plugin name, which the page already shows. */
export function dropLeadingTitle(markdown: string, name: string): string {
  const match = /^#\s+(.+)\n+/.exec(markdown);
  if (!match) return markdown;
  const norm = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, "");
  const title = norm(match[1]);
  const plugin = norm(name);
  return title && plugin && (title.includes(plugin) || plugin.includes(title)) ? markdown.slice(match[0].length) : markdown;
}

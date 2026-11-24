/**
 * A small, safe Markdown renderer for plugin panels and the assistant. It
 * builds React elements directly (never innerHTML), so text from plugins or
 * models can't inject markup or scripts. It covers what those surfaces
 * produce: headings, paragraphs, lists (nested, ordered, task), quotes,
 * fenced code, tables, rules and the usual inline styles and links.
 */
import { Fragment, memo, useState } from "react";
import type { ReactNode } from "react";
import { Check, Copy } from "lucide-react";

export type LinkHandler = (href: string) => void;

interface Options {
  onLink?: LinkHandler;
  keyPrefix: string;
}

// ── inline ────────────────────────────────────────────────────────────────

const INLINE = /(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)|\*\*([^*]+?)\*\*|__([^_]+?)__|~~([^~]+?)~~|\*([^*\s][^*]*?)\*|(?<![\w])_([^_\s][^_]*?)_(?![\w])|!?\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)|(https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"])/g;

function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:|noteral:)/i.test(trimmed)) return trimmed;
  if (trimmed.startsWith("#")) return trimmed;
  return null;
}

function renderLink(label: ReactNode, href: string, key: string, options: Options): ReactNode {
  const safe = safeHref(href);
  if (!safe) return <Fragment key={key}>{label}</Fragment>;
  return (
    <a
      key={key}
      href={safe}
      title={safe}
      onClick={(event) => {
        event.preventDefault();
        options.onLink?.(safe);
      }}
    >
      {label}
    </a>
  );
}

export function renderInline(text: string, options: Options): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let index = 0;
  // A fresh regex per call: the recursion below would otherwise reset a shared
  // lastIndex and loop forever (e.g. on "**bold*" while a reply streams in).
  const pattern = new RegExp(INLINE.source, "g");
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (match.index > last) out.push(text.slice(last, match.index));
    const key = `${options.keyPrefix}i${index++}`;
    const nested = { ...options, keyPrefix: `${key}.` };
    if (match[2] !== undefined) out.push(<code key={key}>{match[2]}</code>);
    else if (match[3] !== undefined) out.push(<strong key={key}>{renderInline(match[3], nested)}</strong>);
    else if (match[4] !== undefined) out.push(<strong key={key}>{renderInline(match[4], nested)}</strong>);
    else if (match[5] !== undefined) out.push(<del key={key}>{renderInline(match[5], nested)}</del>);
    else if (match[6] !== undefined) out.push(<em key={key}>{renderInline(match[6], nested)}</em>);
    else if (match[7] !== undefined) out.push(<em key={key}>{renderInline(match[7], nested)}</em>);
    else if (match[9] !== undefined) out.push(renderLink(match[8] ? renderInline(match[8], nested) : match[9], match[9], key, options));
    else if (match[10] !== undefined) out.push(renderLink(match[10], match[10], key, options));
    last = pattern.lastIndex;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function inlineWithBreaks(text: string, options: Options): ReactNode[] {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  lines.forEach((line, i) => {
    if (i > 0) out.push(<br key={`${options.keyPrefix}br${i}`} />);
    out.push(...renderInline(line.replace(/\s{2,}$|\\$/, ""), { ...options, keyPrefix: `${options.keyPrefix}l${i}.` }));
  });
  return out;
}

// ── blocks ────────────────────────────────────────────────────────────────

type Block =
  | { kind: "heading"; level: number; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "code"; lang: string; code: string; open: boolean }
  | { kind: "quote"; body: string }
  | { kind: "list"; ordered: boolean; start: number; items: ListItem[] }
  | { kind: "table"; header: string[]; align: ("left" | "center" | "right" | null)[]; rows: string[][] }
  | { kind: "rule" };

interface ListItem {
  body: string;
  checked: boolean | null;
}

const LIST_ITEM = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith("|")) row = row.slice(1);
  if (row.endsWith("|") && !row.endsWith("\\|")) row = row.slice(0, -1);
  return row.split(/(?<!\\)\|/).map((cell) => cell.trim().replace(/\\\|/g, "|"));
}

function isTableDivider(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line) && line.includes("-");
}

function startsBlock(line: string): boolean {
  return /^\s{0,3}(#{1,6}\s|```|~~~|>|([-*_])(\s*\2){2,}\s*$)/.test(line) || LIST_ITEM.test(line);
}

export function parseBlocks(source: string): Block[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) {
      i++;
      continue;
    }
    const fence = /^\s{0,3}(```+|~~~+)\s*([\w+#.-]*)/.exec(line);
    if (fence) {
      const marker = fence[1];
      const body: string[] = [];
      i++;
      let open = true;
      while (i < lines.length) {
        if (lines[i].trimStart().startsWith(marker)) {
          open = false;
          i++;
          break;
        }
        body.push(lines[i]);
        i++;
      }
      blocks.push({ kind: "code", lang: fence[2] ?? "", code: body.join("\n"), open });
      continue;
    }
    const heading = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (heading) {
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      i++;
      continue;
    }
    if (/^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ kind: "rule" });
      i++;
      continue;
    }
    if (/^\s{0,3}>/.test(line)) {
      const body: string[] = [];
      while (i < lines.length && /^\s{0,3}>/.test(lines[i])) {
        body.push(lines[i].replace(/^\s{0,3}>\s?/, ""));
        i++;
      }
      blocks.push({ kind: "quote", body: body.join("\n") });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) {
      const header = splitRow(line);
      const align = splitRow(lines[i + 1]).map((cell) => {
        const left = cell.startsWith(":");
        const right = cell.endsWith(":");
        return left && right ? "center" : right ? "right" : left ? "left" : null;
      });
      const rows: string[][] = [];
      i += 2;
      while (i < lines.length && lines[i].trim() && lines[i].includes("|")) {
        rows.push(splitRow(lines[i]));
        i++;
      }
      blocks.push({ kind: "table", header, align, rows });
      continue;
    }
    const item = LIST_ITEM.exec(line);
    if (item) {
      const baseIndent = item[1].length;
      const ordered = /\d/.test(item[2]);
      const items: ListItem[] = [];
      let current: string[] | null = null;
      const flush = () => {
        if (!current) return;
        const first = current[0] ?? "";
        const task = /^\[([ xX])\]\s+/.exec(first);
        if (task) current[0] = first.slice(task[0].length);
        items.push({ body: current.join("\n"), checked: task ? task[1] !== " " : null });
      };
      while (i < lines.length) {
        const next = lines[i];
        const match = LIST_ITEM.exec(next);
        if (match && match[1].length <= baseIndent + 1 && /\d/.test(match[2]) === ordered) {
          flush();
          current = [match[3]];
          i++;
          continue;
        }
        if (!next.trim()) {
          // A blank line ends the list unless an indented continuation follows.
          const after = lines[i + 1];
          if (after !== undefined && (/^\s{2,}\S/.test(after) || (LIST_ITEM.exec(after)?.[1].length ?? -1) > baseIndent)) {
            current?.push("");
            i++;
            continue;
          }
          break;
        }
        if (/^\s{2,}/.test(next) && current) {
          current.push(next.replace(new RegExp(`^\\s{0,${baseIndent + 4}}`), ""));
          i++;
          continue;
        }
        if (match || startsBlock(next) || !current) break;
        current.push(next.trim()); // lazy continuation
        i++;
      }
      flush();
      blocks.push({ kind: "list", ordered, start: ordered ? Number.parseInt(item[2], 10) || 1 : 1, items });
      continue;
    }
    const body: string[] = [];
    while (i < lines.length && lines[i].trim() && !(body.length && startsBlock(lines[i]))) {
      if (lines[i].includes("|") && i + 1 < lines.length && isTableDivider(lines[i + 1])) break;
      body.push(lines[i]);
      i++;
    }
    if (body.length) blocks.push({ kind: "paragraph", text: body.join("\n") });
    else i++;
  }
  return blocks;
}

function CodeBlock({ lang, code }: { lang: string; code: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1400);
    });
  };
  return (
    <div className="md-code">
      <div className="md-code-bar">
        <span>{lang || "text"}</span>
        <button type="button" onClick={copy} title="Copy code" aria-label="Copy code">
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre><code>{code}</code></pre>
    </div>
  );
}

function renderBlocks(blocks: Block[], options: Options): ReactNode[] {
  return blocks.map((block, index) => {
    const key = `${options.keyPrefix}b${index}`;
    const inner = { ...options, keyPrefix: `${key}.` };
    switch (block.kind) {
      case "heading": {
        const Tag = `h${Math.min(6, block.level + 1)}` as "h2";
        return <Tag key={key}>{renderInline(block.text, inner)}</Tag>;
      }
      case "paragraph":
        return <p key={key}>{inlineWithBreaks(block.text, inner)}</p>;
      case "code":
        return <CodeBlock key={key} lang={block.lang} code={block.code} />;
      case "quote":
        return <blockquote key={key}>{renderBlocks(parseBlocks(block.body), inner)}</blockquote>;
      case "rule":
        return <hr key={key} />;
      case "table":
        return (
          <div className="md-table" key={key}>
            <table>
              <thead>
                <tr>{block.header.map((cell, c) => <th key={c} style={{ textAlign: block.align[c] ?? undefined }}>{renderInline(cell, { ...inner, keyPrefix: `${key}h${c}` })}</th>)}</tr>
              </thead>
              <tbody>
                {block.rows.map((row, r) => (
                  <tr key={r}>{block.header.map((_, c) => <td key={c} style={{ textAlign: block.align[c] ?? undefined }}>{renderInline(row[c] ?? "", { ...inner, keyPrefix: `${key}r${r}c${c}` })}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>
        );
      case "list": {
        const items = block.items.map((item, n) => {
          const children = parseBlocks(item.body);
          const itemOptions = { ...inner, keyPrefix: `${key}li${n}.` };
          // Tight items render their single paragraph inline.
          const content = children.length === 1 && children[0].kind === "paragraph"
            ? inlineWithBreaks(children[0].text, itemOptions)
            : renderBlocks(children, itemOptions);
          if (item.checked === null) return <li key={n}>{content}</li>;
          return (
            <li key={n} className={`md-task${item.checked ? " done" : ""}`}>
              <span className="md-check" aria-hidden="true">{item.checked ? <Check size={10} strokeWidth={3} /> : null}</span>
              <span>{content}</span>
            </li>
          );
        });
        return block.ordered ? <ol key={key} start={block.start}>{items}</ol> : <ul key={key}>{items}</ul>;
      }
    }
  });
}

export interface MarkdownProps {
  source: string;
  className?: string;
  onLink?: LinkHandler;
}

export const Markdown = memo(function Markdown({ source, className, onLink }: MarkdownProps) {
  return <div className={`md${className ? ` ${className}` : ""}`}>{renderBlocks(parseBlocks(source), { onLink, keyPrefix: "" })}</div>;
});

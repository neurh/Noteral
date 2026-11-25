/**
 * Find-and-replace edits, the token-cheap way to change a long text (a page, a widget's
 * HTML, a plugin's code): send only the part that changes instead of the whole thing.
 */
export interface TextEdit {
  /** Exact text to find. Must match once unless `all` is set. */
  find: string;
  replace: string;
  /** Replace every occurrence. */
  all?: boolean;
}

export interface EditOutcome {
  text: string;
  /** Occurrences replaced, over all edits. */
  replaced: number;
  /** Edits that only matched after collapsing whitespace differences. */
  loose: number;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** A pattern for `find` where any run of whitespace matches any other run. */
function loosePattern(find: string): RegExp {
  const parts = find.trim().split(/\s+/).map(escapeRegExp);
  return new RegExp(parts.join("\\s+"), "g");
}

function count(text: string, find: string): number {
  let n = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) n += 1;
  return n;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split("\n").length;
}

/** The line that shares the longest prefix with `find`, to point at near misses. */
function nearest(text: string, find: string): string {
  const head = find.trim().split("\n")[0].trim();
  if (head.length < 4) return "";
  for (let size = Math.min(head.length, 60); size >= 4; size = Math.floor(size * 0.6)) {
    const at = text.indexOf(head.slice(0, size));
    if (at !== -1) {
      const start = text.lastIndexOf("\n", at) + 1;
      const end = text.indexOf("\n", at);
      return ` The closest match is line ${lineOf(text, at)}: "${text.slice(start, end === -1 ? undefined : end).trim().slice(0, 160)}".`;
    }
  }
  return "";
}

/**
 * Applies edits in order; each sees the result of the ones before. Throws on the first edit
 * that can't be applied, so nothing is half-changed. Exact matches win; otherwise a match
 * that differs only in whitespace (indentation, line breaks) is accepted when unique.
 */
export function applyEdits(source: string, edits: readonly TextEdit[], what = "the text"): EditOutcome {
  if (!edits.length) throw new Error("edits is empty.");
  let text = source;
  let replaced = 0;
  let loose = 0;
  edits.forEach((edit, index) => {
    const label = edits.length > 1 ? `Edit ${index + 1}: ` : "";
    const find = String(edit.find ?? "");
    const replace = String(edit.replace ?? "");
    if (!find) throw new Error(`${label}find is empty. To add text, find a nearby line and include it in replace.`);
    const exact = count(text, find);
    if (exact > 1 && !edit.all) {
      throw new Error(`${label}"${find.slice(0, 80)}" appears ${exact} times in ${what}. Include more surrounding text so it matches once, or set all: true.`);
    }
    if (exact > 0) {
      text = edit.all ? text.split(find).join(replace) : text.replace(find, () => replace);
      replaced += edit.all ? exact : 1;
      return;
    }
    const pattern = loosePattern(find);
    const matches = [...text.matchAll(pattern)];
    if (matches.length === 1 || (matches.length > 1 && edit.all)) {
      text = edit.all ? text.replace(pattern, () => replace) : text.replace(new RegExp(pattern.source), () => replace);
      replaced += matches.length;
      loose += 1;
      return;
    }
    if (matches.length > 1) {
      throw new Error(`${label}"${find.slice(0, 80)}" appears ${matches.length} times in ${what} (ignoring whitespace). Include more surrounding text, or set all: true.`);
    }
    throw new Error(`${label}"${find.slice(0, 80)}" was not found in ${what}.${nearest(text, find)} Read the current text again and copy the part to change exactly.`);
  });
  return { text, replaced, loose };
}

/**
 * Plain-text search over a ProseMirror document, for the editor's find bar.
 *
 * Matches never cross a textblock boundary or an inline atom (a page link),
 * so every result maps back to one contiguous run of text that can be
 * highlighted, selected or replaced in place.
 */

export interface FindNode {
  isText?: boolean;
  isTextblock?: boolean;
  isAtom?: boolean;
  isLeaf?: boolean;
  text?: string | null;
  nodeSize: number;
  forEach?: (callback: (child: FindNode, offset: number) => void) => void;
  descendants: (callback: (node: FindNode, pos: number) => boolean | void) => void;
}

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindOptions {
  caseSensitive?: boolean;
  /** Stop after this many matches so a one-letter query on a long page stays fast. */
  limit?: number;
}

/** A character that can never be typed into a query, used to break runs. */
const BREAK = "\u0000";

export function findInDoc(doc: FindNode, query: string, options: FindOptions = {}): FindMatch[] {
  if (!query) return [];
  const limit = options.limit ?? 2000;
  const needle = options.caseSensitive ? query : query.toLocaleLowerCase();
  const matches: FindMatch[] = [];

  doc.descendants((node, pos) => {
    if (matches.length >= limit) return false;
    if (!node.isTextblock) return true;
    // Flatten the block's inline content into one string plus a map from each
    // character back to its document position.
    let text = "";
    const positions: number[] = [];
    node.forEach?.((child, offset) => {
      const start = pos + 1 + offset;
      if (child.isText && child.text) {
        for (let index = 0; index < child.text.length; index += 1) positions.push(start + index);
        text += child.text;
      } else {
        positions.push(start);
        text += BREAK;
      }
    });
    if (!text) return false;
    const haystack = options.caseSensitive ? text : text.toLocaleLowerCase();
    // Lower-casing can change string length for a few scripts; fall back to the
    // original text then, so positions stay aligned.
    const source = haystack.length === text.length ? haystack : text;
    let index = source.indexOf(needle);
    while (index !== -1 && matches.length < limit) {
      const end = index + needle.length;
      matches.push({ from: positions[index], to: positions[end - 1] + 1 });
      index = source.indexOf(needle, end);
    }
    return false;
  });

  return matches;
}

/** Index of the first match at or after `pos`, wrapping to 0. */
export function matchIndexFrom(matches: FindMatch[], pos: number): number {
  if (!matches.length) return -1;
  const index = matches.findIndex((match) => match.from >= pos);
  return index === -1 ? 0 : index;
}

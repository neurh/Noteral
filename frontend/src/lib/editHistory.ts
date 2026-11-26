/**
 * Undo / redo history for a plain-text editor whose value is set from code
 * (completions, inserts, AI edits): the browser's own undo stack breaks as
 * soon as a controlled textarea's value is replaced, so the editor keeps its
 * own. Consecutive typing (or deleting) within a short pause is one step.
 */

export interface EditState {
  text: string;
  /** Caret to restore when this state comes back. */
  caret: number;
}

/** "type" and "delete" coalesce with the step before them; "replace" always starts a new step. */
export type EditKind = "type" | "delete" | "replace";

export interface EditHistory {
  past: EditState[];
  present: EditState;
  future: EditState[];
  /** Kind and time of the last recorded edit, for coalescing. */
  lastKind?: EditKind;
  lastAt: number;
}

export const HISTORY_LIMIT = 200;
/** Edits of the same kind closer together than this merge into one step. */
export const COALESCE_MS = 700;

export function createHistory(text: string, caret = text.length): EditHistory {
  return { past: [], present: { text, caret }, future: [], lastAt: 0 };
}

/** Kind of change from `before` to `after` (a plain insert, a plain delete, or anything else). */
export function editKind(before: string, after: string): EditKind {
  if (after.length > before.length) {
    // One run of characters added somewhere, and no newline (a new line is its own step).
    let start = 0;
    while (start < before.length && before[start] === after[start]) start++;
    const added = after.length - before.length;
    const inserted = after.slice(start, start + added);
    return before.slice(start) === after.slice(start + added) && !inserted.includes("\n") && added <= 2 ? "type" : "replace";
  }
  if (after.length < before.length) {
    let start = 0;
    while (start < after.length && before[start] === after[start]) start++;
    const removed = before.length - after.length;
    return before.slice(start + removed) === after.slice(start) && removed <= 2 ? "delete" : "replace";
  }
  return "replace";
}

/** Records a new state. No-op when the text is unchanged. */
export function record(history: EditHistory, next: EditState, kind: EditKind = editKind(history.present.text, next.text), now = Date.now()): EditHistory {
  if (next.text === history.present.text) return { ...history, present: { ...history.present, caret: next.caret } };
  const merge = kind !== "replace" && kind === history.lastKind && now - history.lastAt < COALESCE_MS && history.past.length > 0;
  const past = merge ? history.past : [...history.past, history.present].slice(-HISTORY_LIMIT);
  return { past, present: next, future: [], lastKind: kind, lastAt: now };
}

export function canUndo(history: EditHistory): boolean {
  return history.past.length > 0;
}

export function canRedo(history: EditHistory): boolean {
  return history.future.length > 0;
}

export function undo(history: EditHistory): EditHistory {
  if (!history.past.length) return history;
  const present = history.past[history.past.length - 1];
  return { past: history.past.slice(0, -1), present, future: [history.present, ...history.future], lastAt: 0 };
}

export function redo(history: EditHistory): EditHistory {
  if (!history.future.length) return history;
  const [present, ...future] = history.future;
  return { past: [...history.past, history.present], present, future, lastAt: 0 };
}

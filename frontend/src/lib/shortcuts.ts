/**
 * Keyboard shortcuts for commands (plugin commands bind them through the
 * manifest or `commands.register`). A shortcut is written like
 * "Mod+Shift+K": `Mod` is Ctrl on Windows/Linux and ⌘ on macOS.
 */

export interface Shortcut {
  mod: boolean;
  alt: boolean;
  shift: boolean;
  /** Lower-case key name: a letter or digit, "f1"…"f12", "arrowup", "enter", ",", … */
  key: string;
}

const NAMED_KEYS: Record<string, string> = {
  up: "arrowup",
  down: "arrowdown",
  left: "arrowleft",
  right: "arrowright",
  arrowup: "arrowup",
  arrowdown: "arrowdown",
  arrowleft: "arrowleft",
  arrowright: "arrowright",
  enter: "enter",
  return: "enter",
  space: " ",
  tab: "tab",
  backspace: "backspace",
  delete: "delete",
  del: "delete",
  home: "home",
  end: "end",
  pageup: "pageup",
  pagedown: "pagedown",
  escape: "escape",
  esc: "escape",
};

const PUNCTUATION = new Set([",", ".", "/", ";", "'", "[", "]", "-", "=", "`", "\\"]);

/**
 * Shortcuts the app or the editor already uses. Plugins cannot take these, so
 * a plugin can never break typing, undo, copy/paste or the app's own keys.
 */
const RESERVED = new Set(
  [
    // App
    "mod+k", "mod+p", "mod+n", "mod+t", "mod+w", "mod+s", "mod+b", "mod+f", "mod+h", "mod+\\", "mod+shift+\\",
    "mod+,", "mod+shift+p", "mod+shift+t", "mod+shift+n", "mod+shift+f",
    // Editing
    "mod+z", "mod+y", "mod+shift+z", "mod+a", "mod+c", "mod+v", "mod+x", "mod+shift+v",
    "mod+i", "mod+u", "mod+e", "mod+shift+s", "mod+shift+x", "mod+shift+h", "mod+shift+e",
    "mod+alt+0", "mod+alt+1", "mod+alt+2", "mod+alt+3", "mod+alt+4", "mod+alt+5", "mod+alt+6",
    "mod+shift+6", "mod+shift+7", "mod+shift+8", "mod+shift+9",
    "mod+shift+arrowup", "mod+shift+arrowdown", "mod+[", "mod+]",
    "mod+enter", "mod+backspace", "mod+delete", "mod+arrowleft", "mod+arrowright", "mod+arrowup", "mod+arrowdown",
    "mod+home", "mod+end", "mod+shift+o", "mod+tab", "mod+shift+tab", "mod+r", "mod+shift+r", "mod+q", "mod+=", "mod+-", "mod+0",
  ],
);

function isFunctionKey(key: string) {
  return /^f([1-9]|1[0-2])$/.test(key);
}

/** Parses "Mod+Shift+K" (case-insensitive; Ctrl/Cmd/Meta all mean Mod, Option means Alt). */
export function parseShortcut(value: string): Shortcut | null {
  const parts = value
    .trim()
    .split(/\s*\+\s*(?=.)/)
    .map((part) => part.trim().toLowerCase())
    .filter(Boolean);
  if (!parts.length || parts.length > 4) return null;
  const shortcut: Shortcut = { mod: false, alt: false, shift: false, key: "" };
  for (const [index, part] of parts.entries()) {
    const last = index === parts.length - 1;
    if (!last) {
      if (["mod", "ctrl", "control", "cmd", "command", "meta", "⌘"].includes(part)) shortcut.mod = true;
      else if (["alt", "option", "opt", "⌥"].includes(part)) shortcut.alt = true;
      else if (["shift", "⇧"].includes(part)) shortcut.shift = true;
      else return null;
      continue;
    }
    if (/^[a-z0-9]$/.test(part) || PUNCTUATION.has(part) || isFunctionKey(part)) shortcut.key = part;
    else if (NAMED_KEYS[part]) shortcut.key = NAMED_KEYS[part];
    else return null;
  }
  return shortcut;
}

/** Canonical form, e.g. "mod+alt+shift+k". Two shortcuts are the same when these match. */
export function shortcutId(shortcut: Shortcut): string {
  return [shortcut.mod && "mod", shortcut.alt && "alt", shortcut.shift && "shift", shortcut.key].filter(Boolean).join("+");
}

/** Why a plugin may not bind this shortcut, or "" when it may. */
export function shortcutProblem(value: string): string {
  const shortcut = parseShortcut(value);
  if (!shortcut) return `"${value}" is not a shortcut. Write it like "Mod+Shift+K".`;
  if (!shortcut.mod && !shortcut.alt && !isFunctionKey(shortcut.key)) {
    return `"${value}" needs Mod or Alt (or an F key), so it does not clash with typing.`;
  }
  if (shortcut.alt && !shortcut.mod && /^[a-z0-9]$/.test(shortcut.key)) {
    return `"${value}" types a character on some keyboards. Add Mod.`;
  }
  if (RESERVED.has(shortcutId(shortcut))) return `"${value}" is used by Noteral.`;
  return "";
}

const KEY_LABELS: Record<string, string> = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "Enter",
  " ": "Space",
  tab: "Tab",
  backspace: "Backspace",
  delete: "Delete",
  home: "Home",
  end: "End",
  pageup: "PgUp",
  pagedown: "PgDn",
  escape: "Esc",
};

/** Display text in the app's style: "Ctrl/⌘ ⇧ K". */
export function formatShortcut(shortcut: Shortcut): string {
  const key = KEY_LABELS[shortcut.key] ?? shortcut.key.toUpperCase();
  return [shortcut.mod && "Ctrl/⌘", shortcut.alt && "Alt", shortcut.shift && "⇧", key].filter(Boolean).join(" ");
}

/** The key the event was for, independent of Shift and the keyboard layout where possible. */
const CODE_KEYS: Record<string, string> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Minus: "-",
  Equal: "=",
  Backquote: "`",
  Backslash: "\\",
};

function eventKey(event: Pick<KeyboardEvent, "key" | "code">): string {
  const code = event.code ?? "";
  if (/^Key[A-Z]$/.test(code)) return code.slice(3).toLowerCase();
  if (/^(Digit|Numpad)[0-9]$/.test(code)) return code.slice(-1);
  if (CODE_KEYS[code]) return CODE_KEYS[code];
  const key = (event.key ?? "").toLowerCase();
  return key === "spacebar" ? " " : key;
}

export function matchesShortcut(shortcut: Shortcut, event: Pick<KeyboardEvent, "key" | "code" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): boolean {
  const mod = event.ctrlKey || event.metaKey;
  return mod === shortcut.mod && event.altKey === shortcut.alt && event.shiftKey === shortcut.shift && eventKey(event) === shortcut.key;
}

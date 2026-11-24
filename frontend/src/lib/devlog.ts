/**
 * A small in-memory log of what plugins and HTML views report (errors, console output,
 * lifecycle). Read by `plugins.logs` / `plugins.test` so the assistant and developers can
 * see why something broke.
 */
export interface LogEntry {
  at: number;
  level: "info" | "warn" | "error";
  /** "plugin:<id>", "layer:<id>" or "view:<key>". */
  source: string;
  message: string;
}

const MAX = 400;
const entries: LogEntry[] = [];

export const devlog = {
  add(source: string, level: LogEntry["level"], message: string) {
    entries.push({ at: Date.now(), level, source, message: message.slice(0, 1000) });
    if (entries.length > MAX) entries.splice(0, entries.length - MAX);
  },
  /** Entries whose source starts with the prefix, newest last. */
  read(prefix: string, since = 0, limit = 100): LogEntry[] {
    return entries.filter((entry) => entry.at >= since && (entry.source === prefix || entry.source.startsWith(prefix))).slice(-limit);
  },
  clear(prefix: string) {
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].source.startsWith(prefix)) entries.splice(i, 1);
  },
};

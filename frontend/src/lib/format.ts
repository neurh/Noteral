export function formatDate(value: string | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function relativeTime(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const seconds = Math.round((date.getTime() - Date.now()) / 1000);
  const abs = Math.abs(seconds);
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
  if (abs < 45) return "just now";
  if (abs < 3600) return formatter.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return formatter.format(Math.round(seconds / 3600), "hour");
  if (abs < 2592000) return formatter.format(Math.round(seconds / 86400), "day");
  return formatDate(value).split(",")[0];
}

export function splitSnippet(snippet: string): Array<{ text: string; mark: boolean }> {
  const parts: Array<{ text: string; mark: boolean }> = [];
  let buffer = "";
  let marked = false;
  for (const char of snippet) {
    if (char === "\uE000") {
      if (buffer) parts.push({ text: buffer, mark: marked });
      buffer = "";
      marked = true;
    } else if (char === "\uE001") {
      if (buffer) parts.push({ text: buffer, mark: marked });
      buffer = "";
      marked = false;
    } else {
      buffer += char;
    }
  }
  if (buffer) parts.push({ text: buffer, mark: marked });
  return parts;
}

export function plainSnippet(snippet: string): string {
  return snippet.replace(/\uE000/g, "").replace(/\uE001/g, "");
}

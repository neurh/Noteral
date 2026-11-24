import { useMemo, useSyncExternalStore } from "react";
import type { PageMeta } from "../../lib/api";
import { useAppStore } from "../../store";

/** Pages that can be opened (folders only group other pages). */
export function isOpenable(page: PageMeta): boolean {
  return page.kind !== "folder";
}

export interface HomeData {
  pages: PageMeta[];
  /** Openable pages, most recently edited first. */
  byUpdated: PageMeta[];
  favorites: PageMeta[];
  recent: PageMeta[];
  counts: { pages: number; databases: number; folders: number; thisWeek: number; today: number };
}

export function useHomeData(): HomeData {
  const pages = useAppStore((state) => state.pages);
  const recentMeta = useAppStore((state) => state.recent);
  const favoriteIds = useAppStore((state) => state.favorites);
  return useMemo(() => {
    const byId = new Map(pages.map((page) => [page.id, page]));
    const openable = pages.filter(isOpenable);
    const byUpdated = [...openable].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const favorites = favoriteIds.map((id) => byId.get(id)).filter((page): page is PageMeta => Boolean(page));
    const recentFromStore = recentMeta.map((page) => byId.get(page.id)).filter((page): page is PageMeta => Boolean(page && isOpenable(page)));
    const recent = recentFromStore.length ? recentFromStore : byUpdated;
    const now = Date.now();
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    let thisWeek = 0;
    let today = 0;
    let databases = 0;
    let folders = 0;
    for (const page of pages) {
      if (page.kind === "database") databases++;
      if (page.kind === "folder") folders++;
      const t = Date.parse(page.updatedAt);
      if (!Number.isNaN(t)) {
        if (now - t < 7 * 86400000) thisWeek++;
        if (t >= startOfToday.getTime()) today++;
      }
    }
    return {
      pages,
      byUpdated,
      favorites,
      recent,
      counts: { pages: pages.length - folders - databases, databases, folders, thisWeek, today },
    };
  }, [pages, recentMeta, favoriteIds]);
}

// ---------------------------------------------------------------------------
// One shared minute clock for every widget that shows the time.

let minuteNow = Date.now();
const minuteListeners = new Set<() => void>();
let minuteTimer: ReturnType<typeof setTimeout> | null = null;

function scheduleMinute() {
  const delay = 60000 - (Date.now() % 60000) + 50;
  minuteTimer = setTimeout(() => {
    minuteNow = Date.now();
    minuteListeners.forEach((listener) => listener());
    scheduleMinute();
  }, delay);
}

function subscribeMinute(listener: () => void) {
  minuteListeners.add(listener);
  if (!minuteTimer) {
    minuteNow = Date.now();
    scheduleMinute();
  }
  return () => {
    minuteListeners.delete(listener);
    if (minuteListeners.size === 0 && minuteTimer) {
      clearTimeout(minuteTimer);
      minuteTimer = null;
    }
  };
}

/** Current time, updated on each minute boundary. */
export function useMinuteClock(): Date {
  const now = useSyncExternalStore(subscribeMinute, () => minuteNow, () => minuteNow);
  return useMemo(() => new Date(now), [now]);
}

export function greetingFor(date: Date): string {
  const h = date.getHours();
  if (h < 5) return "Still up";
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  if (h < 22) return "Good evening";
  return "Good night";
}

export function longDate(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

export function timeOfDay(date: Date): string {
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Grouping helpers

export interface DayGroup {
  key: string;
  label: string;
  pages: PageMeta[];
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
}

export function groupByDay(pages: PageMeta[], now = new Date()): DayGroup[] {
  const today = dayKey(now);
  const yesterdayDate = new Date(now);
  yesterdayDate.setDate(now.getDate() - 1);
  const yesterday = dayKey(yesterdayDate);
  const groups: DayGroup[] = [];
  const index = new Map<string, DayGroup>();
  for (const page of pages) {
    const date = new Date(page.updatedAt);
    if (Number.isNaN(date.getTime())) continue;
    const key = dayKey(date);
    let group = index.get(key);
    if (!group) {
      const age = (now.getTime() - date.getTime()) / 86400000;
      const label =
        key === today
          ? "Today"
          : key === yesterday
            ? "Yesterday"
            : age < 7
              ? date.toLocaleDateString(undefined, { weekday: "long" })
              : date.toLocaleDateString(undefined, { month: "long", day: "numeric", year: date.getFullYear() === now.getFullYear() ? undefined : "numeric" });
      group = { key, label, pages: [] };
      index.set(key, group);
      groups.push(group);
    }
    group.pages.push(page);
  }
  return groups;
}

export interface LetterGroup {
  letter: string;
  pages: PageMeta[];
}

export function groupByLetter(pages: PageMeta[]): LetterGroup[] {
  const sorted = [...pages].sort((a, b) => (a.title || "Untitled").localeCompare(b.title || "Untitled", undefined, { sensitivity: "base" }));
  const groups: LetterGroup[] = [];
  for (const page of sorted) {
    const first = (page.title || "Untitled").trim().charAt(0).toUpperCase();
    const letter = /[A-Z]/.test(first) ? first : /[0-9]/.test(first) ? "#" : first || "#";
    const last = groups[groups.length - 1];
    if (last && last.letter === letter) last.pages.push(page);
    else groups.push({ letter, pages: [page] });
  }
  return groups;
}

/** Number of pages whose latest edit landed on each of the last `weeks` weeks of days. */
export function activityGrid(pages: PageMeta[], weeks = 12, now = new Date()): { date: Date; count: number }[][] {
  const end = new Date(now);
  end.setHours(0, 0, 0, 0);
  // Columns are weeks, ending with the current week; rows are weekdays (Sun–Sat).
  const start = new Date(end);
  start.setDate(end.getDate() - end.getDay() - (weeks - 1) * 7);
  const counts = new Map<string, number>();
  for (const page of pages) {
    for (const stamp of [page.updatedAt, page.createdAt]) {
      const d = new Date(stamp);
      if (Number.isNaN(d.getTime()) || d < start) continue;
      const key = dayKey(d);
      counts.set(key, (counts.get(key) ?? 0) + 1);
      if (page.updatedAt === page.createdAt) break;
    }
  }
  const columns: { date: Date; count: number }[][] = [];
  for (let w = 0; w < weeks; w++) {
    const column: { date: Date; count: number }[] = [];
    for (let d = 0; d < 7; d++) {
      const date = new Date(start);
      date.setDate(start.getDate() + w * 7 + d);
      column.push({ date, count: date > now ? -1 : counts.get(dayKey(date)) ?? 0 });
    }
    columns.push(column);
  }
  return columns;
}

const PROMPTS = [
  "What did you notice today that you'd usually walk past?",
  "Write down the decision you keep postponing, and the first step.",
  "Describe a place you could draw from memory.",
  "What would make this week feel finished?",
  "List three things you learned recently, in one sentence each.",
  "Write a letter to yourself one year from now.",
  "What is a small problem you could solve in an afternoon?",
  "Capture a conversation you want to remember.",
  "What are you curious about right now, and why?",
  "Outline the next project you would start if time were free.",
  "Write about a tool you use every day and how it shapes you.",
  "What did you get wrong recently, and what did it teach you?",
  "Sketch the ideal version of tomorrow morning.",
  "Write the opening paragraph of a story set in your street.",
];

export function promptOfTheDay(date = new Date()): string {
  const start = new Date(date.getFullYear(), 0, 0);
  const day = Math.floor((date.getTime() - start.getTime()) / 86400000);
  return PROMPTS[day % PROMPTS.length];
}

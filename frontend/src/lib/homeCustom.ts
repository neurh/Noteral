// Custom Home views: widget catalog, free-form layout model and the
// defensive normalization for everything that round-trips through UI state.

// ---------------------------------------------------------------------------
// Custom view

export const HOME_WIDGET_TYPES = [
  "greeting",
  "clock",
  "quick",
  "search",
  "continue",
  "recent",
  "favorites",
  "links",
  "folder",
  "gallery",
  "timeline",
  "index",
  "stats",
  "activity",
  "calendar",
  "countdown",
  "todo",
  "note",
  "text",
  "prompt",
  "spacer",
  "buttons",
  "image",
  "habits",
  "progress",
] as const;
export type HomeWidgetType = (typeof HOME_WIDGET_TYPES)[number];
/** Coarse size, derived from the widget width, that widgets use to pick list lengths. */
export type HomeWidgetSize = "s" | "m" | "l";
export type HomeCardStyle = "glass" | "solid" | "outline" | "flat";
export type HomeWidgetCategory = "essentials" | "pages" | "insights" | "personal" | "layout";

/** The free-form canvas: widgets snap to a 24-column, 10px-row lattice. */
export const HOME_GRID_COLUMNS = 24;
export const HOME_ROW_PX = 10;
export const MIN_WIDGET_W = 3;
export const MIN_WIDGET_H = 3;
export const MAX_WIDGET_H = 120;

export interface HomeWidgetInfo {
  label: string;
  description: string;
  /** Default width in 12ths of the canvas (doubled for the 24-column lattice). */
  span: number;
  /** Default height in rows. */
  rows: number;
  category: HomeWidgetCategory;
  /** Whether a "how many items" setting applies. */
  limit?: { min: number; max: number };
}

export const HOME_WIDGET_INFO: Record<HomeWidgetType, HomeWidgetInfo> = {
  greeting: { label: "Greeting", description: "A headline with the date and workspace.", span: 12, rows: 12, category: "essentials" },
  clock: { label: "Clock", description: "Digital or analog, 12 or 24 hours.", span: 4, rows: 15, category: "essentials" },
  quick: { label: "Quick actions", description: "Buttons for the things you start often.", span: 6, rows: 17, category: "essentials" },
  search: { label: "Search", description: "Find a page by title as you type.", span: 6, rows: 8, category: "essentials" },
  continue: { label: "Continue", description: "The page you edited last.", span: 6, rows: 17, category: "pages" },
  recent: { label: "Recent", description: "Pages you opened lately.", span: 6, rows: 26, category: "pages", limit: { min: 3, max: 20 } },
  favorites: { label: "Favorites", description: "Pages you starred.", span: 6, rows: 26, category: "pages", limit: { min: 3, max: 20 } },
  links: { label: "Pinned pages", description: "Pages you pick, as a list or tiles.", span: 6, rows: 22, category: "pages" },
  folder: { label: "Folder", description: "What's inside one folder or page.", span: 6, rows: 26, category: "pages", limit: { min: 3, max: 30 } },
  gallery: { label: "Gallery", description: "Recent pages as covered cards.", span: 12, rows: 26, category: "pages", limit: { min: 2, max: 16 } },
  timeline: { label: "Timeline", description: "Edits grouped by day.", span: 6, rows: 30, category: "pages", limit: { min: 4, max: 30 } },
  index: { label: "All pages", description: "Every page, A to Z, with a filter.", span: 12, rows: 36, category: "pages" },
  stats: { label: "Stats", description: "Pages, databases and this week's edits.", span: 6, rows: 12, category: "insights" },
  activity: { label: "Activity", description: "Your edits as a heatmap.", span: 6, rows: 17, category: "insights" },
  calendar: { label: "Calendar", description: "This month, with the days you wrote.", span: 4, rows: 27, category: "insights" },
  countdown: { label: "Countdown", description: "Days until a date that matters.", span: 4, rows: 14, category: "personal" },
  todo: { label: "Checklist", description: "A small to-do list kept on this Home.", span: 4, rows: 26, category: "personal" },
  note: { label: "Sticky note", description: "A scratch note saved with this Home.", span: 4, rows: 20, category: "personal" },
  text: { label: "Text", description: "Your own heading, paragraph, quote or callout.", span: 12, rows: 9, category: "layout" },
  prompt: { label: "Writing prompt", description: "A new prompt every day.", span: 4, rows: 14, category: "personal" },
  buttons: { label: "Buttons", description: "Your own buttons: open a page or link, or start something new.", span: 6, rows: 9, category: "essentials" },
  image: { label: "Image", description: "A picture from a link, with an optional caption.", span: 4, rows: 22, category: "layout" },
  habits: { label: "Habits", description: "Tick off daily habits across the week.", span: 6, rows: 20, category: "personal" },
  progress: { label: "Goals", description: "Progress bars or rings for what you're working toward.", span: 4, rows: 18, category: "personal" },
  spacer: { label: "Spacer", description: "Empty room or a divider line.", span: 12, rows: 4, category: "layout" },
};

export const HOME_WIDGET_CATEGORIES: { id: HomeWidgetCategory; label: string }[] = [
  { id: "essentials", label: "Essentials" },
  { id: "pages", label: "Pages" },
  { id: "insights", label: "Insights" },
  { id: "personal", label: "Personal" },
  { id: "layout", label: "Text & layout" },
];

/** Display variants per widget type; the first is the default. */
export const HOME_WIDGET_VARIANTS: Partial<Record<HomeWidgetType, { id: string; label: string }[]>> = {
  greeting: [
    { id: "start", label: "Left" },
    { id: "center", label: "Centered" },
  ],
  clock: [
    { id: "digital", label: "Digital" },
    { id: "analog", label: "Analog" },
  ],
  quick: [
    { id: "grid", label: "Grid" },
    { id: "list", label: "List" },
  ],
  recent: [
    { id: "list", label: "List" },
    { id: "cards", label: "Cards" },
  ],
  favorites: [
    { id: "list", label: "List" },
    { id: "cards", label: "Cards" },
  ],
  links: [
    { id: "list", label: "List" },
    { id: "tiles", label: "Tiles" },
  ],
  folder: [
    { id: "list", label: "List" },
    { id: "cards", label: "Cards" },
  ],
  text: [
    { id: "heading", label: "Heading" },
    { id: "paragraph", label: "Paragraph" },
    { id: "quote", label: "Quote" },
    { id: "callout", label: "Callout" },
  ],
  spacer: [
    { id: "blank", label: "Blank" },
    { id: "line", label: "Line" },
  ],
  buttons: [
    { id: "solid", label: "Solid" },
    { id: "soft", label: "Soft" },
    { id: "outline", label: "Outline" },
    { id: "tile", label: "Tiles" },
  ],
  image: [
    { id: "cover", label: "Fill" },
    { id: "contain", label: "Fit" },
  ],
  progress: [
    { id: "bar", label: "Bars" },
    { id: "ring", label: "Rings" },
  ],
};

export const HOME_BUTTON_ACTIONS = ["page", "url", "new-page", "new-database", "new-folder", "search", "library", "settings"] as const;
export type HomeButtonAction = (typeof HOME_BUTTON_ACTIONS)[number];
export const HOME_BUTTON_ICONS = ["arrow", "file", "database", "folder", "search", "book", "settings", "link", "star", "heart", "bolt", "calendar", "mail", "music", "code", "coffee"] as const;
export type HomeButtonIcon = (typeof HOME_BUTTON_ICONS)[number];

export interface HomeButton {
  id: string;
  label: string;
  icon: HomeButtonIcon;
  action: HomeButtonAction;
  /** Page id for "page", http(s) URL for "url". */
  target?: string;
  /** Per-button color; falls back to the widget / page accent. */
  color?: string;
}

export interface HomeHabit {
  id: string;
  text: string;
  /** Days (YYYY-MM-DD) the habit was done, newest first, at most 42. */
  days: string[];
}

export interface HomeGoal {
  id: string;
  text: string;
  value: number;
  max: number;
}

export const MAX_BUTTONS = 12;
export const MAX_HABITS = 8;
export const MAX_GOALS = 8;

export const HOME_QUICK_ACTIONS = ["page", "database", "folder", "search", "library", "settings"] as const;
export type HomeQuickAction = (typeof HOME_QUICK_ACTIONS)[number];
export const DEFAULT_QUICK_ACTIONS: HomeQuickAction[] = ["page", "database", "folder", "search"];

export interface HomeTodoItem {
  id: string;
  text: string;
  done: boolean;
}

export interface HomeWidget {
  id: string;
  type: HomeWidgetType;
  /** Lattice position and size: columns out of HOME_GRID_COLUMNS, rows of HOME_ROW_PX. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Header label override; "" falls back to the default. */
  title?: string;
  hideTitle?: boolean;
  /** Card style override; undefined inherits the page style. */
  style?: HomeCardStyle;
  /** Accent override for this widget. */
  tint?: string;
  variant?: string;
  /** Note / text body. */
  text?: string;
  limit?: number;
  /** Folder widget: the folder or page whose children are listed. */
  pageId?: string;
  /** Pinned pages widget. */
  pageIds?: string[];
  items?: HomeTodoItem[];
  /** Countdown target, YYYY-MM-DD. */
  date?: string;
  hour24?: boolean;
  actions?: HomeQuickAction[];
  buttons?: HomeButton[];
  habits?: HomeHabit[];
  goals?: HomeGoal[];
  /** Image widget source (http, https or an asset URL). */
  url?: string;
}

export type HomeCustomWidth = "narrow" | "wide" | "full";
export type HomeCustomGap = "tight" | "normal" | "roomy";
export type HomeCustomShadow = "none" | "soft" | "lifted";
export type HomeCustomFont = "serif" | "sans" | "mono";

export interface HomeCustomLayout {
  /** Greeting headline override. */
  title: string;
  width: HomeCustomWidth;
  gap: HomeCustomGap;
  cards: HomeCardStyle;
  /** Card corner radius in px, 0–28. */
  radius: number;
  shadow: HomeCustomShadow;
  font: HomeCustomFont;
  valign: "top" | "center";
  accent?: string;
  widgets: HomeWidget[];
}


export const MAX_WIDGETS = 30;
export const MAX_NOTE_LENGTH = 2000;
export const MAX_TODO_ITEMS = 40;
export const MAX_PINNED_PAGES = 24;
export const DEFAULT_RADIUS = 14;

let widgetSeq = 0;
export function newWidgetId(): string {
  widgetSeq = (widgetSeq + 1) % 1e6;
  return `w${Date.now().toString(36)}${widgetSeq.toString(36)}`;
}

/** Coarse size for a widget width in lattice columns. */
export function sizeForWidth(w: number): HomeWidgetSize {
  return w <= 8 ? "s" : w <= 16 ? "m" : "l";
}

/** Width/height in lattice units, kept inside the canvas. */
export function clampBox(box: { x: number; y: number; w: number; h: number }): { x: number; y: number; w: number; h: number } {
  const w = Math.max(MIN_WIDGET_W, Math.min(HOME_GRID_COLUMNS, Math.round(box.w)));
  const h = Math.max(MIN_WIDGET_H, Math.min(MAX_WIDGET_H, Math.round(box.h)));
  const x = Math.max(0, Math.min(HOME_GRID_COLUMNS - w, Math.round(box.x)));
  const y = Math.max(0, Math.min(2000, Math.round(box.y)));
  return { x, y, w, h };
}

/** Presets and legacy layouts describe widgets by 12-column span; x/y of -1 means "place me". */
type WidgetSeed = Partial<HomeWidget> & { span?: number };

export function newWidget(type: HomeWidgetType, patch: WidgetSeed = {}): HomeWidget {
  const info = HOME_WIDGET_INFO[type];
  const { span, ...rest } = patch;
  const widget: HomeWidget = { id: newWidgetId(), type, x: -1, y: -1, w: (span ?? info.span) * 2, h: info.rows, ...rest };
  if (type === "note" && widget.text === undefined) widget.text = "";
  if (type === "text" && widget.text === undefined) widget.text = "";
  if (type === "todo" && !widget.items) widget.items = [];
  if (type === "links" && !widget.pageIds) widget.pageIds = [];
  if (type === "buttons" && !widget.buttons) {
    widget.buttons = [
      { id: newWidgetId(), label: "New page", icon: "file", action: "new-page" },
      { id: newWidgetId(), label: "Search", icon: "search", action: "search" },
    ];
  }
  if (type === "habits" && !widget.habits) {
    widget.habits = [
      { id: newWidgetId(), text: "Write", days: [] },
      { id: newWidgetId(), text: "Read", days: [] },
      { id: newWidgetId(), text: "Walk", days: [] },
    ];
  }
  if (type === "progress" && !widget.goals) {
    widget.goals = [
      { id: newWidgetId(), text: "Chapters drafted", value: 3, max: 12 },
      { id: newWidgetId(), text: "Notes cleaned up", value: 18, max: 40 },
    ];
  }
  return widget;
}

const LAYOUT_DEFAULTS: Omit<HomeCustomLayout, "widgets"> = {
  title: "",
  width: "wide",
  gap: "normal",
  cards: "glass",
  radius: DEFAULT_RADIUS,
  shadow: "soft",
  font: "serif",
  valign: "top",
};

function inDays(days: number): string {
  const date = new Date(Date.now() + days * 86400000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export interface HomeCustomPreset {
  id: string;
  label: string;
  description: string;
  build: () => HomeCustomLayout;
}

const RAW_PRESETS: HomeCustomPreset[] = [
  {
    id: "balanced",
    label: "Balanced",
    description: "Greeting, actions, recent work and a note.",
    build: () => ({
      ...LAYOUT_DEFAULTS,
      widgets: [
        newWidget("greeting"),
        newWidget("continue", { span: 8 }),
        newWidget("clock", { span: 4 }),
        newWidget("quick", { span: 6 }),
        newWidget("recent", { span: 6 }),
        newWidget("activity", { span: 8 }),
        newWidget("note", { span: 4 }),
      ],
    }),
  },
  {
    id: "minimal",
    label: "Minimal",
    description: "A centered headline, search and a few pages.",
    build: () => ({
      ...LAYOUT_DEFAULTS,
      width: "narrow",
      cards: "flat",
      shadow: "none",
      valign: "center",
      widgets: [newWidget("greeting", { variant: "center" }), newWidget("search", { span: 12 }), newWidget("recent", { span: 12, limit: 5, hideTitle: true })],
    }),
  },
  {
    id: "planner",
    label: "Planner",
    description: "Clock, calendar, checklist and a countdown.",
    build: () => ({
      ...LAYOUT_DEFAULTS,
      widgets: [
        newWidget("greeting", { span: 8 }),
        newWidget("clock", { span: 4, variant: "analog" }),
        newWidget("calendar", { span: 4 }),
        newWidget("todo", {
          span: 4,
          items: [
            { id: "t1", text: "Plan the week", done: true },
            { id: "t2", text: "Review notes", done: false },
            { id: "t3", text: "Write something", done: false },
          ],
        }),
        newWidget("countdown", { span: 4, title: "Weekend", date: inDays((6 - new Date().getDay() + 7) % 7 || 7) }),
        newWidget("timeline", { span: 6, limit: 6 }),
        newWidget("note", { span: 6 }),
      ],
    }),
  },
  {
    id: "writer",
    label: "Writer",
    description: "Prompt, quote and the page you were writing.",
    build: () => ({
      ...LAYOUT_DEFAULTS,
      width: "narrow",
      cards: "outline",
      shadow: "none",
      widgets: [
        newWidget("greeting"),
        newWidget("text", { variant: "quote", text: "Small pages, written often, become a library." }),
        newWidget("continue", { span: 12 }),
        newWidget("prompt", { span: 6 }),
        newWidget("note", { span: 6 }),
        newWidget("recent", { span: 12, limit: 6 }),
      ],
    }),
  },
  {
    id: "command",
    label: "Command center",
    description: "Numbers, activity, lists — everything at once.",
    build: () => ({
      ...LAYOUT_DEFAULTS,
      width: "full",
      gap: "tight",
      cards: "solid",
      radius: 10,
      font: "sans",
      widgets: [
        newWidget("greeting", { span: 8 }),
        newWidget("clock", { span: 4 }),
        newWidget("stats", { span: 4 }),
        newWidget("activity", { span: 8 }),
        newWidget("quick", { span: 4, variant: "list" }),
        newWidget("favorites", { span: 4 }),
        newWidget("timeline", { span: 4, h: 40 }),
        newWidget("gallery", { span: 12, limit: 6 }),
      ],
    }),
  },
];

export const HOME_CUSTOM_PRESETS: HomeCustomPreset[] = RAW_PRESETS.map((preset) => ({
  ...preset,
  build: () => {
    const layout = preset.build();
    return { ...layout, widgets: arrangeWidgets(layout.widgets) };
  },
}));

export function defaultCustomLayout(): HomeCustomLayout {
  return HOME_CUSTOM_PRESETS[0].build();
}


type Loose = Record<string, unknown>;

function asObject(value: unknown): Loose | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Loose) : undefined;
}

function oneOf<T extends string>(value: unknown, options: readonly T[], fallback: T): T {
  return options.includes(value as T) ? (value as T) : fallback;
}

function str(value: unknown, max: number): string | undefined {
  return typeof value === "string" ? value.slice(0, max) : undefined;
}

function isHexColor(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value);
}

// ---------------------------------------------------------------------------
// Free-form layout: boxes on the lattice never overlap. Moving or growing one
// pushes whatever it lands on straight down; nothing else moves, so widgets
// stay exactly where they were put.

export type Box = { x: number; y: number; w: number; h: number };

export function boxesOverlap(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** Push widgets that collide with `fixedId` (and then with each other) downward. */
export function resolveCollisions(widgets: HomeWidget[], fixedId: string): HomeWidget[] {
  const out = widgets.map((w) => ({ ...w }));
  const byId = new Map(out.map((w) => [w.id, w]));
  const queue = [fixedId];
  let guard = 0;
  while (queue.length && guard++ < 4000) {
    const a = byId.get(queue.shift()!);
    if (!a) continue;
    for (const b of out) {
      if (b.id === a.id || b.id === fixedId || !boxesOverlap(a, b)) continue;
      b.y = a.y + a.h;
      queue.push(b.id);
    }
  }
  return out;
}

/** First free top-left spot (scanning rows, then columns) where a w×h box fits. */
export function findFreeSpot(widgets: Box[], w: number, h: number, from: { x: number; y: number } = { x: 0, y: 0 }): { x: number; y: number } {
  const width = Math.min(w, HOME_GRID_COLUMNS);
  const bottom = widgets.reduce((max, b) => Math.max(max, b.y + b.h), 0);
  for (let y = from.y; y <= bottom; y++) {
    for (let x = y === from.y ? from.x : 0; x + width <= HOME_GRID_COLUMNS; x++) {
      const box = { x, y, w: width, h };
      if (!widgets.some((b) => boxesOverlap(box, b))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** Give every unplaced widget (x or y < 0) a spot, flowing them left to right like text. */
export function arrangeWidgets(widgets: HomeWidget[]): HomeWidget[] {
  const placed: HomeWidget[] = [];
  let cursor = { x: 0, y: 0 };
  for (const widget of widgets) {
    if (widget.x >= 0 && widget.y >= 0) {
      placed.push(widget);
      continue;
    }
    const w = Math.max(MIN_WIDGET_W, Math.min(HOME_GRID_COLUMNS, widget.w));
    if (cursor.x + w > HOME_GRID_COLUMNS) cursor = { x: 0, y: cursor.y };
    const spot = findFreeSpot(placed, w, widget.h, cursor);
    const next = { ...widget, x: spot.x, y: spot.y, w };
    placed.push(next);
    cursor = { x: spot.x + w, y: spot.y };
  }
  return placed;
}

/** Slide every widget up as far as it can go, keeping columns: "Tidy up". */
export function compactWidgets(widgets: HomeWidget[]): HomeWidget[] {
  const sorted = [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
  const done: HomeWidget[] = [];
  for (const widget of sorted) {
    let y = widget.y;
    while (y > 0 && !done.some((b) => boxesOverlap({ ...widget, y: y - 1 }, b))) y--;
    done.push({ ...widget, y });
  }
  const order = new Map(widgets.map((w, i) => [w.id, i]));
  return done.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
}

/** Rows the canvas needs to show every widget. */
export function layoutRows(widgets: Box[]): number {
  return widgets.reduce((max, b) => Math.max(max, b.y + b.h), 0);
}

/** Reading order (top to bottom, then left to right) for narrow screens and keyboard focus. */
export function readingOrder<T extends Box>(widgets: T[]): T[] {
  return [...widgets].sort((a, b) => a.y - b.y || a.x - b.x);
}

const LEGACY_SPANS: Record<string, number> = { s: 4, m: 6, l: 12 };
const LEGACY_HEIGHTS: Record<string, number> = { s: 16, m: 26, l: 40 };
const URL_RE = /^(https?:\/\/|\/assets\/|\/api\/assets\/)[^\s"'<>]{1,1900}$/i;

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function itemId(raw: unknown, seen: Set<string>): string {
  let id = typeof raw === "string" && raw && raw.length <= 40 ? raw : newWidgetId();
  if (seen.has(id)) id = newWidgetId();
  seen.add(id);
  return id;
}
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function normalizeWidget(w: Loose, id: string): HomeWidget {
  const type = w.type as HomeWidgetType;
  const info = HOME_WIDGET_INFO[type];
  const rawSpan = num(w.span) ?? (typeof w.size === "string" ? LEGACY_SPANS[w.size] : undefined);
  const rawW = num(w.w) ?? (rawSpan !== undefined ? rawSpan * 2 : info.span * 2);
  const rawH = num(w.h) ?? (typeof w.height === "string" ? LEGACY_HEIGHTS[w.height] : undefined) ?? info.rows;
  const x = num(w.x), y = num(w.y);
  const placed = x !== undefined && y !== undefined && x >= 0 && y >= 0;
  const box = clampBox({ x: placed ? x : 0, y: placed ? y : 0, w: rawW, h: rawH });
  const widget: HomeWidget = { id, type, x: placed ? box.x : -1, y: placed ? box.y : -1, w: box.w, h: box.h };
  const title = str(w.title, 60);
  if (title) widget.title = title;
  if (w.hideTitle === true) widget.hideTitle = true;
  if (w.style !== undefined) {
    const style = oneOf(w.style, ["glass", "solid", "outline", "flat"] as const, "glass");
    if (style === w.style) widget.style = style;
  }
  if (isHexColor(w.tint)) widget.tint = w.tint.toLowerCase();
  const variants = HOME_WIDGET_VARIANTS[type];
  if (variants && variants.some((v) => v.id === w.variant)) widget.variant = w.variant as string;
  if (type === "note" || type === "text") widget.text = str(w.text, MAX_NOTE_LENGTH) ?? "";
  if (type === "greeting") {
    const subtitle = str(w.text, 160);
    if (subtitle) widget.text = subtitle;
  }
  if (info.limit && typeof w.limit === "number" && Number.isFinite(w.limit)) {
    widget.limit = Math.max(info.limit.min, Math.min(info.limit.max, Math.round(w.limit)));
  }
  if (type === "folder" && typeof w.pageId === "string" && w.pageId.length <= 80) widget.pageId = w.pageId;
  if (type === "links") {
    const ids = Array.isArray(w.pageIds) ? w.pageIds.filter((v): v is string => typeof v === "string" && v.length > 0 && v.length <= 80) : [];
    widget.pageIds = [...new Set(ids)].slice(0, MAX_PINNED_PAGES);
  }
  if (type === "todo") {
    const items: HomeTodoItem[] = [];
    const seen = new Set<string>();
    for (const raw of Array.isArray(w.items) ? w.items : []) {
      const item = asObject(raw);
      if (!item || typeof item.text !== "string") continue;
      let itemId = typeof item.id === "string" && item.id && item.id.length <= 40 ? item.id : newWidgetId();
      if (seen.has(itemId)) itemId = newWidgetId();
      seen.add(itemId);
      items.push({ id: itemId, text: item.text.slice(0, 200), done: item.done === true });
      if (items.length >= MAX_TODO_ITEMS) break;
    }
    widget.items = items;
  }
  if (type === "countdown" && typeof w.date === "string" && DATE.test(w.date)) widget.date = w.date;
  if (type === "clock" && w.hour24 === true) widget.hour24 = true;
  if (type === "quick" && Array.isArray(w.actions)) {
    widget.actions = HOME_QUICK_ACTIONS.filter((action) => (w.actions as unknown[]).includes(action));
  }
  if (type === "buttons") {
    const seen = new Set<string>();
    const buttons: HomeButton[] = [];
    for (const raw of Array.isArray(w.buttons) ? w.buttons : []) {
      const b = asObject(raw);
      if (!b) continue;
      const action = oneOf(b.action, HOME_BUTTON_ACTIONS, "new-page");
      const button: HomeButton = { id: itemId(b.id, seen), label: str(b.label, 40) ?? "", icon: oneOf(b.icon, HOME_BUTTON_ICONS, "arrow"), action };
      if (action === "page" && typeof b.target === "string" && b.target.length <= 80) button.target = b.target;
      if (action === "url" && typeof b.target === "string" && URL_RE.test(b.target)) button.target = b.target;
      if (isHexColor(b.color)) button.color = b.color.toLowerCase();
      buttons.push(button);
      if (buttons.length >= MAX_BUTTONS) break;
    }
    widget.buttons = buttons;
  }
  if (type === "image") {
    if (typeof w.url === "string" && URL_RE.test(w.url)) widget.url = w.url;
    const caption = str(w.text, 160);
    if (caption) widget.text = caption;
  }
  if (type === "habits") {
    const seen = new Set<string>();
    const habits: HomeHabit[] = [];
    for (const raw of Array.isArray(w.habits) ? w.habits : []) {
      const h = asObject(raw);
      if (!h || typeof h.text !== "string") continue;
      const days = Array.isArray(h.days) ? [...new Set((h.days as unknown[]).filter((d): d is string => typeof d === "string" && DATE.test(d)))].sort().reverse().slice(0, 42) : [];
      habits.push({ id: itemId(h.id, seen), text: h.text.slice(0, 60), days });
      if (habits.length >= MAX_HABITS) break;
    }
    widget.habits = habits;
  }
  if (type === "progress") {
    const seen = new Set<string>();
    const goals: HomeGoal[] = [];
    for (const raw of Array.isArray(w.goals) ? w.goals : []) {
      const g = asObject(raw);
      if (!g || typeof g.text !== "string") continue;
      const max = Math.max(1, Math.min(1e6, Math.round(num(g.max) ?? 10)));
      const value = Math.max(0, Math.min(max, Math.round(num(g.value) ?? 0)));
      goals.push({ id: itemId(g.id, seen), text: g.text.slice(0, 60), value, max });
      if (goals.length >= MAX_GOALS) break;
    }
    widget.goals = goals;
  }
  return widget;
}

export function normalizeCustomLayout(value: unknown): HomeCustomLayout | undefined {
  const c = asObject(value);
  if (!c) return undefined;
  const seen = new Set<string>();
  const widgets: HomeWidget[] = [];
  for (const item of Array.isArray(c.widgets) ? c.widgets : []) {
    const w = asObject(item);
    if (!w || !HOME_WIDGET_TYPES.includes(w.type as HomeWidgetType)) continue;
    let id = typeof w.id === "string" && w.id && w.id.length <= 40 ? w.id : newWidgetId();
    if (seen.has(id)) id = newWidgetId();
    seen.add(id);
    widgets.push(normalizeWidget(w, id));
    if (widgets.length >= MAX_WIDGETS) break;
  }
  const radius = typeof c.radius === "number" && Number.isFinite(c.radius) ? Math.max(0, Math.min(28, Math.round(c.radius))) : DEFAULT_RADIUS;
  const layout: HomeCustomLayout = {
    title: str(c.title, 80) ?? "",
    width: oneOf(c.width, ["narrow", "wide", "full"] as const, "wide"),
    gap: oneOf(c.gap, ["tight", "normal", "roomy"] as const, "normal"),
    cards: oneOf(c.cards, ["glass", "solid", "outline", "flat"] as const, "glass"),
    radius,
    shadow: oneOf(c.shadow, ["none", "soft", "lifted"] as const, "soft"),
    font: oneOf(c.font, ["serif", "sans", "mono"] as const, "serif"),
    valign: c.valign === "center" ? "center" : "top",
    widgets: arrangeWidgets(unplaceOverlaps(widgets)),
  };
  if (isHexColor(c.accent)) layout.accent = c.accent.toLowerCase();
  return layout;
}

/** Stored layouts should never overlap; if one does, re-place the later widget. */
function unplaceOverlaps(widgets: HomeWidget[]): HomeWidget[] {
  const kept: HomeWidget[] = [];
  return widgets.map((w) => {
    if (w.x < 0 || w.y < 0) return w;
    if (kept.some((b) => boxesOverlap(w, b))) return { ...w, x: -1, y: -1 };
    kept.push(w);
    return w;
  });
}

// ---------------------------------------------------------------------------
// Saved custom views. They belong to the workspace, so every Home tab can show
// any of them; a tab only stores which one it shows.

export interface HomeCustomView extends HomeCustomLayout {
  id: string;
  name: string;
}

export const MAX_CUSTOM_VIEWS = 16;
export const MAX_VIEW_NAME = 40;

export function newViewId(): string {
  return `v${newWidgetId().slice(1)}`;
}

export function makeCustomView(name: string, layout: HomeCustomLayout = defaultCustomLayout()): HomeCustomView {
  return { ...layout, id: newViewId(), name: name.slice(0, MAX_VIEW_NAME) };
}

/** A name like "Custom view 3" that no existing view uses yet. */
export function nextViewName(views: { name: string }[], base = "Custom view"): string {
  const names = new Set(views.map((v) => v.name.toLowerCase()));
  if (!names.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!names.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

export function normalizeCustomView(value: unknown): HomeCustomView | undefined {
  const v = asObject(value);
  const layout = normalizeCustomLayout(v);
  if (!v || !layout) return undefined;
  const id = typeof v.id === "string" && /^[\w-]{1,40}$/.test(v.id) ? v.id : newViewId();
  const name = (str(v.name, MAX_VIEW_NAME) ?? "").trim() || "Custom view";
  return { ...layout, id, name };
}

export function normalizeCustomViews(value: unknown): HomeCustomView[] {
  const list = Array.isArray(value) ? value : Array.isArray(asObject(value)?.views) ? (asObject(value)!.views as unknown[]) : [];
  const seen = new Set<string>();
  const out: HomeCustomView[] = [];
  for (const raw of list) {
    const view = normalizeCustomView(raw);
    if (!view) continue;
    if (seen.has(view.id)) view.id = newViewId();
    seen.add(view.id);
    out.push(view);
    if (out.length >= MAX_CUSTOM_VIEWS) break;
  }
  return out;
}

/** The layout part of a view, for code that only renders widgets. */
export function viewLayout(view: HomeCustomView): HomeCustomLayout {
  const { id: _id, name: _name, ...layout } = view;
  return layout;
}


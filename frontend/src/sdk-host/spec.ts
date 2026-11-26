/**
 * The Noteral App API: every operation the app exposes to plugins and to the assistant.
 *
 * This file is pure data and is the single source of truth for
 *  - the plugin runtime (permission checks + validation, see ./host.ts),
 *  - the assistant's tools (see ../ai/tools.ts),
 *  - the SDK's typed client and the developer docs (scripts/build-sdk-docs.mjs).
 *
 * Adding a capability: add a spec here, implement it in ./handlers.ts (a unit test fails
 * until both exist), then run `npm run sdk:build` from the repo root.
 */
import { EMPTY, s, type JsonSchema, type ObjectSchema } from "./schema";

/** Permission ids. Keep in sync with internal/plugins/plugins.go (allowedPermissions). */
export type Permission =
  | "editor.read"
  | "editor.write"
  | "pages.read"
  | "pages.write"
  | "databases.read"
  | "databases.write"
  | "navigation"
  | "search.read"
  | "ui.status"
  | "ui.notify"
  | "ui.panel"
  | "ui.modal"
  | "ui.styles"
  | "settings.read"
  | "settings.write"
  | "assets.read"
  | "assets.write"
  | "workspaces.read"
  | "workspaces.write"
  | "layout"
  | "appearance"
  | "preferences"
  | "commands.execute"
  | "clipboard"
  | "network"
  | "blocks"
  | "nodes"
  | "home"
  | "menus";

/**
 * How far a method reaches. The assistant's modes are built from tiers:
 * Ask = read, Edit = read + content, Creator = everything.
 */
export type Tier = "read" | "content" | "app";

export type Caller = "plugin" | "assistant";

export interface MethodSpec {
  name: string;
  /** One line, imperative, shown in docs, the store and as the assistant tool description. */
  summary: string;
  /** Longer notes for docs and the assistant (behaviour, limits, gotchas). */
  details?: string;
  /** `null` = always allowed. */
  permission: Permission | null;
  tier: Tier;
  params: ObjectSchema;
  /** TypeScript type of the result (types live in sdk/src/types.ts). */
  returns: string;
  /** Who may call it. Defaults to both. */
  callers?: Caller[];
  /** The assistant must ask the user before running it (destructive or wide-reaching). */
  confirm?: boolean;
  /** A short TypeScript example for the docs. */
  example?: string;
}

export interface EventSpec {
  name: string;
  summary: string;
  permission: Permission | null;
  payload: string;
}

export interface PermissionSpec {
  id: Permission;
  title: string;
  description: string;
  risk: "low" | "medium" | "high";
}

export const PERMISSIONS: PermissionSpec[] = [
  { id: "editor.read", title: "Read the open page", description: "Read the text, blocks and selection of the page you are editing.", risk: "low" },
  { id: "editor.write", title: "Edit the open page", description: "Insert, change and remove blocks in the page you are editing.", risk: "medium" },
  { id: "pages.read", title: "Read pages", description: "List pages and read the content of any page in the workspace.", risk: "medium" },
  { id: "pages.write", title: "Change pages", description: "Create, rename, move, rewrite and trash pages.", risk: "high" },
  { id: "databases.read", title: "Read databases", description: "Read database schemas and rows.", risk: "medium" },
  { id: "databases.write", title: "Change databases", description: "Create databases, add properties and add or edit rows.", risk: "high" },
  { id: "navigation", title: "Navigate", description: "Open pages, go back and forward, open Home.", risk: "low" },
  { id: "search.read", title: "Search", description: "Run full-text searches across the workspace.", risk: "medium" },
  { id: "ui.status", title: "Status bar", description: "Show text and widgets in the status bar.", risk: "low" },
  { id: "ui.notify", title: "Notifications", description: "Show toast notifications.", risk: "low" },
  { id: "ui.panel", title: "Sidebar tabs", description: "Add tabs to the right sidebar.", risk: "low" },
  { id: "ui.modal", title: "Dialogs", description: "Ask you to confirm, type an answer or pick from a list.", risk: "low" },
  { id: "ui.styles", title: "Plugin styles", description: "Add CSS to the app (for the plugin's own look).", risk: "medium" },
  { id: "settings.read", title: "Read its settings", description: "Read the plugin's own saved settings.", risk: "low" },
  { id: "settings.write", title: "Save its settings", description: "Save the plugin's own settings.", risk: "low" },
  { id: "assets.read", title: "Read files", description: "Read images and files attached to pages.", risk: "low" },
  { id: "assets.write", title: "Import files", description: "Ask you to pick an image or file and import it.", risk: "low" },
  { id: "workspaces.read", title: "See workspaces", description: "List workspaces and see which one is open.", risk: "low" },
  { id: "workspaces.write", title: "Manage workspaces", description: "Create, rename and switch workspaces.", risk: "high" },
  { id: "layout", title: "Layout", description: "Split panes, arrange sidebar tab groups, show or hide sidebars and resize panels.", risk: "low" },
  { id: "appearance", title: "Appearance", description: "Change colors, fonts and component styles across the app.", risk: "medium" },
  { id: "preferences", title: "Preferences", description: "Read and change app preferences such as theme and font size.", risk: "medium" },
  { id: "commands.execute", title: "Run commands", description: "Run any command from the command palette.", risk: "high" },
  { id: "clipboard", title: "Clipboard", description: "Read and write the clipboard.", risk: "medium" },
  { id: "network", title: "Internet access", description: "Make web requests, search the web and fetch pages.", risk: "high" },
  { id: "blocks", title: "Custom blocks", description: "Add new kinds of blocks to the editor (rendered in a sandbox).", risk: "low" },
  { id: "nodes", title: "Custom page types", description: "Add new kinds of items to the page tree (rendered in a sandbox).", risk: "low" },
  { id: "home", title: "Home", description: "Create, change and remove Home views and widgets.", risk: "medium" },
  { id: "menus", title: "Menu items", description: "Add items to page, tree, block, tab and status bar menus.", risk: "low" },
];

const pageId = s.str("Page id. Defaults to the page open in the focused pane.");
const markdown = s.str("Markdown. Headings, lists, checklists (- [ ]), quotes, code fences, tables and images are supported.", { maxLength: 200_000 });
/** Find-and-replace edits (pages.edit, source.edit, plugins.edit). */
const textEdits = s.arr(
  "Edits, applied in order.",
  s.obj(
    {
      find: s.str("Exact text to replace (include enough context to be unique).", { minLength: 1, maxLength: 100_000 }),
      replace: s.str("Replacement text (\"\" deletes).", { maxLength: 200_000 }),
      all: s.bool("Replace every occurrence.", { default: false }),
    },
    ["find", "replace"],
  ),
  50,
);
const blockIds = s.arr("Block ids, from editor.getBlocks.", s.str("Block id"), 500);
const pageKind = s.str("Item kind.", { enum: ["page", "folder"] });
const propertyRef = s.str("Property name or id (\"title\" or the title column's name for the title).", { maxLength: 100 });
const PROPERTY_TYPES = ["text", "number", "select", "multiSelect", "status", "date", "checkbox", "url", "email", "phone", "createdTime", "lastEdited", "formula"];
const VIEW_TYPES = ["table", "board", "gallery", "list", "calendar", "chart", "custom"];
const FILTER_OPS = ["contains", "notContains", "is", "isNot", "startsWith", "endsWith", "isEmpty", "isNotEmpty", "eq", "neq", "gt", "lt", "gte", "lte", "before", "after", "onOrBefore", "onOrAfter", "within"];
const NUMBER_FORMATS = ["number", "commas", "percent", "dollar", "euro", "pound", "yen"];
/** Formula settings shared by create / addProperty / updateProperty. */
const formulaFields = {
  formula: s.str("Formula source (type formula), e.g. {Price} * {Qty}, if({Done}, style(\"Done\", \"green\"), fromNow({Due})) or formatNumber({Ratio}, \"percent\"). May span lines with // comments. Validated; see databases.formulaFunctions.", { maxLength: 4000 }),
  format: s.str("Number format (number and formula properties).", { enum: NUMBER_FORMATS }),
  dateFormat: s.str("How date results of a formula show.", { enum: ["relative", "short", "long", "iso"] }),
  display: s.obj(
    {
      style: s.str("number = plain text (clears the display); bar / ring = progress toward max; rating = stars; heat = tinted by size.", { enum: ["number", "bar", "ring", "rating", "heat"] }),
      color: s.str("Fill colour; default = the app accent.", { enum: ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] }),
      max: s.num("The value that counts as full (bar/ring/heat; default 100, or 1 for percent format). For rating: the number of stars, 1–10 (default 5).", { minimum: 0 }),
      showNumber: s.bool("Bar / ring: also show the number (default true)."),
    },
    [],
    "How a number (or number-formula) property shows its value. Merged over the current display on updateProperty.",
  ),
};
const CALCS = ["none", "countAll", "countValues", "countUnique", "countEmpty", "countNotEmpty", "percentEmpty", "percentNotEmpty", "checked", "unchecked", "percentChecked", "sum", "average", "median", "min", "max", "range", "earliest", "latest"];
const filterRules = s.arr(
  "Filter rules (replaces the view's filters). Select/status values are option names (a list = any of); dates are ISO or @today/@yesterday/@tomorrow/@weekAgo/@weekAhead/@monthAgo/@monthAhead/@yearAgo; op within takes pastWeek|pastMonth|pastYear|nextWeek|nextMonth|nextYear|thisWeek|thisMonth|thisYear. Formulas filter as their result type.",
  s.obj({ property: propertyRef, op: s.str("Operator.", { enum: FILTER_OPS }), value: s.any("Value to compare with (omit for isEmpty / isNotEmpty).") }, ["property", "op"]),
  30,
);
const sortRules = s.arr("Sort rules, first wins (replaces the view's sorts).", s.obj({ property: propertyRef, direction: s.str("Direction.", { enum: ["asc", "desc"], default: "asc" }) }, ["property"]), 10);
const advancedFilter = s.obj(
  {
    mode: s.str("and: every item matches; or: any.", { enum: ["and", "or"], default: "and" }),
    items: s.arr("Rules { property, op, value } and nested groups { mode, items } (up to 4 levels).", s.map("A rule or a group."), 60),
  },
  ["items"],
  "Advanced filter tree, ANDed with `filters`. Pass { items: [] } to clear.",
);
const chartPatch = s.obj(
  {
    kind: s.str("Chart kind.", { enum: ["bar", "column", "line", "area", "pie", "donut", "scatter", "funnel", "radar", "heatmap", "number"] }),
    x: s.str("Category property (name), or createdTime / lastEdited. \"\" clears.", { maxLength: 100 }),
    dateBucket: s.str("Group dates on x by.", { enum: ["day", "week", "month", "quarter", "year"] }),
    aggregate: s.str("Measure. count = rows; sum/average/median/min/max need a number y; countValues/countUnique count y's values.", { enum: ["count", "countValues", "countUnique", "sum", "average", "median", "min", "max"] }),
    y: s.str("Measured property (name). \"\" clears.", { maxLength: 100 }),
    series: s.str("Property that splits each category into series. \"\" clears.", { maxLength: 100 }),
    stacked: s.bool("Stack series."),
    normalize: s.bool("Stack to 100%."),
    cumulative: s.bool("Running total."),
    sort: s.str("Category order.", { enum: ["default", "label", "labelDesc", "value", "valueDesc"] }),
    limit: s.int("Show the first N categories (the rest merge into Other).", { minimum: 1, maximum: 200 }),
    omitEmpty: s.bool("Skip the empty category."),
    smooth: s.bool("Smooth lines."),
    labels: s.bool("Value labels."),
    legend: s.bool("Legend."),
    grid: s.bool("Grid lines."),
    palette: s.str("Palette id.", { maxLength: 40 }),
    height: s.int("Height in px (inline databases).", { minimum: 120, maximum: 1200 }),
    goal: s.num("Reference line value."),
    yMin: s.num("Y axis minimum."),
    yMax: s.num("Y axis maximum."),
    format: s.str("Value number format.", { enum: NUMBER_FORMATS }),
    title: s.str("Chart title.", { maxLength: 120 }),
    zoom: s.bool("Zoom and pan (Ctrl/⌘+wheel, pinch, drag) on bar/column/line/area/scatter/grid heatmaps. Default true."),
    zoomSlider: s.bool("Range slider under the plot. Default false."),
    xTitle: s.str("Category axis title. \"\" clears.", { maxLength: 80 }),
    yTitle: s.str("Value axis title. \"\" clears.", { maxLength: 80 }),
    xLabels: s.bool("Category axis labels. Default true."),
    yLabels: s.bool("Value axis labels. Default true."),
    labelAngle: s.int("Category label angle in degrees: 0, 30, 45, 60 or 90; unset rotates when crowded.", { minimum: 0, maximum: 90 }),
    logScale: s.bool("Logarithmic value axis (zero/negative values are left out)."),
    labelContent: s.str("What data labels show. Default value (bars/lines), namePercent (pies), nameValue (funnels).", { enum: ["value", "percent", "name", "nameValue", "namePercent"] }),
    labelPosition: s.str("Where data labels sit; unset picks per chart.", { enum: ["inside", "outside"] }),
    colorBy: s.str("Single-series bars: a colour per category, or one colour. Unset follows option colours.", { enum: ["category", "single"] }),
    color: s.str("Colour of single-colour charts: accent or an option colour (gray, brown, orange, yellow, green, blue, purple, pink, red).", { maxLength: 20 }),
    curve: s.str("Line shape (line/area/radar); overrides smooth. Default straight.", { enum: ["straight", "smooth", "step"] }),
    points: s.bool("Point markers on lines; unset shows them when there are few points."),
    gradient: s.bool("Area fill fades out. Default true."),
    donutWidth: s.int("Donut ring thickness, % of the radius. Default 34.", { minimum: 10, maximum: 90 }),
    other: s.bool("With limit: merge the rest into Other (default true) or drop it."),
    aggregate2: s.str("Combo chart (column/line/area): a second measure drawn as a line on a right axis. \"\" clears.", { enum: ["", "count", "countValues", "countUnique", "sum", "average", "median", "min", "max"] }),
    y2: s.str("Property (name) measured by aggregate2. \"\" clears.", { maxLength: 100 }),
    legendPosition: s.str("Legend position. Default top.", { enum: ["top", "bottom", "left", "right"] }),
    tooltip: s.str("Tooltip: group (all series at a category, default), item (one mark) or off.", { enum: ["group", "item", "off"] }),
    goalLabel: s.str("Goal line label. Default \"Goal\".", { maxLength: 60 }),
    emptyText: s.str("Message shown when the view has no rows.", { maxLength: 160 }),
  },
  [],
  "Chart settings (chart views); merged into the current ones.",
);
const viewPatch = {
  name: s.str("View name.", { maxLength: 80 }),
  icon: s.str("Tab icon: an emoji, or \"\" to use the layout icon.", { maxLength: 64 }),
  type: s.str("Layout.", { enum: VIEW_TYPES }),
  filters: filterRules,
  filterMode: s.str("Match all rules (and) or any (or).", { enum: ["and", "or"] }),
  advanced: advancedFilter,
  sorts: sortRules,
  groupBy: s.str("Grouping property. Boards: select, multi-select, status or checkbox; tables, lists and galleries: any property but the title. \"\" removes grouping.", { maxLength: 100 }),
  hiddenGroups: s.arr("Groups to hide (option names, true/false, or \"none\").", s.str("Group name."), 100),
  collapsedGroups: s.arr("Groups shown collapsed (table/list/gallery).", s.str("Group name."), 100),
  hideEmptyGroups: s.bool("Hide groups with no rows."),
  colorColumns: s.bool("Colour board columns / groups by option colour."),
  show: s.arr("Properties to show, in order (others are hidden).", propertyRef, 100),
  hide: s.arr("Properties to hide.", propertyRef, 100),
  order: s.arr("Property order (names or ids).", propertyRef, 100),
  widths: s.map("Property → column width in px (table).", { type: "number" }),
  calcs: s.map("Property → footer calculation (table).", { type: "string", enum: CALCS }),
  dateProperty: s.str("Date property for calendar views.", { maxLength: 100 }),
  cardPreview: s.str("Card preview for board/gallery.", { enum: ["cover", "none"] }),
  cardSize: s.str("Gallery card size.", { enum: ["small", "medium", "large"] }),
  wrap: s.bool("Wrap long cell text."),
  rowNumbers: s.bool("Table row numbers."),
  showFilterBar: s.bool("Show the filter/sort chip bar (default true)."),
  showIcons: s.bool("Show page icons beside titles (default true)."),
  limit: s.int("Rows shown before \"Load more\" (0 = default).", { minimum: 0, maximum: 1000 }),
  openIn: s.str("Where row pages open: modal (center peek, default), side (side peek), tab, current.", { enum: ["modal", "side", "tab", "current"] }),
  chart: chartPatch,
  custom: s.obj(
    {
      html: s.str("HTML/CSS/JS for a custom view, rendered in a sandboxed frame. The script gets window.noteral.database = { schema, view, rows } plus onChange(fn), openRow(id), setValue(rowId, propertyName, value), addRow(values?). Theme tokens are CSS variables; kit classes n-btn, n-card, n-list, n-item, n-chip, n-muted are predefined.", { maxLength: 400_000 }),
      height: s.int("Frame height in px (inline databases).", { minimum: 120, maximum: 2000 }),
    },
    [],
    "Custom view settings (custom views).",
  ),
};
const htmlView = s.str(
  "HTML for a sandboxed view (a fragment or a full document; inline <style> and <script> are fine, no remote scripts). The script gets a global `noteral` (props, setData, call, on, open, notify — see the View API guide). Theme tokens are available as CSS variables, and the kit classes n-btn, n-input, n-card, n-row, n-col, n-grid, n-chip, n-list, n-muted are predefined.",
  { maxLength: 400_000 },
);
const newProperties = s.arr(
  "Columns besides the title.",
  s.obj(
    {
      name: s.str("Property name.", { maxLength: 100 }),
      type: s.str("Property type.", { enum: PROPERTY_TYPES }),
      options: s.arr("Options for select / multiSelect / status.", s.str("Option name."), 50),
      ...formulaFields,
    },
    ["name", "type"],
  ),
  40,
);
const iconParam = s.str("Icon: an emoji or a Lucide icon name such as \"chart-line\".", { maxLength: 60 });
const menuSlot = s.str(
  "Menu: page (the page ⋯ actions menu), tree (page tree item menu), block (block handle menu), tab (a pane's tab options ⌄ menu), tabItem (right-click a tab), status (right-click the status bar), assistant (the AI button's ⌄ menu next to search) or treeSelection (several pages selected in the tree).",
  { enum: ["page", "tree", "block", "tab", "tabItem", "status", "assistant", "treeSelection"] },
);
const settingField = s.obj(
  {
    key: s.str("Option key (letters, digits, . - _).", { maxLength: 64, minLength: 1 }),
    type: s.str("Control.", { enum: ["toggle", "text", "textarea", "number", "slider", "select", "color"] }),
    label: s.str("Label.", { maxLength: 80 }),
    description: s.str("Help text under the control.", { maxLength: 300 }),
    section: s.str("Heading to group under.", { maxLength: 60 }),
    placeholder: s.str("Placeholder (text fields).", { maxLength: 120 }),
    default: s.any("Default value."),
    options: s.arr("Choices (select).", s.obj({ value: s.str("Stored value.", { maxLength: 120 }), label: s.str("Label.", { maxLength: 120 }) }, ["value"]), 40),
    min: s.num("Minimum (number, slider)."),
    max: s.num("Maximum (number, slider)."),
    step: s.num("Step (number, slider)."),
  },
  ["key", "type"],
);
const popupAnchor = s.obj(
  { x: s.num("Left."), y: s.num("Top."), width: s.num("Width."), height: s.num("Height.") },
  ["x", "y"],
  "Rect to open next to (window coordinates, or frame coordinates from a view — noteral.menu/popover fill it from an element).",
);
const popupPlacement = s.str("Where to open relative to the anchor.", { enum: ["bottom-start", "bottom-end", "top-start", "top-end", "right-start", "left-start"] });
const menuEntry = s.any(
  'A menu item { id, label, icon?, hint?, description?, checked?, danger?, disabled?, children? }, a header { type: "header", label }, or a separator ("-" or { type: "separator" }).',
);
const statusWidth: JsonSchema = {
  description: 'Width: px (16-1200), "auto" (fit content), "fill" (take the free space) or "NN%" of the bar. HTML widgets default to 120px.',
  anyOf: [{ type: "integer", minimum: 16, maximum: 1200 }, { type: "string", maxLength: 8 }],
};
const layerParam = s.str(
  "Customization layer to write to. Assistant: defaults to this chat's layer (so the user can switch it off). Plugins: defaults to the plugin's own layer. \"base\" writes the base look.",
  { maxLength: 80 },
);
const panelActions = s.arr("Buttons under Markdown content; pressing one raises panel:action (plugins).", s.obj({ id: s.str("Action id."), label: s.str("Label.", { maxLength: 40 }), primary: s.bool("Primary style.") }, ["id", "label"]), 8);
const widgetPatch = {
  type: s.str("Widget type (see home.widgetTypes). \"html\" is a fully custom widget.", { maxLength: 40 }),
  x: s.int("Column (0-23).", { minimum: 0, maximum: 23 }),
  y: s.int("Row (10px rows).", { minimum: 0, maximum: 2000 }),
  w: s.int("Width in columns (1-24).", { minimum: 1, maximum: 24 }),
  h: s.int("Height in rows (1 row = 10px).", { minimum: 1, maximum: 200 }),
  title: s.str("Card title.", { maxLength: 120 }),
  hideTitle: s.bool("Hide the title."),
  style: s.str("Card style.", { enum: ["default", "glass", "solid", "outline", "flat"] }),
  tint: s.str("Accent color (#rrggbb).", { maxLength: 20 }),
  variant: s.str("Widget-specific variant (e.g. clock: digital|analog|minimal).", { maxLength: 40 }),
  text: s.str("Text / Markdown for note, text and prompt widgets.", { maxLength: 20_000 }),
  limit: s.int("Items to show.", { minimum: 1, maximum: 50 }),
  pageId: s.str("Page/folder/database the widget points at."),
  pageIds: s.arr("Pages for links/gallery widgets.", s.str("Page id."), 50),
  url: s.str("Image URL or link.", { maxLength: 4000 }),
  date: s.str("ISO date for countdowns.", { maxLength: 40 }),
  html: htmlView,
  css: s.str("Extra CSS for this widget's card (`&` = the card).", { maxLength: 20_000 }),
  data: s.any("Free-form data for html widgets (noteral.props.data)."),
};

export const METHODS: MethodSpec[] = [
  // ── app ────────────────────────────────────────────────────────────────
  {
    name: "app.state",
    summary: "What the window shows now: the open page, panes and their tabs, sidebars and their tabs, whether the assistant is open, the open overlay, theme, window size and history.",
    permission: null,
    tier: "read",
    params: EMPTY,
    returns: "AppState",
  },
  {
    name: "app.info",
    summary: "Get the app version, SDK version, theme and the open workspace.",
    permission: null,
    tier: "read",
    params: EMPTY,
    returns: "AppInfo",
    example: `const info = await app.info();\nconsole.log(info.appVersion, info.theme);`,
  },

  // ── editor ─────────────────────────────────────────────────────────────
  {
    name: "editor.getActive",
    summary: "Get the page open in the focused pane, or null when Home or nothing is open.",
    permission: "editor.read",
    tier: "read",
    params: EMPTY,
    returns: "ActivePage | null",
  },
  {
    name: "editor.getMarkdown",
    summary: "Read the open page (or some of its blocks) as Markdown.",
    details: "Custom blocks such as embedded databases come out as a short placeholder.",
    permission: "editor.read",
    tier: "read",
    params: s.obj({ pageId, blockIds }),
    returns: "string",
    example: `const md = await app.editor.getMarkdown();`,
  },
  {
    name: "editor.getBlocks",
    summary: "List the open page's blocks with ids, types, text and nested children.",
    details: "Use the ids with editor.updateBlock, editor.replaceBlocks, editor.removeBlocks and editor.insertMarkdown.",
    permission: "editor.read",
    tier: "read",
    params: s.obj({ pageId }),
    returns: "BlockSummary[]",
  },
  {
    name: "editor.getSelection",
    summary: "Get the selected text, the selected block ids and the block with the cursor.",
    permission: "editor.read",
    tier: "read",
    params: s.obj({ pageId }),
    returns: "EditorSelection",
  },
  {
    name: "editor.snapshot",
    summary: "Get word count, block count, plain text and outline of the open page.",
    permission: "editor.read",
    tier: "read",
    params: EMPTY,
    returns: "EditorSnapshot | null",
  },
  {
    name: "editor.insertMarkdown",
    summary: "Insert Markdown at the cursor, at the start or end, or before/after a block.",
    permission: "editor.write",
    tier: "content",
    params: s.obj(
      {
        markdown,
        position: s.str("Where to insert. 'before'/'after' need blockId.", { enum: ["cursor", "start", "end", "before", "after"], default: "end" }),
        blockId: s.str("Anchor block for 'before'/'after'."),
        pageId,
      },
      ["markdown"],
    ),
    returns: "{ blockIds: string[] }",
    example: `await app.editor.insertMarkdown({ markdown: "## Summary\\n- one\\n- two", position: "end" });`,
  },
  {
    name: "editor.replaceBlocks",
    summary: "Replace blocks with new content parsed from Markdown.",
    permission: "editor.write",
    tier: "content",
    params: s.obj({ blockIds, markdown, pageId }, ["blockIds", "markdown"]),
    returns: "{ blockIds: string[] }",
  },
  {
    name: "editor.updateBlock",
    summary: "Change one block's type, text or props (e.g. heading level, checked).",
    details: "Types: paragraph, heading (props.level 1-3), bulletListItem, numberedListItem, checkListItem (props.checked), quote, codeBlock (props.language).",
    permission: "editor.write",
    tier: "content",
    params: s.obj(
      {
        blockId: s.str("Block id."),
        type: s.str("New block type."),
        text: s.str("New plain text content.", { maxLength: 20_000 }),
        props: s.map("Block props to set."),
        pageId,
      },
      ["blockId"],
    ),
    returns: "void",
  },
  {
    name: "editor.removeBlocks",
    summary: "Remove blocks from the open page.",
    permission: "editor.write",
    tier: "content",
    params: s.obj({ blockIds, pageId }, ["blockIds"]),
    returns: "void",
  },
  {
    name: "editor.setMarkdown",
    summary: "Replace the whole open page with Markdown.",
    details: "Undoable with editor.undo. Prefer targeted edits for small changes.",
    permission: "editor.write",
    tier: "content",
    params: s.obj({ markdown, pageId }, ["markdown"]),
    returns: "void",
  },
  {
    name: "editor.insertBlocks",
    summary: "Insert simple blocks after the cursor (SDK 1 shape).",
    permission: "editor.write",
    tier: "content",
    callers: ["plugin"],
    params: s.obj(
      {
        blocks: s.arr(
          "Blocks to insert.",
          s.obj(
            {
              type: s.str("Block type.", { enum: ["paragraph", "heading", "bulletListItem", "numberedListItem", "checkListItem", "quote", "codeBlock"] }),
              text: s.str("Text.", { maxLength: 20_000 }),
              level: s.int("Heading level.", { minimum: 1, maximum: 3 }),
              checked: s.bool("Checklist state."),
            },
            ["type"],
          ),
          100,
        ),
      },
      ["blocks"],
    ),
    returns: "void",
  },
  { name: "editor.undo", summary: "Undo the last edit in the open page.", permission: "editor.write", tier: "content", params: s.obj({ pageId }), returns: "boolean" },
  { name: "editor.redo", summary: "Redo the last undone edit in the open page.", permission: "editor.write", tier: "content", params: s.obj({ pageId }), returns: "boolean" },
  {
    name: "editor.scrollToBlock",
    summary: "Scroll the open page to a block.",
    permission: "editor.read",
    tier: "read",
    params: s.obj({ blockId: s.str("Block id."), pageId }, ["blockId"]),
    returns: "void",
  },
  {
    name: "editor.openFind",
    summary: "Open the find bar (or find & replace) in the open page.",
    permission: "editor.read",
    tier: "read",
    params: s.obj({ replace: s.bool("Show the replace row.") }),
    returns: "void",
  },

  // ── pages ──────────────────────────────────────────────────────────────
  {
    name: "pages.list",
    summary: "List pages, folders and databases in the open workspace.",
    details: "Pass parentId \"\" for top-level items. Database rows are pages whose parent is the database.",
    permission: "pages.read",
    tier: "read",
    params: s.obj({
      parentId: s.str("Only children of this item. \"\" = top level."),
      kind: s.str("Only this kind.", { enum: ["page", "folder", "database"] }),
      query: s.str("Only titles containing this text (case-insensitive)."),
      limit: s.int("Maximum results.", { minimum: 1, maximum: 2000, default: 500 }),
      includeRows: s.bool("Include database rows.", { default: false }),
    }),
    returns: "PageInfo[]",
    example: `const pages = await app.pages.list({ parentId: "" });`,
  },
  {
    name: "pages.stats",
    summary: "Content facts about a page: words, characters, blocks by type, headings, to-dos, links, page links, embedded databases, images, tables, code blocks, reading time, child pages (defaults to the open page).",
    details: "Open pages are counted from the live editor (unsaved edits included); closed pages from the saved copy. Database pages also return rows, properties and views.",
    permission: "pages.read",
    tier: "read",
    params: s.obj({ pageId: s.str("Page id (default: the open page).") }),
    returns: "PageStats",
    example: 'const s = await noteral.app.pages.stats(); noteral.setData(`${s.words} words · ${s.readingMinutes} min`);',
  },
  { name: "pages.get", summary: "Get one page's metadata.", permission: "pages.read", tier: "read", params: s.obj({ pageId: s.str("Page id.") }, ["pageId"]), returns: "PageInfo" },
  {
    name: "pages.read",
    summary: "Read any page's content as Markdown or plain text.",
    permission: "pages.read",
    tier: "read",
    params: s.obj({ pageId: s.str("Page id."), format: s.str("Output format.", { enum: ["markdown", "text"], default: "markdown" }) }, ["pageId"]),
    returns: "PageContent",
  },
  {
    name: "pages.path",
    summary: "Get the breadcrumb path (ancestors, top first) of a page.",
    permission: "pages.read",
    tier: "read",
    params: s.obj({ pageId: s.str("Page id.") }, ["pageId"]),
    returns: "PageInfo[]",
  },
  { name: "pages.favorites", summary: "List favorite pages.", permission: "pages.read", tier: "read", params: EMPTY, returns: "PageInfo[]" },
  { name: "pages.recent", summary: "List recently opened pages.", permission: "pages.read", tier: "read", params: EMPTY, returns: "PageInfo[]" },
  { name: "pages.backlinks", summary: "List pages that link to a page.", permission: "pages.read", tier: "read", params: s.obj({ pageId: s.str("Page id.") }, ["pageId"]), returns: "PageInfo[]" },
  { name: "pages.trash", summary: "List trashed pages.", permission: "pages.read", tier: "read", params: EMPTY, returns: "PageInfo[]" },
  {
    name: "pages.create",
    summary: "Create a page or folder, optionally with Markdown content.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({
      title: s.str("Title.", { maxLength: 300 }),
      parentId: s.str("Parent page or folder id. Omit for top level."),
      kind: pageKind,
      markdown,
      icon: s.str("Emoji icon."),
      open: s.bool("Open it in a tab.", { default: true }),
    }),
    returns: "PageInfo",
    example: `const page = await app.pages.create({ title: "Weekly review", markdown: "## Wins\\n- " });`,
  },
  {
    name: "pages.write",
    summary: "Replace a page's whole content with Markdown.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id."), markdown }, ["pageId", "markdown"]),
    returns: "void",
  },
  {
    name: "pages.edit",
    summary: "Change part of a page by find-and-replace, without resending the whole page.",
    details:
      "Each edit's find must match the page's Markdown exactly once (copy it from pages.read or editor.getMarkdown); whitespace differences are tolerated. Set all: true to replace every match. Edits apply in order; if one fails nothing changes. Open pages keep untouched blocks. Prefer this over pages.write / editor.setMarkdown for anything smaller than a rewrite.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id. Defaults to the page open in the focused pane."), edits: textEdits }, ["edits"]),
    returns: "{ replaced: number; blocksChanged?: number }",
    example: `await app.pages.edit({ pageId, edits: [{ find: "Due: Friday", replace: "Due: Monday" }] });`,
  },
  {
    name: "pages.append",
    summary: "Append Markdown to the end of a page.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id."), markdown }, ["pageId", "markdown"]),
    returns: "void",
  },
  { name: "pages.rename", summary: "Rename a page.", permission: "pages.write", tier: "content", params: s.obj({ pageId: s.str("Page id."), title: s.str("New title.", { maxLength: 300 }) }, ["pageId", "title"]), returns: "void" },
  {
    name: "pages.setIcon",
    summary: "Set a page's icon (an emoji, or \"\" to clear).",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id."), icon: s.str("Emoji or \"\".", { maxLength: 64 }) }, ["pageId", "icon"]),
    returns: "void",
  },
  {
    name: "pages.setCover",
    summary: "Set a page's cover: a CSS color/gradient, an image URL, or \"\" to clear.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id."), cover: s.str("Cover value.", { maxLength: 2000 }) }, ["pageId", "cover"]),
    returns: "void",
  },
  {
    name: "pages.getBackground",
    summary: "Read the page's background (the layer behind the whole page, not the cover), or null.",
    permission: "pages.read",
    tier: "read",
    params: s.obj({ pageId: s.str("Page id. Default: the active page.") }),
    returns: "PageBackgroundInfo | null",
  },
  {
    name: "pages.setBackground",
    summary: "Set the background behind a whole page: a color, gradient, image or animated ASCII scene (null clears).",
    details: [
      "kind color: value is a CSS color (hex, rgb()/hsl()/oklch(), a name or var(--token)).",
      "kind gradient: value is a CSS linear-/radial-/conic-gradient (no url()).",
      "kind image: value is an https URL, a data:image URL (max 48 KB) or an uploaded asset (/__assets/…).",
      "kind ascii: ascii = { scene (required): ascii-moon | ascii-sunset | ascii-galaxy | ascii-rain | ascii-dunes | ascii-topo (\"moon\" ok), speed 0.25–3 (default 1), ink \"#rrggbb\", density fine|normal|large, still: bool, cursor: bool }. Uses the same ASCII engine as Home backgrounds.",
      "opacity (0–1) fades the background; dim (0–1) lays a page-colored veil over it so text stays readable (defaults: image 0.35, ascii 0.55, else 0).",
      "Saved per workspace. Users set it from the page ⋯ menu → Background….",
    ].join(" "),
    permission: "pages.write",
    tier: "content",
    params: s.obj(
      {
        pageId: s.str("Page id. Default: the active page."),
        background: s.any("{ kind: color|gradient|image|ascii, value?, ascii?, opacity?, dim? }, or null to remove."),
      },
      ["background"],
    ),
    returns: "PageBackgroundInfo | null",
    example: "await noteral.pages.setBackground({ background: { kind: 'ascii', ascii: { scene: 'rain', speed: 0.8 }, dim: 0.6 } })",
  },
  {
    name: "pages.move",
    summary: "Move a page under another parent, optionally before a sibling.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id."), parentId: s.str("New parent id, \"\" for top level."), beforeId: s.str("Sibling to place it before.") }, ["pageId", "parentId"]),
    returns: "void",
  },
  {
    name: "pages.duplicate",
    summary: "Duplicate a page with its sub-pages.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id."), open: s.bool("Open the copy.", { default: false }) }, ["pageId"]),
    returns: "void",
  },
  {
    name: "pages.moveToTrash",
    summary: "Move a page (and its sub-pages) to the trash.",
    permission: "pages.write",
    tier: "content",
    confirm: true,
    params: s.obj({ pageId: s.str("Page id.") }, ["pageId"]),
    returns: "void",
  },
  { name: "pages.restore", summary: "Restore a page from the trash.", permission: "pages.write", tier: "content", params: s.obj({ pageId: s.str("Page id.") }, ["pageId"]), returns: "void" },
  {
    name: "pages.setFavorite",
    summary: "Add a page to favorites or remove it.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ pageId: s.str("Page id."), favorite: s.bool("Favorite or not.") }, ["pageId", "favorite"]),
    returns: "void",
  },

  // ── databases ──────────────────────────────────────────────────────────
  { name: "databases.list", summary: "List databases with their row counts.", permission: "databases.read", tier: "read", params: EMPTY, returns: "DatabaseInfo[]" },
  {
    name: "databases.getSchema",
    summary: "Get a database's properties (columns) and views.",
    permission: "databases.read",
    tier: "read",
    params: s.obj({ databaseId: s.str("Database id.") }, ["databaseId"]),
    returns: "DatabaseSchemaInfo",
  },
  {
    name: "databases.queryRows",
    summary: "Read a database's rows with values keyed by property name.",
    details: "Select/status values come back as option names. `where` matches exact values (case-insensitive for text).",
    permission: "databases.read",
    tier: "read",
    params: s.obj(
      {
        databaseId: s.str("Database id."),
        where: s.map("Property name → value that must match."),
        limit: s.int("Maximum rows.", { minimum: 1, maximum: 2000, default: 200 }),
      },
      ["databaseId"],
    ),
    returns: "DatabaseRowInfo[]",
    example: `const rows = await app.databases.queryRows({ databaseId, where: { Status: "Done" } });`,
  },
  {
    name: "databases.create",
    summary: "Create a database (a page in the tree) with properties and a first view.",
    details: "To put a database inside a page's content, use databases.embed instead. Property types: text, number, select, multiSelect, status, date, checkbox, url, email, phone, createdTime, lastEdited, formula (give `formula`).",
    permission: "databases.write",
    tier: "content",
    params: s.obj(
      {
        title: s.str("Database title.", { maxLength: 300 }),
        parentId: s.str("Parent page/folder id."),
        properties: newProperties,
        view: s.str("First view type.", { enum: VIEW_TYPES, default: "table" }),
        open: s.bool("Open it in a tab.", { default: true }),
      },
      ["title"],
    ),
    returns: "{ databaseId: string }",
  },
  {
    name: "databases.embed",
    summary: "Put a database inside a page's content: a new inline database, or a linked view of an existing one.",
    details:
      "With databaseId the block links that database (it stays where it is). Without it a new database is created as a child of the page (title, properties, view as in databases.create). Inserts at the end unless position says otherwise; before/after need blockId (from editor.getBlocks) or anchor (text of a block). Works whether or not the page is open. In page Markdown an embedded database is the line <!-- database:ID Title -->; keep it when editing.",
    permission: "databases.write",
    tier: "content",
    params: s.obj(
      {
        pageId: s.str("Page to insert into. Defaults to the page open in the focused pane."),
        databaseId: s.str("Existing database to link. Omit to create a new inline database."),
        title: s.str("New database title.", { maxLength: 300 }),
        properties: newProperties,
        view: s.str("First view type of a new database.", { enum: VIEW_TYPES, default: "table" }),
        position: s.str("Where in the page.", { enum: ["start", "end", "before", "after"], default: "end" }),
        blockId: s.str("Anchor block for before/after."),
        anchor: s.str("Or: text from the anchor block (first block containing it).", { maxLength: 300 }),
      },
    ),
    returns: "{ databaseId: string; pageId: string; created: boolean }",
    example: `await app.databases.embed({ pageId, title: "Tasks", properties: [{ name: "Status", type: "status" }, { name: "Due", type: "date" }], view: "board" });`,
  },
  {
    name: "databases.addProperty",
    summary: "Add a property (column) to a database.",
    permission: "databases.write",
    tier: "content",
    params: s.obj(
      {
        databaseId: s.str("Database id."),
        name: s.str("Property name.", { maxLength: 100 }),
        type: s.str("Property type.", { enum: PROPERTY_TYPES }),
        options: s.arr("Options for select / multiSelect / status.", s.str("Option name."), 50),
        ...formulaFields,
      },
      ["databaseId", "name", "type"],
    ),
    returns: "{ propertyId: string }",
  },
  {
    name: "databases.addRow",
    summary: "Add a row; values are keyed by property name.",
    details: "Dates: ISO \"2026-03-01\". Selects: option name (created if missing). Multi-select: array of names. Checkbox: boolean.",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ databaseId: s.str("Database id."), title: s.str("Row title.", { maxLength: 300 }), values: s.map("Property name → value.") }, ["databaseId"]),
    returns: "{ rowId: string }",
  },
  {
    name: "databases.addRows",
    summary: "Add many rows in one call (up to 500). Prefer this over repeated addRow.",
    details: "Each row is { title?, values? } with values keyed by property name, same rules as addRow. All rows are created in one transaction, in order.",
    permission: "databases.write",
    tier: "content",
    params: s.obj(
      {
        databaseId: s.str("Database id."),
        rows: s.arr("Rows to add.", s.obj({ title: s.str("Row title.", { maxLength: 300 }), values: s.map("Property name → value.") }), 500),
      },
      ["databaseId", "rows"],
    ),
    returns: "{ rowIds: string[]; count: number }",
    example: `await app.databases.addRows({ databaseId, rows: [{ title: "Ship v2", values: { Status: "Doing" } }, { title: "Write docs" }] });`,
  },
  {
    name: "databases.updateRows",
    summary: "Change many rows in one call (up to 500).",
    permission: "databases.write",
    tier: "content",
    params: s.obj(
      {
        updates: s.arr("Row changes.", s.obj({ rowId: s.str("Row (page) id."), title: s.str("New title.", { maxLength: 300 }), values: s.map("Property name → value. null clears.") }, ["rowId"]), 500),
      },
      ["updates"],
    ),
    returns: "{ count: number }",
  },
  {
    name: "databases.updateRow",
    summary: "Change a row's title and/or values (keyed by property name).",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ rowId: s.str("Row (page) id."), title: s.str("New title.", { maxLength: 300 }), values: s.map("Property name → value. null clears.") }, ["rowId"]),
    returns: "void",
  },

  {
    name: "databases.getView",
    summary: "Get one view with its filters, sorts, grouping, visible properties and calculations.",
    permission: "databases.read",
    tier: "read",
    params: s.obj({ databaseId: s.str("Database id."), viewId: s.str("View id (defaults to the first view).") }, ["databaseId"]),
    returns: "DatabaseViewInfo",
  },
  {
    name: "databases.queryView",
    summary: "Read rows the way a view shows them (its filters and sorts applied), optionally with a search.",
    permission: "databases.read",
    tier: "read",
    params: s.obj(
      {
        databaseId: s.str("Database id."),
        viewId: s.str("View id (defaults to the first view)."),
        search: s.str("Text search across all properties.", { maxLength: 200 }),
        filters: filterRules,
        filterMode: s.str("and | or for `filters`.", { enum: ["and", "or"] }),
        advanced: advancedFilter,
        sorts: sortRules,
        limit: s.int("Maximum rows.", { minimum: 1, maximum: 2000, default: 200 }),
      },
      ["databaseId"],
    ),
    returns: "DatabaseRowInfo[]",
    example: `const late = await app.databases.queryView({ databaseId, filters: [{ property: "Due", op: "before", value: "2026-01-01" }], sorts: [{ property: "Due" }] });`,
  },
  {
    name: "databases.addView",
    summary: "Add a view (table, board, gallery, list, calendar, chart or custom) with optional filters, sorts, grouping and settings.",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ databaseId: s.str("Database id."), ...viewPatch, type: s.str("Layout.", { enum: VIEW_TYPES, default: "table" }) }, ["databaseId"]),
    returns: "DatabaseViewInfo",
    example: `await app.databases.addView({ databaseId, type: "chart", name: "Spend by month", chart: { kind: "column", x: "Date", dateBucket: "month", aggregate: "sum", y: "Amount" } });`,
  },
  {
    name: "databases.updateView",
    summary: "Change a view: layout, filters (simple and advanced), sorts, grouping, visible properties, calculations, chart or custom settings, where rows open.",
    details: "Only the fields you pass change. `filters`, `sorts` and `advanced` replace the existing ones; pass [] / { items: [] } to clear. `chart` merges into the current chart settings.",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ databaseId: s.str("Database id."), viewId: s.str("View id."), ...viewPatch }, ["databaseId", "viewId"]),
    returns: "DatabaseViewInfo",
  },
  {
    name: "databases.removeView",
    summary: "Remove a view (a database keeps at least one).",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ databaseId: s.str("Database id."), viewId: s.str("View id.") }, ["databaseId", "viewId"]),
    returns: "void",
  },
  {
    name: "databases.duplicateView",
    summary: "Copy a view with all its settings.",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ databaseId: s.str("Database id."), viewId: s.str("View id."), name: s.str("Name of the copy.", { maxLength: 80 }) }, ["databaseId", "viewId"]),
    returns: "DatabaseViewInfo",
  },
  {
    name: "databases.moveView",
    summary: "Move a view to another position in the view tabs.",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ databaseId: s.str("Database id."), viewId: s.str("View id."), index: s.int("New position (0 = first).", { minimum: 0, maximum: 100 }) }, ["databaseId", "viewId", "index"]),
    returns: "void",
  },
  {
    name: "databases.updateProperty",
    summary: "Rename a property, change its type, formula, number/date format or select options.",
    details: "`options` replaces the option list for select / multi-select / status; existing options keep their ids when the name matches. Changing the type converts existing values where possible (a formula turned into another type keeps its current results). Renaming updates references in other formulas.",
    permission: "databases.write",
    tier: "content",
    params: s.obj(
      {
        databaseId: s.str("Database id."),
        property: propertyRef,
        name: s.str("New name.", { maxLength: 100 }),
        type: s.str("New type.", { enum: PROPERTY_TYPES }),
        ...formulaFields,
        options: s.arr(
          "Options (select / multi-select / status).",
          s.obj({ name: s.str("Option name.", { maxLength: 100 }), color: s.str("Color name.", { enum: ["default", "gray", "brown", "orange", "yellow", "green", "blue", "purple", "pink", "red"] }), group: s.str("Status group.", { enum: ["todo", "inProgress", "complete"] }) }, ["name"]),
          100,
        ),
      },
      ["databaseId", "property"],
    ),
    returns: "DatabaseSchemaInfo",
  },
  {
    name: "databases.formulaFunctions",
    summary: "The formula language: syntax and every function (math, text, style/link formatting, dates, lists, lambdas), one line each.",
    permission: "databases.read",
    tier: "read",
    params: EMPTY,
    returns: "string",
  },
  {
    name: "databases.checkFormula",
    summary: "Check a formula against a database without saving: errors (with line/column and did-you-mean hints), result type and sample results.",
    permission: "databases.read",
    tier: "read",
    params: s.obj({ databaseId: s.str("Database id."), formula: s.str("Formula source.", { maxLength: 4000 }), property: s.str("Formula property it is for (so it may use the others).", { maxLength: 100 }) }, ["databaseId", "formula"]),
    returns: "{ ok: boolean; error?: string; resultType?: string; sample?: { title: string; value: unknown; error?: string }[] }",
  },
  {
    name: "databases.removeProperty",
    summary: "Delete a property and its values from every row.",
    permission: "databases.write",
    tier: "content",
    confirm: true,
    params: s.obj({ databaseId: s.str("Database id."), property: propertyRef }, ["databaseId", "property"]),
    returns: "void",
  },
  {
    name: "databases.deleteRows",
    summary: "Move rows to the trash.",
    permission: "databases.write",
    tier: "content",
    confirm: true,
    params: s.obj({ rowIds: s.arr("Row ids.", s.str("Row id."), 500) }, ["rowIds"]),
    returns: "{ deleted: number }",
  },
  {
    name: "databases.setLocked",
    summary: "Lock or unlock a database. A locked database keeps its structure: no new properties, formula or type changes, and no column moves or resizes (for the user, plugins and the assistant). Rows, cells and views still change freely.",
    permission: "databases.write",
    tier: "content",
    confirm: true,
    params: s.obj({ databaseId: s.str("Database id."), locked: s.bool("true to lock, false to unlock.") }, ["databaseId", "locked"]),
    returns: "{ locked: boolean }",
  },
  {
    name: "databases.rename",
    summary: "Rename a database or its title column.",
    permission: "databases.write",
    tier: "content",
    params: s.obj({ databaseId: s.str("Database id."), title: s.str("New database title.", { maxLength: 300 }), titleColumn: s.str("New name of the title column.", { maxLength: 100 }) }, ["databaseId"]),
    returns: "void",
  },

  // ── workspaces ─────────────────────────────────────────────────────────
  { name: "workspaces.list", summary: "List workspaces.", permission: "workspaces.read", tier: "read", params: EMPTY, returns: "WorkspaceInfo[]" },
  {
    name: "workspaces.stats",
    summary: "Counts for the open workspace: pages, databases, rows, folders, favorites, trash, nesting depth, last edited page; with content: true also total words, characters, to-dos and the longest pages.",
    permission: "pages.read",
    tier: "read",
    params: s.obj({
      content: s.bool("Also read every page's text (slower).", { default: false }),
      limit: s.int("Pages to read with content (default 500).", { minimum: 1, maximum: 2000 }),
    }),
    returns: "WorkspaceStats",
  },
  { name: "workspaces.current", summary: "Get the open workspace.", permission: "workspaces.read", tier: "read", params: EMPTY, returns: "WorkspaceInfo | null" },
  { name: "workspaces.open", summary: "Switch to another workspace.", permission: "workspaces.write", tier: "app", confirm: true, params: s.obj({ workspaceId: s.str("Workspace id.") }, ["workspaceId"]), returns: "void" },
  { name: "workspaces.create", summary: "Create a workspace and switch to it.", permission: "workspaces.write", tier: "app", confirm: true, params: s.obj({ name: s.str("Name.", { maxLength: 80, minLength: 1 }) }, ["name"]), returns: "void" },
  { name: "workspaces.rename", summary: "Rename a workspace.", permission: "workspaces.write", tier: "app", params: s.obj({ workspaceId: s.str("Workspace id."), name: s.str("New name.", { maxLength: 80, minLength: 1 }) }, ["workspaceId", "name"]), returns: "void" },

  // ── navigation & tabs ─────────────────────────────────────────────────
  { name: "navigation.openPage", summary: "Open a page in the focused pane.", permission: "navigation", tier: "read", params: s.obj({ pageId: s.str("Page id.") }, ["pageId"]), returns: "void" },
  { name: "navigation.openHome", summary: "Open a Home tab.", permission: "navigation", tier: "read", params: EMPTY, returns: "void" },
  { name: "navigation.back", summary: "Go back in history.", permission: "navigation", tier: "read", params: EMPTY, returns: "void" },
  { name: "navigation.forward", summary: "Go forward in history.", permission: "navigation", tier: "read", params: EMPTY, returns: "void" },
  { name: "tabs.list", summary: "List open tabs (page tabs and Home tabs).", permission: "navigation", tier: "read", params: EMPTY, returns: "TabInfo[]" },
  { name: "tabs.close", summary: "Close a tab.", permission: "navigation", tier: "content", params: s.obj({ tabId: s.str("Tab id (a page id or a Home tab id).") }, ["tabId"]), returns: "void" },

  // ── layout ─────────────────────────────────────────────────────────────
  { name: "layout.get", summary: "Get panes, sidebars and their sizes.", permission: "layout", tier: "read", params: EMPTY, returns: "LayoutInfo" },
  {
    name: "layout.split",
    summary: "Split a pane; the new pane opens Home.",
    permission: "layout",
    tier: "app",
    params: s.obj({ paneId: s.str("Pane id. Defaults to the focused pane."), side: s.str("Side of the new pane.", { enum: ["left", "right", "top", "bottom"] }) }, ["side"]),
    returns: "void",
  },
  { name: "layout.closePane", summary: "Close a pane and its tabs.", permission: "layout", tier: "app", params: s.obj({ paneId: s.str("Pane id.") }, ["paneId"]), returns: "void" },
  { name: "layout.toggleMaximize", summary: "Maximize a pane or restore it.", permission: "layout", tier: "app", params: s.obj({ paneId: s.str("Pane id. Defaults to the focused pane.") }), returns: "void" },
  {
    name: "layout.setPanels",
    summary: "Show/hide the sidebars and rail, resize them, or switch their tabs.",
    permission: "layout",
    tier: "app",
    params: s.obj({
      leftOpen: s.bool("Show the left sidebar."),
      rightOpen: s.bool("Show the right sidebar."),
      railOpen: s.bool("Show the rail."),
      leftWidth: s.int("Left sidebar width (220–420).", { minimum: 220, maximum: 420 }),
      rightWidth: s.int("Right sidebar width (240–440).", { minimum: 240, maximum: 440 }),
      leftTab: s.str("Left sidebar tab.", { enum: ["tree", "favorites", "recent", "trash"] }),
      rightTab: s.str("Right sidebar tab.", { enum: ["outline", "backlinks", "info", "assistant"] }),
    }),
    returns: "void",
  },
  {
    name: "layout.openOverlay",
    summary: "Open an app dialog (command palette, library, plugins, settings, workspaces) or close it.",
    permission: "layout",
    tier: "read",
    params: s.obj({ overlay: s.str("Dialog to open; \"none\" closes.", { enum: ["palette", "library", "plugins", "settings", "workspaces", "none"] }) }, ["overlay"]),
    returns: "void",
  },

  // ── search ─────────────────────────────────────────────────────────────
  {
    name: "search.query",
    summary: "Full-text search across the open workspace.",
    permission: "search.read",
    tier: "read",
    params: s.obj({ query: s.str("Search text.", { maxLength: 500, minLength: 1 }), limit: s.int("Maximum hits.", { minimum: 1, maximum: 50, default: 20 }) }, ["query"]),
    returns: "SearchHitInfo[]",
  },

  // ── assets ─────────────────────────────────────────────────────────────
  { name: "assets.pickImage", summary: "Ask the user to pick an image; returns its URL.", permission: "assets.write", tier: "content", callers: ["plugin"], params: EMPTY, returns: "string | null" },
  { name: "assets.pickFile", summary: "Ask the user to pick a file; returns its URL.", permission: "assets.write", tier: "content", callers: ["plugin"], params: EMPTY, returns: "string | null" },

  // ── plugin settings ────────────────────────────────────────────────────
  { name: "settings.get", summary: "Read the plugin's saved settings.", permission: "settings.read", tier: "read", callers: ["plugin"], params: EMPTY, returns: "Record<string, unknown>" },
  { name: "settings.set", summary: "Merge a patch into the plugin's saved settings.", permission: "settings.write", tier: "content", callers: ["plugin"], params: s.obj({ patch: s.map("Keys to set; null removes.") }, ["patch"]), returns: "Record<string, unknown>" },
  {
    name: "settings.options",
    summary: "The plugin's user options: saved values merged over the defaults of its declared fields.",
    details: "Fields come from manifest contributes.settings and settings.define. The user edits them in the plugin's Configure dialog (Plugins → Installed → Options, the palette's \"Configure <plugin>\", or settings.openOptions); each change raises settings:changed.",
    permission: "settings.read",
    tier: "read",
    callers: ["plugin"],
    params: EMPTY,
    returns: "Record<string, unknown>",
  },
  {
    name: "settings.define",
    summary: "Declare (replace) the fields of the plugin's Options screen at runtime.",
    permission: "settings.read",
    tier: "app",
    callers: ["plugin"],
    params: s.obj({ fields: s.arr("Fields, in order.", settingField, 40) }, ["fields"]),
    returns: "SettingFieldInfo[]",
  },

  {
    name: "settings.openOptions",
    summary: "Open the plugin's Configure dialog (its option fields and its custom options page).",
    details: "Users also reach it from Plugins → Installed, the command palette (\"Configure <plugin>\") and the right-click menu of the plugin's status widgets.",
    permission: null,
    tier: "app",
    callers: ["plugin"],
    params: EMPTY,
    returns: "void",
  },
  {
    name: "settings.setPage",
    summary: "Give the plugin's Configure dialog a custom HTML options page (null removes it).",
    details:
      "The page is a sandboxed view like a panel: it can call noteral.call('settings.options'), noteral.call('settings.set', …) and noteral.close() to dismiss the dialog. The plain option fields still show below it unless showFields is false. Register it again on every start (it isn't saved).",
    permission: null,
    tier: "app",
    callers: ["plugin"],
    params: s.obj({
      html: s.str("Page HTML (body content; scripts allowed). Empty or omitted removes the page.", { maxLength: 200_000 }),
      title: s.str("Dialog title. Default \"<plugin> options\".", { maxLength: 80 }),
      width: s.int("Dialog width in px (320-1000).", { minimum: 320, maximum: 1000 }),
      height: s.int("Page height in px (80-900). The view also resizes to its content.", { minimum: 80, maximum: 900 }),
      showFields: s.bool("Show the declared option fields under the page (default true)."),
      open: s.bool("Open the dialog right away."),
    }),
    returns: "void",
    example: "await noteral.settings.setPage({ html: '<h3>Hello</h3><button class=\"n-btn\" onclick=\"noteral.close()\">Done</button>' })",
  },

  // ── preferences ────────────────────────────────────────────────────────
  { name: "preferences.get", summary: "Read app preferences (theme, fonts, page width, autosave, …).", permission: "preferences", tier: "read", params: EMPTY, returns: "Preferences" },
  {
    name: "preferences.update",
    summary: "Change app preferences.",
    permission: "preferences",
    tier: "app",
    params: s.obj({
      theme: s.str("Theme.", { enum: ["light", "dark", "system"] }),
      editorFont: s.str("Reading font.", { enum: ["serif", "sans"] }),
      fontSize: s.int("Editor font size (15–20).", { minimum: 15, maximum: 20 }),
      lineHeight: s.num("Editor line height (1.45–1.9).", { minimum: 1.45, maximum: 1.9 }),
      pageWidth: s.int("Page width in px (640–900).", { minimum: 640, maximum: 900 }),
      fullWidth: s.bool("Use the full pane width."),
      autosaveDelay: s.int("Autosave delay in ms (300–2000).", { minimum: 300, maximum: 2000 }),
      spellcheck: s.bool("Spellcheck."),
      reduceMotion: s.bool("Reduce motion."),
      showStats: s.bool("Show word count in the status bar."),
    }),
    returns: "Preferences",
  },

  // ── appearance ─────────────────────────────────────────────────────────
  { name: "appearance.get", summary: "Get the current customizations (tokens, CSS snippets, component styles).", permission: "appearance", tier: "read", params: EMPTY, returns: "Customizations" },
  { name: "appearance.listTokens", summary: "List the design tokens with their default light and dark values.", permission: "appearance", tier: "read", params: EMPTY, returns: "TokenInfo[]" },
  { name: "appearance.listComponents", summary: "List the app components that can be styled or hidden.", permission: "appearance", tier: "read", params: EMPTY, returns: "ComponentInfo[]" },
  {
    name: "appearance.setTokens",
    summary: "Override design tokens (colors, fonts, radii, sizes) for light and/or dark.",
    details: "Keys are token names without the leading dashes, e.g. { accent: \"#2f6fdf\", \"radius-md\": \"12px\" }. A null value removes an override.",
    permission: "appearance",
    tier: "app",
    params: s.obj({ light: s.map("Token → CSS value for the light theme."), dark: s.map("Token → CSS value for the dark theme."), both: s.map("Token → CSS value for both themes."), layer: layerParam }),
    returns: "Customizations",
    example: `await app.appearance.setTokens({ both: { accent: "#2f6fdf" }, dark: { bg: "#111418" } });`,
  },
  {
    name: "appearance.styleComponent",
    summary: "Style or hide an app component (see appearance.listComponents).",
    details: "`css` is a list of declarations applied to the component's root, e.g. \"border-radius: 16px; background: var(--bg-sunken)\". Use `rules` for nested selectors.",
    permission: "appearance",
    tier: "app",
    params: s.obj(
      {
        component: s.str("Component id."),
        css: s.str("CSS declarations for the component root. \"\" clears.", { maxLength: 4000 }),
        rules: s.str("Extra CSS rules; `&` is replaced by the component selector.", { maxLength: 8000 }),
        hidden: s.bool("Hide the component."),
        layer: layerParam,
      },
      ["component"],
    ),
    returns: "Customizations",
  },
  {
    name: "appearance.addCss",
    summary: "Add or replace a named CSS snippet applied to the whole app.",
    permission: "appearance",
    tier: "app",
    params: s.obj(
      { id: s.str("Snippet id (letters, digits, dashes).", { maxLength: 48, minLength: 1 }), css: s.str("CSS.", { maxLength: 50_000 }), label: s.str("Human label.", { maxLength: 80 }), enabled: s.bool("Enabled.", { default: true }), layer: layerParam },
      ["id", "css"],
    ),
    returns: "Customizations",
  },
  { name: "appearance.removeCss", summary: "Remove a CSS snippet.", permission: "appearance", tier: "app", params: s.obj({ id: s.str("Snippet id."), layer: layerParam }, ["id"]), returns: "Customizations" },
  {
    name: "appearance.reset",
    summary: "Reset customizations (all, or only tokens, CSS snippets or component styles).",
    permission: "appearance",
    tier: "app",
    confirm: true,
    params: s.obj({ scope: s.str("What to reset.", { enum: ["all", "tokens", "css", "components"], default: "all" }), layer: layerParam }),
    returns: "Customizations",
  },
  {
    name: "appearance.listLayers",
    summary: "List customization layers: switchable bundles of looks, sidebar tabs, status widgets, block and page types.",
    details: "The assistant writes each chat's changes to its own layer; plugins get one too. Users manage them in Plugins → Created.",
    permission: "appearance",
    tier: "read",
    params: EMPTY,
    returns: "LayerInfo[]",
  },
  {
    name: "appearance.setLayer",
    summary: "Create a layer or change its name, description or on/off state.",
    permission: "appearance",
    tier: "app",
    params: s.obj(
      { id: s.str("Layer id (lowercase letters, digits, dots, dashes, colons).", { maxLength: 80, minLength: 1 }), name: s.str("Name.", { maxLength: 80 }), description: s.str("What it changes.", { maxLength: 400 }), enabled: s.bool("On or off.") },
      ["id"],
    ),
    returns: "LayerInfo",
  },
  {
    name: "appearance.setLayerPermissions",
    summary: "Set the App API permissions a layer's HTML views (tabs, widgets, blocks, pages) run with.",
    details: "By default layer views can read pages, databases and the editor, navigate and notify. Granting write permissions lets their scripts change content.",
    permission: "appearance",
    tier: "app",
    confirm: true,
    params: s.obj({ id: s.str("Layer id."), permissions: s.arr("Permission ids.", s.str("Permission id."), 40) }, ["id", "permissions"]),
    returns: "LayerInfo",
  },
  { name: "appearance.removeLayer", summary: "Delete a layer and everything it adds.", permission: "appearance", tier: "app", confirm: true, params: s.obj({ id: s.str("Layer id.") }, ["id"]), returns: "void" },

  // ── commands ───────────────────────────────────────────────────────────
  { name: "commands.list", summary: "List every command in the command palette.", permission: null, tier: "read", params: s.obj({ query: s.str("Filter by title or category.") }), returns: "CommandInfo[]" },
  { name: "commands.execute", summary: "Run a command by id.", permission: "commands.execute", tier: "app", params: s.obj({ id: s.str("Command id.") }, ["id"]), returns: "void" },

  // ── ui ─────────────────────────────────────────────────────────────────
  {
    name: "ui.notify",
    summary: "Show a toast notification.",
    permission: "ui.notify",
    tier: "read",
    params: s.obj({ message: s.str("Message.", { maxLength: 300, minLength: 1 }), kind: s.str("Tone.", { enum: ["info", "success", "error"], default: "info" }) }, ["message"]),
    returns: "void",
  },
  {
    name: "ui.confirm",
    summary: "Ask the user to confirm something.",
    permission: "ui.modal",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      { title: s.str("Title.", { maxLength: 120 }), message: s.str("Message.", { maxLength: 2000 }), confirmLabel: s.str("Confirm button label.", { maxLength: 40 }), danger: s.bool("Destructive styling.") },
      ["title"],
    ),
    returns: "boolean",
  },
  {
    name: "ui.prompt",
    summary: "Ask the user to type a value. Resolves to null when cancelled.",
    permission: "ui.modal",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      { title: s.str("Title.", { maxLength: 120 }), message: s.str("Message.", { maxLength: 2000 }), placeholder: s.str("Placeholder.", { maxLength: 120 }), value: s.str("Initial value.", { maxLength: 2000 }), multiline: s.bool("Multi-line input.") },
      ["title"],
    ),
    returns: "string | null",
  },
  {
    name: "ui.pick",
    summary: "Ask the user to pick one item from a list. Resolves to the id or null.",
    permission: "ui.modal",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      {
        title: s.str("Title.", { maxLength: 120 }),
        items: s.arr("Choices.", s.obj({ id: s.str("Id."), label: s.str("Label.", { maxLength: 120 }), description: s.str("Hint.", { maxLength: 200 }) }, ["id", "label"]), 200),
      },
      ["title", "items"],
    ),
    returns: "string | null",
  },
  {
    name: "ui.ask",
    summary: "Ask the user a question with choices and/or a free-text answer, and wait for the reply.",
    details:
      "For the assistant this renders an inline question card in the chat; for plugins a dialog. Use it to clarify requirements or let the user choose between options instead of guessing. Returns { answer, choices, cancelled }.",
    permission: "ui.modal",
    tier: "read",
    params: s.obj(
      {
        question: s.str("The question.", { maxLength: 1000, minLength: 1 }),
        options: s.arr("Choices.", s.obj({ label: s.str("Choice label.", { maxLength: 120 }), description: s.str("One-line explanation.", { maxLength: 300 }) }, ["label"]), 8),
        multiple: s.bool("Allow picking several choices.", { default: false }),
        allowText: s.bool("Allow a typed answer (always on when there are no options).", { default: true }),
        placeholder: s.str("Placeholder for the typed answer.", { maxLength: 120 }),
      },
      ["question"],
    ),
    returns: "AskResult",
  },
  {
    name: "ui.menu",
    summary: "Open a menu (context menu or dropdown) and wait for the choice. Resolves to the chosen item id, or null when dismissed.",
    details:
      "Items can have icons (emoji or Lucide names), hints (shortcuts), descriptions, check marks, danger styling, headers, separators (\"-\") and submenus (`children`, up to 3 levels). In a view use `noteral.menu(items, event)` or `noteral.menu(items, element)` — it positions the menu at the click or under the element, even from a small widget. Without a position the menu opens at the last pointer position.",
    permission: "ui.modal",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      {
        items: s.arr("Menu items.", menuEntry, 200),
        x: s.num("Open at this x (window, or frame coordinates from a view)."),
        y: s.num("Open at this y."),
        anchor: popupAnchor,
        placement: popupPlacement,
        width: s.int("Menu width in px.", { minimum: 140, maximum: 480 }),
        filter: s.bool("Show a filter box above the items (long lists).", { default: false }),
      },
      ["items"],
    ),
    returns: "string | null",
    example: 'const choice = await noteral.menu([{ id: "rename", label: "Rename", icon: "pencil" }, "-", { label: "Color", children: [{ id: "red", label: "Red" }, { id: "blue", label: "Blue" }] }, { id: "delete", label: "Delete", danger: true }], event);',
  },
  {
    name: "ui.showModal",
    summary: "Open a modal dialog that renders your HTML, and wait until it closes. Resolves to the value passed to noteral.close(value) (or noteral.setData), or null when dismissed.",
    details:
      "The modal runs the HTML in a sandboxed view with your permissions (it can call noteral.call / noteral.app.* like any view). `data` arrives as `noteral.props.data`. Set `bare` to draw your own header, `dismissible: false` to require noteral.close().",
    permission: "ui.modal",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      {
        html: htmlView,
        title: s.str("Title (also the accessible name).", { maxLength: 120 }),
        subtitle: s.str("Line under the title.", { maxLength: 240 }),
        data: s.any("JSON passed to the view as noteral.props.data."),
        width: s.int("Max width in px (default 820).", { minimum: 240, maximum: 1400 }),
        height: s.int("Fixed height in px; omit to grow with the content.", { minimum: 80, maximum: 1200 }),
        dismissible: s.bool("Escape / backdrop / close button close it.", { default: true }),
        bare: s.bool("No header or padding around the view.", { default: false }),
      },
      ["html"],
    ),
    returns: "unknown",
    example: 'const result = await noteral.modal({ title: "Pick a color", width: 360, html: \'<button class="n-btn" onclick="noteral.close(\\\'red\\\')">Red</button>\' });',
  },
  {
    name: "ui.popover",
    summary: "Open a small floating panel with your HTML next to an element or point; it closes on outside click or Escape. Resolves to the value passed to noteral.close(value), or null.",
    permission: "ui.modal",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      {
        html: htmlView,
        data: s.any("JSON passed to the view as noteral.props.data."),
        x: s.num("Open at this x."),
        y: s.num("Open at this y."),
        anchor: popupAnchor,
        placement: popupPlacement,
        width: s.int("Width in px (default 300).", { minimum: 120, maximum: 900 }),
        height: s.int("Fixed height in px; omit to grow with the content.", { minimum: 40, maximum: 900 }),
      },
      ["html"],
    ),
    returns: "unknown",
    example: 'button.onclick = () => noteral.popover({ html: "<p>Details…</p>", width: 260 }, button);',
  },
  { name: "ui.closePopups", summary: "Close every modal and popover you opened.", permission: "ui.modal", tier: "read", callers: ["plugin"], params: EMPTY, returns: "void" },
  {
    name: "ui.setStatus",
    summary: "Show text in the status bar (declare the item in manifest.contributes.statusItems or by id).",
    permission: "ui.status",
    tier: "read",
    callers: ["plugin"],
    params: s.obj({ itemId: s.str("Status item id."), text: s.str("Text; \"\" hides it.", { maxLength: 160 }), title: s.str("Tooltip.", { maxLength: 200 }) }, ["itemId", "text"]),
    returns: "void",
  },
  {
    name: "ui.setPanel",
    summary: "Render a sidebar panel from Markdown, with optional action buttons.",
    details: "Buttons raise the panel:action event with the action id.",
    permission: "ui.panel",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      {
        panelId: s.str("Panel id."),
        title: s.str("Panel title.", { maxLength: 80 }),
        markdown: s.str("Panel content.", { maxLength: 20_000 }),
        actions: s.arr("Buttons.", s.obj({ id: s.str("Action id."), label: s.str("Label.", { maxLength: 40 }), primary: s.bool("Primary style.") }, ["id", "label"]), 6),
      },
      ["panelId", "markdown"],
    ),
    returns: "void",
  },
  {
    name: "ui.addStyles",
    summary: "Add CSS for the plugin's own look (replaces the plugin's previous styles).",
    permission: "ui.styles",
    tier: "app",
    callers: ["plugin"],
    params: s.obj({ css: s.str("CSS.", { maxLength: 100_000 }) }, ["css"]),
    returns: "void",
  },

  // ── clipboard ──────────────────────────────────────────────────────────
  { name: "clipboard.readText", summary: "Read text from the clipboard.", permission: "clipboard", tier: "read", params: EMPTY, returns: "string" },
  { name: "clipboard.writeText", summary: "Copy text to the clipboard.", permission: "clipboard", tier: "content", params: s.obj({ text: s.str("Text.", { maxLength: 1_000_000 }) }, ["text"]), returns: "void" },

  // ── web & network ─────────────────────────────────────────────────────
  {
    name: "web.search",
    summary: "Search the web (free, no API key). Returns titles, URLs and snippets.",
    details: "Uses DuckDuckGo with Wikipedia as a fallback. Fetch a result's URL with web.fetch to read it.",
    permission: "network",
    tier: "read",
    params: s.obj({ query: s.str("Search query.", { maxLength: 400, minLength: 1 }), limit: s.int("Maximum results.", { minimum: 1, maximum: 20, default: 8 }) }, ["query"]),
    returns: "WebSearchResult",
  },
  {
    name: "web.fetch",
    summary: "Fetch a web page and return its readable text, title and links.",
    permission: "network",
    tier: "read",
    params: s.obj({ url: s.str("http(s) URL.", { maxLength: 4000, minLength: 1 }), maxChars: s.int("Maximum characters of text.", { minimum: 500, maximum: 100_000, default: 20_000 }) }, ["url"]),
    returns: "WebPage",
  },
  {
    name: "network.request",
    summary: "Make an HTTP request (any method, headers and body) through the app.",
    details: "Requests to localhost and private networks are blocked. Bodies are text; binary responses come back base64 encoded.",
    permission: "network",
    tier: "read",
    callers: ["plugin"],
    params: s.obj(
      {
        url: s.str("http(s) URL.", { maxLength: 4000, minLength: 1 }),
        method: s.str("HTTP method.", { enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"], default: "GET" }),
        headers: s.map("Request headers.", { type: "string" }),
        body: s.str("Request body.", { maxLength: 2_000_000 }),
      },
      ["url"],
    ),
    returns: "HttpResponse",
  },

  // ── sidebar ───────────────────────────────────────────────────────────
  {
    name: "sidebar.list",
    summary: "List the right sidebar's tab groups (stacked panels) and every available tab.",
    permission: null,
    tier: "read",
    params: EMPTY,
    returns: "SidebarInfo",
  },
  {
    name: "sidebar.setTab",
    summary: "Add or update a right-sidebar tab with Markdown (+ buttons) or a full HTML view.",
    details:
      "Tabs from plugins live while the plugin runs; tabs from the assistant are saved in the chat's customization layer. A new tab is added to the first group unless `group` says otherwise; `split: true` opens it in a new group below.",
    permission: "ui.panel",
    tier: "app",
    params: s.obj(
      {
        id: s.str("Tab id, unique for this plugin or layer (letters, digits, dots, dashes).", { maxLength: 64, minLength: 1 }),
        title: s.str("Tab title.", { maxLength: 60, minLength: 1 }),
        icon: iconParam,
        markdown: s.str("Markdown content.", { maxLength: 40_000 }),
        actions: panelActions,
        html: htmlView,
        open: s.bool("Show the sidebar and activate the tab.", { default: false }),
        split: s.bool("Open in a new group below the others.", { default: false }),
        layer: layerParam,
      },
      ["id", "title"],
    ),
    returns: "SidebarTabInfo",
    example: `await app.sidebar.setTab({ id: "tasks", title: "Tasks", icon: "list-checks", html: "<ul id=list class=n-list></ul><script>noteral.app.databases.queryRows({databaseId:'…'}).then(r=>list.innerHTML=r.map(x=>'<li>'+x.title).join(''))</script>", open: true });`,
  },
  { name: "sidebar.removeTab", summary: "Remove a tab added with sidebar.setTab.", permission: "ui.panel", tier: "app", params: s.obj({ id: s.str("Tab id."), layer: layerParam }, ["id"]), returns: "void" },
  {
    name: "sidebar.openTab",
    summary: "Show the right sidebar and activate a tab (built-in: outline, backlinks, info, assistant).",
    permission: "layout",
    tier: "read",
    params: s.obj({ id: s.str("Tab id or key (see sidebar.list)."), split: s.bool("Move it into a new group below.", { default: false }) }, ["id"]),
    returns: "void",
  },
  {
    name: "sidebar.setLayout",
    summary: "Arrange the right sidebar: stacked groups of tabs, their order, sizes and active tabs.",
    details: "Each group is a panel with its own tab strip; groups stack top to bottom and `size` is a relative height. Tabs not listed stay in the last group.",
    permission: "layout",
    tier: "app",
    params: s.obj(
      {
        groups: s.arr(
          "Groups, top to bottom (max 6).",
          s.obj({ tabs: s.arr("Tab keys in order.", s.str("Tab key."), 40), active: s.str("Active tab key."), size: s.num("Relative height (default 1).", { minimum: 0.1, maximum: 10 }) }, ["tabs"]),
          6,
        ),
        width: s.int("Sidebar width in px.", { minimum: 240, maximum: 900 }),
      },
      ["groups"],
    ),
    returns: "SidebarInfo",
  },
  {
    name: "sidebar.moveTab",
    summary: "Move a tab to another group (or a new group) and position.",
    permission: "layout",
    tier: "app",
    params: s.obj({ id: s.str("Tab key."), group: s.int("Target group index; -1 = new group at the bottom.", { minimum: -1, maximum: 5 }), index: s.int("Position in the group.", { minimum: 0, maximum: 40 }) }, ["id", "group"]),
    returns: "SidebarInfo",
  },

  // ── status bar ────────────────────────────────────────────────────────
  { name: "statusBar.list", summary: "List status bar widgets (built-in and custom).", permission: null, tier: "read", params: EMPTY, returns: "StatusWidgetInfo[]" },
  {
    name: "statusBar.setWidget",
    summary: "Add or update a status bar widget: text with an icon and click command, or a small HTML view.",
    details: "HTML widgets render in a 22px-high sandboxed frame (`width` px wide) and can call the App API with the owner's permissions.",
    permission: "ui.status",
    tier: "app",
    params: s.obj(
      {
        id: s.str("Widget id.", { maxLength: 64, minLength: 1 }),
        text: s.str("Text.", { maxLength: 160 }),
        tooltip: s.str("Tooltip.", { maxLength: 300 }),
        icon: iconParam,
        html: htmlView,
        width: statusWidth,
        side: s.str("Side.", { enum: ["left", "center", "right"], default: "right" }),
        order: s.int("Order (lower first).", { minimum: -100, maximum: 100, default: 0 }),
        command: s.str("Command id to run on click (see commands.list).", { maxLength: 200 }),
        layer: layerParam,
      },
      ["id"],
    ),
    returns: "StatusWidgetInfo",
  },
  { name: "statusBar.removeWidget", summary: "Remove a status bar widget.", permission: "ui.status", tier: "app", params: s.obj({ id: s.str("Widget id."), layer: layerParam }, ["id"]), returns: "void" },
  {
    name: "statusBar.getLayout",
    summary: "The status bar layout in effect (separators, gap, height, per-item hidden/side/order/width) and every item with where it shows now.",
    permission: null,
    tier: "read",
    params: EMPTY,
    returns: "StatusBarLayoutInfo",
  },
  {
    name: "statusBar.configure",
    summary: "Customize the whole status bar: hide/move/reorder/resize any item (built-in or custom), separators between items, gap, height, padding, text size, or hide the bar.",
    details:
      "Item keys come from statusBar.list (built-ins: builtin:save, builtin:stats, builtin:plugins, builtin:page, builtin:clock, builtin:local; a short id like \"save\" or your own widget id also works). Separators default to none. Widths: px number, \"auto\", \"fill\" (takes free space) or \"NN%\" of the bar. Changes merge with the current layout; reset: true starts over. Plugins write their own layer (applies while they run); the assistant writes its chat layer, or the user's settings with layer: \"base\".",
    permission: "ui.status",
    tier: "app",
    params: s.obj({
      separator: s.str("What goes between items.", { enum: ["none", "line", "dot", "slash", "space"] }),
      gap: s.int("Space between items, px.", { minimum: 0, maximum: 48 }),
      height: s.int("Bar height, px.", { minimum: 16, maximum: 48 }),
      padding: s.int("Side padding, px.", { minimum: 0, maximum: 48 }),
      fontSize: s.num("Text size, px.", { minimum: 8, maximum: 16 }),
      hidden: s.bool("Hide the whole status bar."),
      items: s.map("Per item: { hidden?, side?: left|center|right, order? (-1000..1000), width?, align?: start|center|end }, keyed by item key."),
      reset: s.bool("Clear this target's layout first.", { default: false }),
      layer: layerParam,
    }),
    returns: "StatusBarLayoutInfo",
    example: 'await noteral.app.statusBar.configure({ separator: "line", items: { "builtin:save": { side: "right", order: 100 }, "builtin:clock": { hidden: false } } });',
  },
  {
    name: "statusBar.setItem",
    summary: "Show, hide, move, reorder or resize one status bar item (built-in or custom).",
    permission: "ui.status",
    tier: "app",
    params: s.obj(
      {
        key: s.str("Item key or id (see statusBar.list).", { maxLength: 200, minLength: 1 }),
        hidden: s.bool("Hide it."),
        side: s.str("Side.", { enum: ["left", "center", "right"] }),
        order: s.int("Order (lower first).", { minimum: -1000, maximum: 1000 }),
        width: statusWidth,
        align: s.str("Content alignment within its width.", { enum: ["start", "center", "end"] }),
        layer: layerParam,
      },
      ["key"],
    ),
    returns: "StatusBarLayoutInfo",
  },

  // ── menus ───────────────────────────────────────────────────────────────
  { name: "menus.list", summary: "List custom items in app menus (optionally one menu).", permission: null, tier: "read", params: s.obj({ menu: menuSlot }), returns: "MenuItemInfo[]" },
  {
    name: "menus.addItem",
    summary: "Add or update an item in an app menu: the page \"…\" menu, tree item menu, block menu, sidebar tab menu or status bar menu.",
    details:
      "Choosing the item runs `command`. For plugins it is one of the plugin's own command ids and the handler gets the menu context { menu, pageId, kind, nodeType, blockId, blockType, tabKey } (Plugin.addMenuItem does this for you). For assistant layers it is any app command id from commands.list.",
    permission: "menus",
    tier: "app",
    params: s.obj(
      {
        id: s.str("Item id.", { maxLength: 64, minLength: 1 }),
        menu: menuSlot,
        title: s.str("Label.", { maxLength: 80, minLength: 1 }),
        icon: iconParam,
        command: s.str("Command to run (see details).", { maxLength: 200, minLength: 1 }),
        kinds: s.arr("Only for these item kinds (page and tree menus).", s.str("Kind.", { enum: ["page", "folder", "database", "custom"] }), 4),
        nodeTypes: s.arr("Only for these custom page types.", s.str("Type id."), 20),
        blockTypes: s.arr("Only for these block types (block menu), e.g. paragraph, heading, or a custom type.", s.str("Block type."), 20),
        danger: s.bool("Show in red (destructive).", { default: false }),
        layer: layerParam,
      },
      ["id", "menu", "title", "command"],
    ),
    returns: "MenuItemInfo",
  },
  { name: "menus.removeItem", summary: "Remove a custom menu item.", permission: "menus", tier: "app", params: s.obj({ id: s.str("Item id."), layer: layerParam }, ["id"]), returns: "void" },

  // ── custom blocks ─────────────────────────────────────────────────────
  {
    name: "blocks.registerType",
    summary: "Register a custom editor block type rendered by an HTML view; it appears in the slash menu.",
    details:
      "Each block stores JSON data in the page. In the view, read it from `noteral.props.data` and save changes with `noteral.setData(next)`; `noteral.props.editable` says whether the page can be edited. Keep `type` stable: documents reference it.",
    permission: "blocks",
    tier: "app",
    params: s.obj(
      {
        type: s.str("Type id, e.g. \"kanban-mini\" (lowercase letters, digits, dots, dashes).", { maxLength: 64, minLength: 1 }),
        title: s.str("Name in the slash menu.", { maxLength: 60, minLength: 1 }),
        description: s.str("Slash menu hint.", { maxLength: 160 }),
        icon: iconParam,
        keywords: s.arr("Extra search words.", s.str("Keyword."), 12),
        html: htmlView,
        defaultData: s.any("Data for new blocks."),
        height: s.int("Initial height in px (the view auto-resizes).", { minimum: 24, maximum: 2000, default: 120 }),
        layer: layerParam,
      },
      ["type", "title", "html"],
    ),
    returns: "BlockTypeInfo",
    example: `await app.blocks.registerType({ type: "counter", title: "Counter", icon: "plus", defaultData: { n: 0 }, html: "<button class=n-btn id=b></button><script>const r=()=>b.textContent='Clicked '+noteral.props.data.n;r();noteral.onProps(r);b.onclick=()=>noteral.setData({n:noteral.props.data.n+1})</script>" });`,
  },
  { name: "blocks.unregisterType", summary: "Remove a custom block type (existing blocks show a placeholder).", permission: "blocks", tier: "app", params: s.obj({ type: s.str("Type id."), layer: layerParam }, ["type"]), returns: "void" },
  { name: "blocks.listTypes", summary: "List custom block types.", permission: null, tier: "read", params: EMPTY, returns: "BlockTypeInfo[]" },
  {
    name: "blocks.insert",
    summary: "Insert a custom block into the open page.",
    permission: "editor.write",
    tier: "content",
    params: s.obj({ type: s.str("Custom block type."), data: s.any("Block data (defaults to the type's defaultData)."), after: s.str("Insert after this block id (default: end of page).") }, ["type"]),
    returns: "{ blockId: string }",
  },
  {
    name: "blocks.setData",
    summary: "Replace the data of a custom block in the open page.",
    permission: "editor.write",
    tier: "content",
    params: s.obj({ blockId: s.str("Block id."), data: s.any("New data.") }, ["blockId", "data"]),
    returns: "void",
  },

  // ── custom nodes (page types) ─────────────────────────────────────────
  {
    name: "nodes.registerType",
    summary: "Register a custom page type for the page tree, opened in a full-page HTML view.",
    details:
      "Items of this type are created with nodes.create or from the tree's New menu. The view gets `noteral.props` = { pageId, title, icon, data, editable, layout } and saves with `noteral.setData(next)`. Items can have children like folders.",
    permission: "nodes",
    tier: "app",
    params: s.obj(
      {
        type: s.str("Type id (lowercase letters, digits, dots, dashes).", { maxLength: 64, minLength: 1 }),
        title: s.str("Type name, e.g. \"Kanban board\".", { maxLength: 60, minLength: 1 }),
        description: s.str("Shown in the New menu.", { maxLength: 160 }),
        icon: iconParam,
        html: htmlView,
        defaultData: s.any("Data for new items."),
        layout: s.str("\"full\" (default): the view is the whole page, edge to edge, and owns its scrolling; render your own header from noteral.props.title/icon. \"page\": a normal page head (icon, cover, title) above the view, which grows with its content so the page scrolls once.", { enum: ["full", "page"], default: "full" }),
        layer: layerParam,
      },
      ["type", "title", "html"],
    ),
    returns: "NodeTypeInfo",
  },
  { name: "nodes.unregisterType", summary: "Remove a custom page type (existing items show a placeholder).", permission: "nodes", tier: "app", params: s.obj({ type: s.str("Type id."), layer: layerParam }, ["type"]), returns: "void" },
  { name: "nodes.listTypes", summary: "List custom page types.", permission: null, tier: "read", params: EMPTY, returns: "NodeTypeInfo[]" },
  {
    name: "nodes.create",
    summary: "Create an item of a custom page type in the tree.",
    permission: "pages.write",
    tier: "content",
    params: s.obj({ type: s.str("Custom page type."), title: s.str("Title.", { maxLength: 300 }), parentId: s.str("Parent page/folder id."), data: s.any("Initial data (defaults to the type's defaultData)."), open: s.bool("Open it.", { default: true }) }, ["type"]),
    returns: "{ pageId: string }",
  },
  { name: "nodes.getData", summary: "Read a custom item's type and data.", permission: "pages.read", tier: "read", params: s.obj({ pageId: s.str("Item id.") }, ["pageId"]), returns: "{ type: string; data: unknown }" },
  { name: "nodes.setData", summary: "Replace a custom item's data.", permission: "pages.write", tier: "content", params: s.obj({ pageId: s.str("Item id."), data: s.any("New data.") }, ["pageId", "data"]), returns: "void" },

  // ── home ──────────────────────────────────────────────────────────────
  { name: "home.listViews", summary: "List Home views (built-in templates and custom views).", permission: null, tier: "read", params: EMPTY, returns: "HomeViewSummary[]" },
  { name: "home.widgetTypes", summary: "List Home widget types with their default sizes.", permission: null, tier: "read", params: EMPTY, returns: "HomeWidgetTypeInfo[]" },
  { name: "home.getView", summary: "Get a custom Home view with all widgets and settings.", permission: null, tier: "read", params: s.obj({ viewId: s.str("Custom view id.") }, ["viewId"]), returns: "HomeViewInfo" },
  {
    name: "home.createView",
    summary: "Create a custom Home view (empty, from a template layout, or a copy).",
    permission: "home",
    tier: "app",
    params: s.obj({ name: s.str("View name.", { maxLength: 40 }), from: s.str("Copy this custom view id instead of starting from the default layout."), empty: s.bool("Start with no widgets."), open: s.bool("Open it in the active Home tab.", { default: true }) }),
    returns: "HomeViewInfo",
  },
  {
    name: "home.updateView",
    summary: "Change a custom view's settings: name, width, gap, card style, radius, shadow, font, accent, CSS.",
    details: "`css` is scoped to the view: `&` is the Home view root, and `.home-card` / `[data-widget-type=…]` target cards.",
    permission: "home",
    tier: "app",
    params: s.obj(
      {
        viewId: s.str("Custom view id."),
        name: s.str("Name.", { maxLength: 40 }),
        title: s.str("Greeting headline override.", { maxLength: 120 }),
        width: s.str("Content width.", { enum: ["narrow", "wide", "full"] }),
        gap: s.str("Spacing.", { enum: ["tight", "normal", "roomy"] }),
        cards: s.str("Default card style.", { enum: ["glass", "solid", "outline", "flat"] }),
        radius: s.int("Card radius px.", { minimum: 0, maximum: 28 }),
        shadow: s.str("Card shadow.", { enum: ["none", "soft", "lifted"] }),
        font: s.str("Font.", { enum: ["serif", "sans", "mono"] }),
        valign: s.str("Vertical alignment.", { enum: ["top", "center"] }),
        accent: s.str("Accent #rrggbb (\"\" resets).", { maxLength: 20 }),
        css: s.str("Custom CSS for the view.", { maxLength: 50_000 }),
      },
      ["viewId"],
    ),
    returns: "HomeViewInfo",
  },
  { name: "home.removeView", summary: "Delete a custom Home view.", permission: "home", tier: "app", confirm: true, params: s.obj({ viewId: s.str("Custom view id.") }, ["viewId"]), returns: "void" },
  { name: "home.setDefault", summary: "Make a view (template id or custom view id) the default for new Home tabs.", permission: "home", tier: "app", params: s.obj({ viewId: s.str("View id.") }, ["viewId"]), returns: "void" },
  { name: "home.open", summary: "Open a Home view (template id or custom view id) in a Home tab.", permission: "navigation", tier: "read", params: s.obj({ viewId: s.str("View id.") }, ["viewId"]), returns: "void" },
  {
    name: "home.setBackground",
    summary: "Set a Home view's background: a preset, a color, a gradient or an animated wallpaper.",
    permission: "home",
    tier: "app",
    params: s.obj(
      {
        viewId: s.str("View id (template or custom)."),
        background: s.str("Preset id (see home.listViews → backgrounds), \"custom-color\" or \"custom-gradient\"."),
        color: s.str("#rrggbb for custom-color."),
        gradient: s.obj({ from: s.str("#rrggbb"), to: s.str("#rrggbb"), angle: s.int("Degrees.", { minimum: 0, maximum: 360 }), kind: s.str("Kind.", { enum: ["linear", "radial"] }) }, ["from", "to"]),
      },
      ["viewId", "background"],
    ),
    returns: "void",
  },
  {
    name: "home.addWidget",
    summary: "Add a widget to a custom Home view; type \"html\" is a fully custom widget (HTML/CSS/JS).",
    details: "Without x/y the widget goes into the first free spot. HTML widgets get `noteral.props` = { data, widgetId, viewId } and can persist with `noteral.setData(next)`.",
    permission: "home",
    tier: "app",
    params: s.obj({ viewId: s.str("Custom view id."), ...widgetPatch, type: s.str("Widget type (see home.widgetTypes).", { maxLength: 40 }) }, ["viewId", "type"]),
    returns: "HomeWidgetInfo",
    example: `await app.home.addWidget({ viewId, type: "html", title: "Weather", w: 8, h: 14, html: "<div class=n-card>☀️ 21°</div>" });`,
  },
  { name: "home.updateWidget", summary: "Change a Home widget (position, size, style, content).", permission: "home", tier: "app", params: s.obj({ viewId: s.str("Custom view id."), widgetId: s.str("Widget id."), ...widgetPatch }, ["viewId", "widgetId"]), returns: "HomeWidgetInfo" },
  { name: "home.removeWidget", summary: "Remove a Home widget.", permission: "home", tier: "app", params: s.obj({ viewId: s.str("Custom view id."), widgetId: s.str("Widget id.") }, ["viewId", "widgetId"]), returns: "void" },

  // ── views (plugins → their HTML views) ────────────────────────────────
  {
    name: "views.post",
    summary: "Send a message to the plugin's HTML views (tabs, widgets, blocks, pages); they receive it with noteral.onMessage.",
    permission: null,
    tier: "read",
    callers: ["plugin"],
    params: s.obj({ name: s.str("Message name.", { maxLength: 80 }), payload: s.any("JSON payload."), view: s.str("Only this view key (from the view:message event).") }, ["name"]),
    returns: "{ delivered: number }",
  },

  // ── source (assistant only) ────────────────────────────────────────────
  {
    name: "source.list",
    summary: "List everything with editable text (HTML, CSS, Markdown, plugin code) and its target id.",
    details: "Covers sidebar tabs, status widgets, block and page types, CSS snippets, component styles, Home widgets/views and plugins. Use the target with source.get / source.edit (plugins: plugins.edit).",
    permission: null,
    tier: "read",
    callers: ["assistant"],
    params: s.obj({ kind: s.str("Only this kind.", { enum: ["sidebar", "status", "block", "node", "css", "component", "home", "homeview", "plugin"] }) }),
    returns: "SourceEntry[]",
  },
  {
    name: "source.get",
    summary: "Read the current text of a target (e.g. a widget's HTML) before editing it.",
    details: "Pass startLine/endLine to read part of a long file. Fields: sidebar html|markdown, status html|text, block/node html, css css, component css|rules, home html|css|text, homeview css, plugin code|styles.",
    permission: null,
    tier: "read",
    callers: ["assistant"],
    params: s.obj(
      {
        target: s.str("Target from source.list, e.g. status:pomodoro, home:<viewId>/<widgetId>, plugin:<id>."),
        field: s.str("Which text (defaults to the main one)."),
        layer: s.str("Layer id when the same id exists in several layers."),
        startLine: s.int("First line (1-based).", { minimum: 1 }),
        endLine: s.int("Last line.", { minimum: 1 }),
      },
      ["target"],
    ),
    returns: "{ target: string; owner: string; field: string; lines: number; length: number; text: string }",
  },
  {
    name: "source.edit",
    summary: "Change part of a widget, tab, block/page type, CSS or Home widget by find-and-replace.",
    details:
      "Read it with source.get first; each find must match exactly once (whitespace differences tolerated) unless all: true. Edits apply in order and are all-or-nothing. Far cheaper than resending the whole HTML with setWidget/setTab/registerType — use it for every change to something that exists. Plugin code: use plugins.edit.",
    permission: null,
    tier: "app",
    callers: ["assistant"],
    params: s.obj({ target: s.str("Target from source.list."), field: s.str("Which text (defaults to the main one)."), layer: s.str("Layer id when ambiguous."), edits: textEdits }, ["target", "edits"]),
    returns: "{ target: string; field: string; replaced: number; length: number; owner?: string }",
  },

  // ── plugins (assistant only) ───────────────────────────────────────────
  { name: "plugins.list", summary: "List installed plugins.", permission: null, tier: "read", callers: ["assistant"], params: EMPTY, returns: "PluginInfo[]" },
  {
    name: "plugins.getSource",
    summary: "Read an installed plugin's manifest, code and styles.",
    permission: null,
    tier: "app",
    callers: ["assistant"],
    params: s.obj({ id: s.str("Plugin id.") }, ["id"]),
    returns: "PluginSourceInfo",
  },
  {
    name: "plugins.edit",
    summary: "Change an installed plugin's code or styles by find-and-replace, then test and reinstall it.",
    details: "Read it with plugins.getSource (or source.get plugin:<id>) first. The patch version is bumped automatically. Can also update permissions or description. Same test run and health check as plugins.create.",
    permission: null,
    tier: "app",
    callers: ["assistant"],
    confirm: true,
    params: s.obj(
      {
        id: s.str("Plugin id."),
        file: s.str("Which file the edits change.", { enum: ["code", "styles"], default: "code" }),
        edits: textEdits,
        permissions: s.arr("Replace the permission list.", s.str("Permission id."), 30),
        description: s.str("New description.", { maxLength: 500 }),
        version: s.str("Explicit new version (default: bump patch)."),
        skipTest: s.bool("Install even if the test run reports errors.", { default: false }),
      },
      ["id"],
    ),
    returns: "PluginInstallResult & { version: string; replaced: number }",
  },
  {
    name: "plugins.create",
    summary: "Install (or update) a plugin written by the assistant. The user reviews the code and permissions first.",
    details:
      "code is plain JavaScript run in a sandbox. It must call Noteral.register(class extends Noteral.Plugin { async onload() {…} onunload() {…} }). Use this.app.<namespace>.<method>(params) for every App API method (e.g. this.app.sidebar.setTab, this.app.statusBar.setWidget, this.app.blocks.registerType, this.app.nodes.registerType, this.app.home.addWidget), this.addCommand({ id, title, run }), this.setStatus(itemId, text), this.setPanel(panelId, { title, markdown, actions }), this.onPanelAction(panelId, fn), this.onViewMessage(fn), this.registerEvent(eventName, fn), this.addStyles(css), this.loadData() / this.saveData(patch). The plugin is test-run first (see plugins.test) and, after installing, its start-up is checked: the result's `health` reports errors so you can fix and reinstall.",
    permission: null,
    tier: "app",
    callers: ["assistant"],
    confirm: true,
    params: s.obj(
      {
        manifest: s.obj(
          {
            id: s.str("Reverse-DNS id, e.g. com.assistant.word-goal.", { maxLength: 80 }),
            name: s.str("Name.", { maxLength: 80 }),
            version: s.str("Semver, e.g. 1.0.0."),
            description: s.str("What it does.", { maxLength: 500 }),
            permissions: s.arr("Permissions the code needs.", s.str("Permission id."), 30),
            commands: s.arr("Commands it adds.", s.obj({ id: s.str("Command id (lowercase, dashes)."), title: s.str("Title.") }, ["id", "title"]), 30),
            statusItems: s.arr("Status bar items.", s.obj({ id: s.str("Item id."), label: s.str("Label.") }, ["id", "label"]), 10),
            panels: s.arr("Sidebar panels.", s.obj({ id: s.str("Panel id."), title: s.str("Title.") }, ["id", "title"]), 5),
          },
          ["id", "name", "version", "description"],
        ),
        code: s.str("Plugin JavaScript.", { maxLength: 500_000, minLength: 1 }),
        styles: s.str("Optional CSS (needs ui.styles).", { maxLength: 100_000 }),
        skipTest: s.bool("Install even if the test run reports errors.", { default: false }),
      },
      ["manifest", "code"],
    ),
    returns: "PluginInstallResult",
  },
  {
    name: "plugins.test",
    summary: "Run plugin code in a throw-away sandbox without installing it, and report errors, logs, commands and UI it registered.",
    details: "Write calls (except UI registration) are skipped during the test. Always test before plugins.create and fix every reported error.",
    permission: null,
    tier: "read",
    callers: ["assistant"],
    params: s.obj(
      {
        manifest: s.obj({ id: s.str("Plugin id."), name: s.str("Name."), version: s.str("Version."), permissions: s.arr("Permissions.", s.str("Permission id."), 40) }, ["id", "name"]),
        code: s.str("Plugin JavaScript.", { maxLength: 500_000, minLength: 1 }),
        styles: s.str("CSS.", { maxLength: 100_000 }),
        waitMs: s.int("How long to watch it (ms).", { minimum: 300, maximum: 8000, default: 1500 }),
      },
      ["manifest", "code"],
    ),
    returns: "PluginTestResult",
  },
  {
    name: "plugins.logs",
    summary: "Read an installed plugin's recent errors, warnings and console output.",
    permission: null,
    tier: "read",
    callers: ["assistant"],
    params: s.obj({ id: s.str("Plugin id."), limit: s.int("Entries.", { minimum: 1, maximum: 200, default: 50 }) }, ["id"]),
    returns: "LogEntryInfo[]",
  },
  {
    name: "plugins.uninstall",
    summary: "Uninstall a plugin.",
    permission: null,
    tier: "app",
    callers: ["assistant"],
    confirm: true,
    params: s.obj({ id: s.str("Plugin id.") }, ["id"]),
    returns: "void",
  },
  {
    name: "plugins.setEnabled",
    summary: "Enable or disable an installed plugin.",
    permission: null,
    tier: "app",
    callers: ["assistant"],
    params: s.obj({ id: s.str("Plugin id."), enabled: s.bool("Enabled.") }, ["id", "enabled"]),
    returns: "void",
  },
];

export const EVENTS: EventSpec[] = [
  { name: "document:changed", summary: "The open page changed (debounced). Payload is the editor snapshot.", permission: "editor.read", payload: "EditorSnapshot" },
  { name: "page:opened", summary: "A different page (or Home) became active.", permission: null, payload: "ActivePage | null" },
  { name: "theme:changed", summary: "Light/dark theme changed.", permission: null, payload: "{ theme: \"light\" | \"dark\" }" },
  { name: "workspace:opened", summary: "A workspace was opened.", permission: null, payload: "WorkspaceInfo" },
  { name: "pages:changed", summary: "Pages were created, renamed, moved or trashed.", permission: "pages.read", payload: "{ count: number }" },
  { name: "panel:action", summary: "A button in one of the plugin's panels or Markdown tabs was pressed.", permission: "ui.panel", payload: "{ panelId: string; actionId: string }" },
  { name: "settings:changed", summary: "The user changed the plugin's options.", permission: "settings.read", payload: "{ options: Record<string, unknown>; changed: string[] }" },
  { name: "view:message", summary: "One of the plugin's HTML views called noteral.post(name, payload).", permission: null, payload: "{ view: string; name: string; payload: unknown }" },
];

export const METHOD_MAP: ReadonlyMap<string, MethodSpec> = new Map(METHODS.map((method) => [method.name, method]));

export function callersOf(method: MethodSpec): Caller[] {
  return method.callers ?? ["plugin", "assistant"];
}

export const NAMESPACES = Array.from(new Set(METHODS.map((method) => method.name.split(".")[0])));

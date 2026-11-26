# Databases

A database is a page whose children are rows. Each row is itself a page with
properties, so every row can hold a full document. A database can live on its
own page, or be embedded in any page as a **database block** (inline or linked).

This guide covers what users can do, and how plugins and the assistant drive
the same features through the SDK (`app.databases.*`). The full method list is
in [sdk/api-reference.md](sdk/api-reference.md#databases).

## Views

Every database has one or more views. Each view keeps its own filters, sorts,
grouping, visible properties and layout options.

| Layout   | What it shows                                                   |
| -------- | --------------------------------------------------------------- |
| Table    | Rows and columns, resizable, footer calculations, row numbers   |
| Board    | Cards in columns by a select/status/checkbox/any property       |
| Gallery  | Cards with cover, small / medium / large                        |
| List     | Compact rows with title and chosen properties                   |
| Calendar | Rows placed on a date property                                  |
| Chart    | Bar, column, line, area, pie, donut, scatter, funnel, radar, heatmap, number tile (ECharts) |
| Custom   | Your own HTML/CSS/JS rendering of the rows                      |

The tabs sit on the same row as the header actions (Filter, Sort, Search,
View settings, New). When they don't fit, extra views fold into a **N more**
menu (**+N** on narrow screens). The active tab always stays visible.

### View settings

The **View settings** button (sliders icon) opens a menu with pages:

- **Layout** — switch the layout, and below it every display option of that
  layout: table wrap and row numbers, card preview and size, colour columns,
  calendar date property, **Show page icons**, **Load limit** (rows before
  *Load more*), **Show filter bar** (hides the chips bar under the header;
  filters still apply and the Filter button shows a count) and
  **Open pages in**.
- **Properties** — show / hide and reorder properties for this view.
- **Filter** — simple rules, AND / OR, and the advanced filter.
- **Sort** — multiple sorts, drag to reorder.
- **Group** — group by any property (table, list, gallery, board), hide empty
  groups, collapse / expand all, hide individual groups.
- **Lock database** — see below.
- Duplicate view, delete view.

### Locking a database

**Lock database** in the view settings keeps the rows as they are: cells
can't be edited, and rows can't be added, duplicated, moved or deleted. A
**Locked** button replaces **New** in the header (click it to unlock).
Properties and views still change normally, so you can still edit a
formula from its property menu.

The lock is stored in the schema as `"locked": true`. Plugins and the
assistant see it in `databases.getSchema` (`locked: true`) and get an error
from any row write; `databases.setLocked({ databaseId, locked })` changes it
(the assistant asks you first).

### Opening rows

`view.openIn` decides where a row page opens:

| Value     | Name        | Behaviour                                           |
| --------- | ----------- | --------------------------------------------------- |
| `modal`   | Center peek | A centered window over the database (**default**)   |
| `side`    | Side peek   | A panel on the right                                |
| `tab`     | New tab     | Opens in a new tab                                  |
| `current` | Full page   | Replaces the current tab                            |

Both peeks have previous / next row buttons, *open as full page*, and switch
between center and side. `Esc` closes them.

## Filters and sorts

Simple filters are chips in the filter bar: one rule per chip, joined by
`filterMode` (`"and"` / `"or"`). The bar scrolls sideways (mouse wheel works)
when there are many chips, and a **Clear** button removes them all.

The **advanced filter** is a tree of rules and nested groups, each group with
its own AND / OR (up to 4 levels). It is combined with the simple chips using AND.

Operators: `contains` `notContains` `is` `isNot` `startsWith` `endsWith`
`isEmpty` `isNotEmpty` `eq` `neq` `gt` `lt` `gte` `lte` `before` `after`
`onOrBefore` `onOrAfter` `within`. Select / status values are option names
(a list means *any of*). Dates are ISO or relative: `@today` `@yesterday`
`@tomorrow` `@weekAgo` `@weekAhead` `@monthAgo` `@monthAhead` `@yearAgo`;
`within` takes `pastWeek` … `thisYear`.

```ts
await app.databases.updateView({
  databaseId,
  viewId,
  filters: [{ property: "Status", op: "isNot", value: "Done" }],
  advanced: {
    mode: "or",
    items: [
      { property: "Due", op: "before", value: "@today" },
      { mode: "and", items: [
        { property: "Priority", op: "is", value: "High" },
        { property: "Owner", op: "isEmpty" },
      ] },
    ],
  },
  sorts: [{ property: "Due", direction: "asc" }, { property: "Name", direction: "asc" }],
});
```

## Formula properties

A formula property computes a value per row from other properties. Open its
editor from the property menu → **Edit formula**, or click a formula cell
(it shows that row's result) → **Edit formula**. In a locked database a cell
click does nothing; the property menu still works. The editor has:

- syntax highlighting, line numbers and multi-line editing (Enter keeps the
  indent; Tab indents), with matching brackets lit at the caret;
- completion for functions and properties while you type, or on Ctrl+Space
  (Tab / Enter to insert, Esc to hide)
  and signature help for the function under the caret;
- live errors with the exact line, column and spot underlined, plus
  "did you mean" hints for misspelled functions and properties;
- **undo / redo** (toolbar buttons, Ctrl/⌘+Z, Ctrl/⌘+Shift+Z or Ctrl+Y). It
  covers typing, completions, inserted examples and applied AI answers.
  Quick typing counts as one step;
- **saving as you type**: a valid formula saves itself a moment after you
  stop typing, and the toolbar shows *Saved*. While the code has an error the
  last working formula stays, the toolbar says so, and the status line offers
  **Fix with AI**. There is no Save or Cancel: close with Esc, Ctrl+Enter or ✕;
- a preview of one row's result. It starts on the first row, or on the row
  whose cell you clicked. Switch rows with the arrows or the row picker, which
  lists every row's result. The footer says whether every row works, or how
  many fail, with a link to the first one;
- the function reference under the code: put the caret in a function, or
  hover one in the **Functions** tab. It shows the signature, the return type,
  each parameter, examples checked against a sample row (click one to insert
  it), notes on edge cases and related functions;
- a side panel with two tabs. **Functions** lists searchable functions and
  properties by category, and a click inserts one.
  **Ask AI** is a small chat: describe what the formula should do, or start
  from a suggestion, and the configured AI provider writes it. It can also
  **Fix** or **Explain** the current one. The answer is
  checked against the formula engine and the database's properties; if it
  doesn't check out it is sent back once with the error. You then **Apply** or
  **Discard** the proposal. With no provider set up, the editor links to the
  assistant's provider settings. Applying an answer can be undone.

`Esc` or `Ctrl+Enter` closes the editor (the formula is already saved).

Refer to properties with `prop("Name")` or the short form `{Name}`.

```text
if({Status} == "Done", style("✓ Shipped", "green", "b"), fromNow({Due}))

// Formulas can span lines and have comments
let(left, workdaysBetween(today(), {Due}),   /* business days */
  if(left < 0, style("Overdue", "red_background"), left + " workdays left"))

{Price} * {Qty}
formatNumber({Done} / {Total}, "percent")      // 37.5%
link("Open " + {Key}, "https://tracker.example.com/" + {Key})
{Tags}.filter(current != "Old").join(", ")
reduce({Scores}, acc + current, 0)
```

Formulas return a number, text, checkbox, date (or a date range from
`dateRange`) or list. The result type is detected from the values; numbers and
dates can be given a display format. `style()` and `link()` return
**formatted text**: the cell shows it bold / italic / underlined / struck /
as code, in a color (`"red"`, `"blue"`, … the select-option colors) or on a
color background (`"red_background"`), or as a link. Links must be web,
email or phone links. Filters, sorts and charts see the plain text.

| Group      | Functions |
| ---------- | --------- |
| Logic      | `if` `ifs` `switch` `and` `or` `not` `empty` `isEmpty` `coalesce` `ifError` `equal` `unequal` `let` `lets`, operators `== != > < >= <=`, `and or not`, `? :` |
| Math       | `abs` `round` `floor` `ceil` `trunc` `min` `max` `sum` `mean` `average` `avg` `median` `product` `stdev` `mod` `pow` `sqrt` `cbrt` `exp` `ln` `log10` `log2` `sign` `pi` `e` `clamp` `between` `percent` `toFixed` `formatNumber`, `+ - * / % ^` |
| Text       | `concat` `join` `length` `lower` `upper` `trim` `capitalize` `titleCase` `replace` `replaceAll` `contains` `test` `match` `slice` `substring` `left` `right` `split` `startsWith` `endsWith` `padStart` `padEnd` `repeat` `format` `indexOf` `wordCount` `slugify` `truncate` `pluralize` `style` `unstyle` `link` |
| Date       | `now` `today` `dateAdd` `dateSubtract` `dateBetween` `daysUntil` `fromNow` `workdaysBetween` `addWorkdays` `isWeekend` `formatDate` `parseDate` `year` `quarter` `month` `day` `date` `weekday` `week` `hour` `minute` `second` `timestamp` `fromTimestamp` `startOf` `endOf` `dateRange` `start` `end` `dateStart` `dateEnd` |
| List       | `at` `first` `last` `sort` `reverse` `unique` `flat` `compact` `chunk` `zip` `map` `filter` `find` `findIndex` `some` `every` `includes` `count` `reduce` `range`; `current` and `index` inside `map` / `filter` / …, `acc` inside `reduce` |
| Type       | `typeOf` `toNumber` `toText` `toBoolean` |

`formatDate(date, pattern)` takes a style (`"relative"`, `"short"`, `"long"`,
`"full"`, `"iso"`) or a pattern built from `YYYY YY Q MMMM MMM MM M DD D Do
dddd ddd dd HH H hh h mm ss SSS A a W WW` (text in `[brackets]` is kept).
Any function can also be called as a method: `{Name}.lower()` is
`lower({Name})`.

Formulas can use other formulas (cycles are reported as errors). Formula
values work everywhere: filters, sorts, grouping, calculations and charts.

From code:

```ts
const docs = await app.databases.formulaFunctions();         // the reference above, with signatures and examples
const check = await app.databases.checkFormula({ databaseId, formula: "{Price} * {Qty}" });
// → { ok: true, resultType: "number", sample: [{ title, value }] }
//   or { ok: false, error: 'No property named "Qyt". Did you mean prop("Qty")? (line 1, column 11)' }
await app.databases.addProperty({ databaseId, name: "Total", type: "formula", formula: "{Price} * {Qty}" });
```

## Number display

Number properties, and formulas whose result is a number, can be shown as
something other than plain text: property menu → **Show as**.

| Style    | Looks like                                | Settings                          |
| -------- | ----------------------------------------- | --------------------------------- |
| `number` | The formatted value (**default**)         | —                                 |
| `bar`    | A progress bar, with the value beside it  | Color, divide by, show number     |
| `ring`   | A progress ring, with the value beside it | Color, divide by, show number     |
| `rating` | Stars, filled to the nearest half         | Color, stars (1–10, default 5)    |
| `heat`   | The value on a tint that deepens with it  | Color, divide by                  |

**Divide by** is the value that counts as full: 100 by default, or 1 when the
number format is *percent* (so `0.42` is 42 %). Values are clamped to 0…full.
The number format (`commas`, `dollar`, `percent`, …) still formats the shown
value. Bars and rings appear in tables, cards, lists and the row peek.

From code, `display` is accepted by `databases.create`, `addProperty` and
`updateProperty`; it merges over the current display, and `style: "number"`
clears it:

```ts
await app.databases.addProperty({ databaseId, name: "Progress", type: "number", format: "percent", display: { style: "ring", color: "green" } });
await app.databases.updateProperty({ databaseId, property: "Score", display: { style: "rating", max: 5 } });
await app.databases.updateProperty({ databaseId, property: "Budget", display: { style: "bar", max: 5000, showNumber: false } });
```

`databases.getSchema` returns the saved `display` for each property.

## Table columns

Drag a column edge to resize it. Double-click the edge to fit the column to
its header and the rows on screen (between 72 and 640 px); the width is saved
to the view like a normal resize.

## Chart views

Chart views read the view's filtered rows. Everything is optional; a sensible
default is picked from the schema.

```ts
await app.databases.addView({
  databaseId,
  type: "chart",
  name: "Budget by team",
  chart: { kind: "bar", x: "Team", aggregate: "sum", y: "Budget", series: "Status", stacked: true },
});
```

| Field        | Values |
| ------------ | ------ |
| `kind`       | `bar` `column` `line` `area` `pie` `donut` `scatter` `funnel` `radar` `heatmap` `number` |
| `x`          | Category property (any type; also `createdTime` / `lastEdited`) |
| `dateBucket` | `day` `week` `month` `quarter` `year` when `x` is a date |
| `aggregate`  | `count` `countValues` `countUnique` `sum` `average` `median` `min` `max` |
| `y`          | Number (or number formula) to aggregate; the y axis for scatter |
| `series`     | Second property that splits each category |
| `stacked`, `normalize`, `cumulative` | Stack, stack to 100 %, running total |
| `sort`       | `default` `label` `labelDesc` `value` `valueDesc` |
| `limit`      | Keep the first N categories, merge the rest into *Other* |
| `other`      | With `limit`: `true` (default) merges the rest into *Other*, `false` drops it |
| `aggregate2`, `y2` | Combo chart (column / line / area): a second measure drawn as a line on a right-hand axis |
| `omitEmpty`, `labels`, `legend`, `grid` | Display toggles |
| `labelContent` | Data labels show `value` `percent` `name` `nameValue` `namePercent` (default: value; pies `namePercent`; funnels `nameValue`) |
| `labelPosition` | `inside` `outside` (unset picks per chart) |
| `colorBy`, `color` | `category` (a colour per bar) or `single`; `color` is `accent` (default) or an option colour |
| `palette`    | `auto` (option colours) `ember` `harbor` `meadow` `graphite` `contrast` |
| `curve`, `points`, `gradient` | Line shape `straight` (default) `smooth` `step` (`smooth: true` still works); point markers (unset: shown when few points); fading area fill (default on) |
| `donutWidth` | Donut ring thickness, 10–90 % of the radius (default 34) |
| `xTitle`, `yTitle`, `xLabels`, `yLabels` | Axis titles; show or hide axis labels (default shown) |
| `labelAngle` | Category label angle `0` `30` `45` `60` `90` (unset rotates when crowded) |
| `logScale`, `yMin`, `yMax` | Logarithmic value axis (zero and negatives left out); axis bounds |
| `legendPosition`, `tooltip` | Legend `top` (default) `bottom` `left` `right`; tooltip `group` (default) `item` `off` |
| `goal`, `goalLabel` | Reference line and its label (default "Goal") |
| `zoom`, `zoomSlider` | Zoom and pan (default on for bar, column, line, area, scatter and grid heatmaps); range slider (default off) |
| `format`, `height`, `emptyText`, `title` | Number format, inline height, message when there are no rows, title (kept for compatibility, not shown in settings) |

**Zoom.** Hold Ctrl / ⌘ and scroll, or pinch on a trackpad, to zoom; a plain
scroll keeps scrolling the page (click into the chart first to zoom with the
plain wheel). Drag to pan. The tools in the chart's corner zoom in and out,
zoom to a dragged range, reset, and **expand** the chart into a large dialog
(Esc closes), where the plain wheel zooms. With the chart focused, `+` `-` `0`
zoom in, out and reset. The zoom resets when the chart's data or layout changes.

`number` renders a figure tile: the current period, change against the
previous period, the all-time total, the goal and a small trend line.

Clicking a bar, slice or cell lists the rows behind it; clicking a row opens it
(using the view's *Open pages in* mode). Charts follow the light / dark theme.
ECharts is loaded on demand, only when a chart view is shown.

## Custom views

A custom view renders the rows with your own HTML, CSS and scripts, in a
sandboxed frame with the app's design tokens (`--bg`, `--text`, `--accent`,
`--font-ui`, …) and the kit classes. Edit it from the view's **Edit code**
button, or let the assistant write it.

```ts
await app.databases.addView({
  databaseId,
  type: "custom",
  name: "Roadmap",
  custom: { html: `<div id="out"></div><script>
    noteral.database.onChange(({ rows }) => {
      out.innerHTML = rows.map((r) => \`<button data-id="\${r.id}">\${r.title}</button>\`).join("");
    });
    out.onclick = (e) => { const id = e.target.dataset.id; if (id) noteral.database.openRow(id); };
  </script>`, height: 420 },
});
```

Inside the frame, `window.noteral.database` has:

| Member | Description |
| ------ | ----------- |
| `schema` | Properties: `{ id, name, type, options? }` (formulas report `formula:<resultType>`) |
| `view` | The view's name, filters, sorts, grouping |
| `rows` | Filtered, sorted rows (max 2000): `{ id, title, icon, values: { [name]: value }, cells: { [name]: displayText } }` |
| `name` | Database title |
| `onChange(fn)` | Called now and on every change; returns an unsubscribe function |
| `openRow(id)` | Opens the row (respects *Open pages in*) |
| `setValue(id, property, value)` | Writes a cell (property by name or id; options by name) |
| `setTitle(id, title)` | Renames a row |
| `addRow(values?, title?)` | Adds a row |
| `deleteRow(id)` | Moves a row to the trash |

Everything else in the [view frame bridge](plugins/ui.md) (`noteral.theme`,
`noteral.onProps`, kit CSS) also works. The frame's background is transparent,
so it sits on the database surface.

## Embedding

The assistant and plugins embed databases with one call. A new database is
created inside the page; a linked database shows an existing one:

```ts
// New inline database
await app.databases.embed({ pageId, title: "Tasks", properties: [{ name: "Status", type: "status" }, { name: "Due", type: "date" }], view: "board" });
// Linked database
await app.databases.embed({ pageId, databaseId: existingId, position: "after", blockId });
```

Database blocks survive markdown round-trips (`editor.getMarkdown` /
`setMarkdown`): they are written as a `<!-- database:ID Title -->` line. A block
with its own views (below) is written as `<!-- block:BLOCK_ID database Title -->`
so its views come back with it.

### One block, several sources

In the editor, **/Database** opens one dialog: **New database** creates an empty
table in the page, or pick an existing database to show it here. Showing an
existing database gives the block its own table view, so filtering or sorting
it never changes the views on the database's page.

A block's tabs can come from different databases:

- **+ → From another source ›** adds a table from any database.
- The **+** layouts (Table, Board, …) use the source of the last tab.
- **View settings → Source** moves the current tab to another database. Display
  settings (name, icon, wrap, row limit, open mode…) carry over; filters, sorts
  and grouping refer to properties, so they start fresh.
- Drag tabs (or rows in the **N more** menu) to reorder them.
- Right-click a tab (or its ⌄) for **Change icon**: an emoji or icon replaces the
  layout glyph.

Views a block made for itself carry `owner: <block id>` and stay out of the
database's own tab list. The block stores its tabs as a `views` prop:
`[{ "db": "…", "view": "…" }, …]`. A block without one shows the database's
shared views, as before. `databases.updateView({ icon })` sets a tab icon
(`""` restores the layout glyph).

## Assistant

In Edit and Creator modes the assistant can create databases, embed them, add
and batch-edit rows (`databases.addRows`), add properties and formulas (it
checks them with `databases.checkFormula` first), and build chart and custom
views. See [assistant.md](assistant.md).

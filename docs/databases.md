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

- **Layout** — switch the layout; table wrap, row numbers, page icons, load
  limit (rows before *Load more*); **Open pages in**; plus layout-specific
  options (card size, colour columns, calendar date property, chart options).
- **Properties** — show / hide and reorder properties for this view.
- **Filter** — simple rules, AND / OR, and the advanced filter.
- **Sort** — multiple sorts, drag to reorder.
- **Group** — group by any property (table, list, gallery, board), hide empty
  groups, collapse / expand all, hide individual groups.
- **Show filter bar** — hides the chips bar under the header. Filters still
  apply; the Filter button shows a count.
- Duplicate view, delete view.

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
editor from the property menu → **Edit formula**. The editor has syntax
highlighting, completion (Tab / Enter), live errors with the exact spot,
a preview of the first rows, and a searchable reference of every function.
`Ctrl+Enter` saves.

Refer to properties with `prop("Name")` or the short form `{Name}`.

```text
if(prop("Status") == "Done", "✓ Shipped",
  if(dateBetween(prop("Due"), now(), "days") < 14 and prop("Progress") < 0.5, "At risk", "On track"))

{Price} * {Qty}
format(round({Hours} / 8, 1)) + " days"
lets(left, daysUntil({Due}), if(left < 0, "Overdue", left + " days left"))
```

Formulas return a number, text, checkbox, date or list. The result type is
detected from the values; numbers and dates can be given a display format.

| Group      | Functions |
| ---------- | --------- |
| Logic      | `if` `ifs` `and` `or` `not` `empty` `isEmpty` `coalesce` `equal` `unequal` `let` `lets`, operators `== != > < >= <=`, `and or not`, `? :` |
| Math       | `abs` `round` `floor` `ceil` `trunc` `min` `max` `sum` `mean` `average` `median` `mod` `pow` `sqrt` `cbrt` `exp` `ln` `log10` `log2` `sign` `pi` `e`, `+ - * / % ^` |
| Text       | `concat` `join` `length` `lower` `upper` `trim` `capitalize` `replace` `replaceAll` `contains` `test` `match` `slice` `substring` `split` `startsWith` `endsWith` `padStart` `padEnd` `repeat` `format` `indexOf` |
| Date       | `now` `today` `dateAdd` `dateSubtract` `dateBetween` `daysUntil` `formatDate` `parseDate` `year` `month` `day` `date` `weekday` `week` `hour` `minute` `second` `timestamp` `fromTimestamp` `start` `end` |
| List       | `at` `first` `last` `sort` `reverse` `unique` `flat` `map` `filter` `find` `findIndex` `some` `every` `includes` `count` `range`; `current` and `index` inside `map` / `filter` |
| Type       | `typeOf` `toNumber` `toText` `toBoolean` |

Formulas can use other formulas (cycles are reported as errors). Formula
values work everywhere: filters, sorts, grouping, calculations and charts.

From code:

```ts
const docs = await app.databases.formulaFunctions();         // the reference above, with signatures and examples
const check = await app.databases.checkFormula({ databaseId, formula: "{Price} * {Qty}" });
// → { ok: true, resultType: "number", sample: [{ title, value }] }  or  { ok: false, error: "…" }
await app.databases.addProperty({ databaseId, name: "Total", type: "formula", formula: "{Price} * {Qty}" });
```

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
| `omitEmpty`, `smooth`, `labels`, `legend`, `grid` | Display toggles |
| `palette`    | `auto` (option colours) `ember` `harbor` `meadow` `graphite` `contrast` |
| `goal`, `yMin`, `yMax`, `format`, `title`, `height` | Reference line, axis bounds, number format, title, inline height |

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
`setMarkdown`): they are written as a `<!-- database:ID Title -->` line.

## Assistant

In Edit and Creator modes the assistant can create databases, embed them, add
and batch-edit rows (`databases.addRows`), add properties and formulas (it
checks them with `databases.checkFormula` first), and build chart and custom
views. See [assistant.md](assistant.md).

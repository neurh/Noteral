# Noteral Plugin SDK 1.x

Noteral plugins are small TypeScript/JavaScript programs that extend the
command palette, status bar, and inspector. They run in a **sandboxed iframe**
with an opaque origin. They never receive a Wails binding, filesystem access,
Node.js, the host DOM, or a shell. The only bridge is `postMessage`, and the
host validates every message against the plugin's manifest and permissions.

SDK version: **1.0.0** (`sdk/package.json`). A plugin declares a compatible
`sdkVersion`; the host currently accepts major version `1`.

## Quick start

```sh
cp -R examples/starter my-plugin
# edit my-plugin/plugin.json, src/plugin.ts
# add the folder to the build script or import its source
node scripts/build-plugins.mjs
cd my-plugin
zip -r my-plugin.noteral-plugin.zip plugin.json plugin.js
```

Install the zip from **Plugins → Install from zip**. Newly installed plugins
start disabled so their permissions can be reviewed. Enable the plugin with its
toggle; commands, status items, and panels appear without restarting Noteral.

The two official examples are:

- `examples/reading-time` — live word count/reading-time status and inspector
  panel. Permissions: `editor.read`, `ui.status`, `ui.panel`.
- `examples/meeting-notes` — slash/palette command that inserts a meeting note
  template. Permissions: `editor.read`, `editor.write`, `ui.notify`.

Their built catalog bundles live in
`internal/plugins/catalog/plugins/<plugin-id>/` and are embedded into the app.
The starter output is `examples/starter/plugin.js`.

## Manifest

`plugin.json` is validated on install and before the runtime starts.

```json
{
  "id": "com.example.reading-time",
  "name": "Reading Time",
  "version": "1.0.0",
  "sdkVersion": "1.0.0",
  "description": "A live word count and reading-time estimate.",
  "author": "Example",
  "entry": "plugin.js",
  "permissions": ["editor.read", "ui.status"],
  "contributes": {
    "commands": [
      {
        "id": "insert-summary",
        "title": "Insert summary",
        "description": "Adds a summary paragraph.",
        "keywords": "summary word count"
      }
    ],
    "statusItems": [
      { "id": "reading-time", "label": "Reading time" }
    ],
    "panels": [
      { "id": "reading-stats", "title": "Reading stats" }
    ]
  }
}
```

Rules:

- `id` must be a dotted lowercase identifier and match the install folder.
- `version` is semver; `sdkVersion` must be SDK major `1`.
- `entry` is a relative path inside the bundle (commonly `plugin.js`). Path
  traversal, absolute paths, symlinks, oversized files, and missing entries are
  rejected.
- Contribution IDs use lowercase letters, digits, and hyphens, start with a
  letter, and are unique within their contribution type.
- Limits: 40 commands, 12 status items, 8 panels.

## Permissions

| Permission | Allows |
| --- | --- |
| `editor.read` | `editor.snapshot()` and document text/stat events |
| `editor.write` | `editor.insertBlocks()` / `blocks.insert()` |
| `pages.read` | `pages.list()`, `pages.get()` |
| `workspaces.read` | `workspaces.list()`, `workspaces.current()` |
| `navigation` | `navigation.openPage()` |
| `search.read` | `search.query()` |
| `assets.write` | `assets.pickImage()`, `assets.pickFile()` |
| `settings.read` | `settings.get()` |
| `settings.write` | `settings.set()` |
| `ui.status` | update declared status items |
| `ui.notify` | show a short toast |
| `ui.panel` | write text to declared inspector panels |

`tabs.list()` and `tabs.open()` use `pages.read`; `editor.insertBlocks()` uses
`editor.write`; `workspaces.*` also accepts `pages.read` for compatibility.

## Writing a plugin

Use the global `Noteral` object created by the SDK. Do not import the SDK at
runtime: the host injects it into the iframe. Type-only imports are fine.

```ts
import type { EditorSnapshot, PluginContext } from "@noteral/sdk";

type Runtime = {
  definePlugin(
    setup: (context: PluginContext) => void | Promise<void>
  ): void;
};

const Noteral = (window as unknown as { Noteral: Runtime }).Noteral;

Noteral.definePlugin(async (context) => {
  const update = (snapshot: EditorSnapshot) => {
    const minutes = Math.max(1, Math.ceil(snapshot.wordCount / 220));
    context.status.set("reading-time", `${snapshot.wordCount} words · ${minutes} min`);
    context.panels.set("reading-stats", `About ${minutes} minutes at 220 wpm.`);
  };

  update(await context.editor.snapshot());
  context.events.on("document:changed", (data) => update(data as EditorSnapshot));

  context.commands.on("insert-summary", async () => {
    const snapshot = await context.editor.snapshot();
    await context.editor.insertBlocks([
      { type: "paragraph", text: `This page has ${snapshot.wordCount} words.` }
    ]);
    context.ui.notify("Summary inserted");
  });
});
```

### Context API

| Member | Description |
| --- | --- |
| `manifest` | The validated manifest sent by the host. |
| `commands.on(id, handler)` | Register the handler for a declared command. Returns an unsubscribe function. |
| `status.set(itemId, text, title?)` | Update a declared status item (text ≤ 160 chars). |
| `panels.set(panelId, text)` | Write plain text (≤ 4000 chars) to a declared inspector panel. |
| `editor.snapshot()` | `{ pageId, title, wordCount, blockCount, text }` for the active page. |
| `editor.insertBlocks(blocks)` | Insert SDK block descriptions at the cursor (requires `editor.write`). |
| `blocks.insert(blocks)` | Alias for `editor.insertBlocks`. |
| `pages.list()` / `pages.get(id)` | Page metadata. |
| `workspaces.list()` / `workspaces.current()` | Workspace metadata. |
| `tabs.list()` / `tabs.open(pageId)` | Open tabs and tab navigation. |
| `navigation.openPage(pageId)` | Open a page in the app. |
| `search.query(text)` | Full-text search in the current workspace. |
| `assets.pickImage()` / `assets.pickFile()` | Native picker; returns an asset URL or `null`. |
| `settings.get()` / `settings.set(patch)` | Per-plugin settings JSON, shallow-merged. |
| `ui.notify(message)` | Short toast. |
| `events.on("document:changed" \| "theme:changed", handler)` | Host events. |

Block descriptions are intentionally small:

```ts
type PluginBlock = {
  type: string;                 // "paragraph", "heading", "bulletListItem", ...
  text?: string;
  props?: Record<string, unknown>;
  children?: PluginBlock[];
};
```

### Lifecycle

1. The host reads the installed manifest and, if enabled, gets the entry code.
2. It creates `<iframe sandbox="allow-scripts">` with a CSP that allows inline
   scripts but no remote code. The SDK and plugin code are injected into
   `srcdoc`.
3. The SDK posts `ready`; the host posts `init` plus initial document/theme
   events and registers the plugin's commands.
4. Disabling/removing the plugin removes the iframe, unregisters its command
   prefix, and drops its status items and panels immediately.

The SDK 1.0 request timeout is 10 seconds. Unknown methods, oversized payloads,
undeclared contributions, and missing permissions are rejected by the host.

## Building and packaging

`scripts/build-plugins.mjs` does four things:

1. Bundles `sdk/src/index.ts` to `/tmp/noteral-sdk.js`.
2. Writes it as `frontend/src/plugins/generated/sdkSource.ts` (injected into
   every iframe).
3. Bundles the Reading Time and Meeting Notes examples into the embedded
   catalog.
4. Bundles the starter example to `examples/starter/plugin.js`.

```sh
npm run plugins:build
cd examples/starter
zip -r starter.noteral-plugin.zip plugin.json plugin.js
```

The zip may contain the manifest and entry at the root, or a single top-level
folder containing them. Install it from the Plugin Manager. The installed copy
is `<data root>/plugins/<id>/`; settings are kept beside it in `settings.json`.

## Catalog format

Bundled catalog (`internal/plugins/catalog/catalog.json`):

```json
{
  "version": 1,
  "plugins": [
    {
      "id": "com.example.plugin",
      "name": "Example",
      "version": "1.0.0",
      "sdkVersion": "1.0.0",
      "entry": "plugin.js",
      "permissions": ["editor.read"],
      "contributes": {}
    }
  ]
}
```

Each catalog entry is a full manifest. Catalog install copies
`catalog/plugins/<id>/` into the data directory and leaves the plugin disabled,
except built-in `com.noteral.*` examples, which are enabled on install.

A remote catalog is fetched only when the user clicks **Fetch** and supplies an
`http(s)` URL. The response is limited to 512 KB and 10 seconds; entries are
validated and shown for reference only. To install a remotely listed plugin,
download its zip yourself and use **Install from zip**. Noteral never downloads
code from the network or auto-installs from a remote catalog.

## Debugging

- Errors from the plugin runtime become toast messages prefixed with the plugin
  name (up to 500 chars).
- A plugin that never sends `ready` shows “did not start” after 6 seconds.
- The Plugin Manager shows a `problem` field if the installed manifest/entry is
  invalid.
- In development, Chrome/WebKit devtools can inspect the host app. The plugin
  iframe is intentionally opaque-origin, so use host-side validation errors
  rather than trying to reach parent state directly.
- Toggle the plugin off/on to recreate its iframe. No app restart is needed.

## Security boundary

The host enforces:

- manifest allowlists and per-contribution declaration checks;
- permission checks before every request/status/panel message;
- `event.source === iframe.contentWindow` and protocol version checks;
- 512 KB request limit, 100-block limit, 200-char search/notify limits;
- iframe `sandbox="allow-scripts"` with no `allow-same-origin`, no raw Wails
  binding, no Node, no filesystem, and no host DOM;
- validated relative entry paths and zip extraction limits.

Do not add `allow-same-origin`, do not inject plugin code into the app renderer,
and do not add a generic `eval`/filesystem bridge to the host. New capabilities
need a permission, a host allowlist entry, and tests.

# Architecture

Noteral is one native process with a Go backend and a React/BlockNote renderer.

```text
Wails v3 window
├── React 19 renderer
│   ├── Zustand store (workspaces, page metadata, open documents, tabs, UI)
│   ├── BlockNote editor per open tab (inactive tabs stay mounted)
│   ├── command registry (titlebar, shortcuts, palette, plugin commands)
│   └── plugin host (sandboxed iframe per enabled plugin)
└── Go services (generated TS bindings)
    ├── AppService
    ├── Store (app DB + per-workspace SQLite)
    ├── asset manager
    └── plugin manager
```

## Startup

`main.go` resolves the data root, opens the app database, constructs the
service/asset/plugin managers, creates the Wails window, and registers a close
hook. On first launch the app database seeds **Default Workspace**; opening that
workspace seeds the welcome page and UI settings exactly once.

The embedded frontend is served by `AssetFileServerFS`. A small middleware
handles `/__assets/<workspace>/<relative-path>`; everything else goes to the
embedded (or Wails dev) handler. In `wails3 dev`, Vite serves the renderer and
proxies `/__assets` to a local Go server on port 9246.

## Data directories

Chosen by `--data-dir`, then `NOTERAL_DATA_DIR`, then the platform's per-user
application-data directory (`~/Library/Application Support/Noteral` on macOS,
`%LOCALAPPDATA%\Noteral` on Windows, `$XDG_DATA_HOME/noteral` or
`~/.local/share/noteral` on Linux). If no home directory is available it falls
back to `Data/` beside the executable, and a legacy `Data/` library is moved
into the new root on first launch. Startup writes and removes a probe file;
failure is fatal with instructions to pass `--data-dir`.

```text
<data root>/
├── noteral.db
├── workspaces/<workspace-id>/workspace.db
├── workspaces/<workspace-id>/assets/<yyyy>/<mm>/<random>-<name>
├── plugins/<plugin-id>/{plugin.json (normalized manifest),main.js,styles.css,settings.json}
├── ai/{providers.json,settings.json,chats/}
└── backups/<YYYY-MM-DD>/{noteral.db,workspaces/.../workspace.db,manifest.json}
```

The workspace ID is validated with a small identifier regexp before it becomes
a path. Assets are stored relative to the workspace; absolute paths and `..`
are rejected.

## SQLite

The app DB stores the workspace registry, app settings, plugin install state,
and the `initialized`/`welcome_seeded` meta flags. Each workspace DB stores:

- `pages` — canonical BlockNote JSON, derived plain text, revision, timestamps,
  soft-delete marker, tree position/parent;
- `page_links` — source/target page IDs for backlinks;
- `favorites`, `recent`, `tabs`, `workspace_settings`;
- `pages_fts` — FTS5 virtual table over title/text, maintained by triggers.

SQLite is opened with WAL, foreign keys, a 5-second busy timeout, and one
connection per database. Migrations use `PRAGMA user_version`. Daily backups use
`VACUUM INTO` in a background goroutine, keep seven days, and never block the
UI. WAL is checkpointed when the store closes.

## Save path

The renderer owns edit timing; the backend owns confirmation.

1. BlockNote `onChange` compares serialized JSON with the last observed value,
   updates live stats/outline, and calls `markDirty`.
2. The store increments a per-page edit version and debounces a save (700 ms).
3. `saveDocument` sends `docJSON` + the revision it believes it is replacing.
   Saves for one page are serialized.
4. The Go transaction validates size, analyzes text/page links/assets, checks
   the revision, updates the page, replaces backlinks, and updates FTS.
5. Only after the transaction commits does the renderer show **Saved**. If edits
   arrived while the request was in flight, the state remains **Unsaved
   changes** and another save is scheduled.
6. A stale expected revision returns `ERR_CONFLICT`; the UI preserves the note
   and shows an error rather than silently overwriting another writer.

The close hook cancels the first native close, emits `noteral:before-close`, and
waits up to 3.5 seconds for the renderer to save open documents and call
`FlushDone`. Tab close and workspace switch save before removing/switching. Tabs
and active page are persisted per workspace with a short debounce.

## Page links and search

Page links are a custom BlockNote inline content (`pageLink`, `{ pageId }`). The
chip resolves the current title from the store, so renames do not break links.
The backend scans document JSON for `pageLink` props and `noteral-page://` hrefs,
writes `page_links`, and returns backlinks by joining source pages.

Search uses FTS5 with title weighted above body and prefix terms. The palette
debounces a backend search and renders title/snippet hits; the Library modal
uses the same API. Search text is refreshed inside the save transaction.

## Assets

`uploadFile` (BlockNote) and the attachment picker call `SaveAsset`/`ImportAsset`.
Files are validated (size, extension/content type, image magic bytes), stored
under `assets/<yyyy>/<mm>/<random>-<name>`, and returned as a relative URL.
The document stores the relative URL. The renderer hydrates it to
`/__assets/<workspace>/...`; saves strip the prefix back out. Export copies
referenced assets beside the exported Markdown.

## Frontend state

The Zustand store holds:

- workspace list/current workspace, page metadata, favorites, recent;
- only **loaded** document bodies (open tabs), keyed by page ID;
- tab order and active page;
- per-document save state, revision, stats, and conflict error;
- UI settings (theme, panel widths/open state), outline, backlinks, live counts.

`EditorStack` mounts one `PageView` per open tab and hides inactive ones, which
preserves BlockNote undo history and caret state. Documents are loaded on demand;
startup never loads every page body. The status bar subscribes only to save
state/counts to avoid rerendering the editor on unrelated store changes.

## Plugins

The Go plugin manager handles installation, manifest validation, embedded
catalog copies, the GitHub-hosted community registry (`registry/community-plugins.json`
plus each plugin's latest GitHub Release), update checks, and settings. It never
executes plugin JavaScript.

The renderer creates one `<iframe sandbox="allow-scripts">` per enabled plugin.
The SDK and entry code are injected via `srcdoc` with a local-only CSP. The
iframe has an opaque origin: no same-origin access, Wails binding, filesystem,
Node, or host DOM. The host:

- validates `event.source`, protocol version, declared contributions, and
  permissions;
- routes every SDK call through `frontend/src/sdk-host` (`spec.ts` declares each
  method's schema, permission and tier; `handlers.ts` implements it; `host.ts`
  validates params and checks permissions);
- limits request/payload sizes and times out commands after 30 seconds;
- forwards only validated command/status/panel results into the UI;
- removes commands, status items, panels, event listeners, and the iframe when
  a plugin is disabled.

See [plugins/README.md](plugins/README.md) for the public contract and
[sdk/api-reference.md](sdk/api-reference.md) for every method.

## Assistant

`frontend/src/assistant` is an AI chat that drives the same SDK methods as
tools, filtered by mode (Ask = `read` tier, Edit = `+content`, Creator = `+app`).
`internal/ai` stores providers (keys `0600`, never sent to the UI), and streams
raw SSE lines from OpenAI-compatible, Anthropic and Gemini APIs as `ai:stream`
events; the renderer parses them and runs the tool loop. `internal/web` gives
key-free web search (DuckDuckGo → Wikipedia) and readable-Markdown fetch, and
blocks private addresses. See [assistant.md](assistant.md).

## Commands

One `commandRegistry` backs the titlebar menu, global shortcuts, command
palette, slash menu plugin entries, and plugin commands. Commands are
unregistered by prefix when a plugin is removed. The editor keeps its own
BlockNote formatting shortcuts; Noteral only intercepts global combinations and
avoids stealing `Ctrl/Cmd+B` while writing (it is bold, not the sidebar).

## Native window

The window is frameless on Linux/Windows, with custom minimize/maximize/close
buttons using `@wailsio/runtime`'s `Window` API. macOS uses
`MacTitleBarHiddenInset` to keep traffic lights and reserves a 44 px drag area.
CSS `--wails-draggable: drag` is applied only to the title bar; buttons/inputs
set `no-drag`. At narrow widths the inspector collapses first, then the sidebar;
the rail and document remain usable.

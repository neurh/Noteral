# Testing and verification

Verified on **2026-11-21** on Linux (Debian 13, X11, i3), Go 1.27.4,
Node 24.18.1/npm 12.0.2, GTK 3.24, WebKitGTK 4.1.

This document separates automated checks, a scripted native acceptance run, and
things that were **not** tested.

## Automated checks

```sh
# Go: data dir, BlockNote analysis/Markdown, store, assets, plugins
go test -tags gtk3 ./...

# React: command registry, snippet formatting, editor bridge
npm --prefix frontend test

# TypeScript + production renderer
cd frontend
./node_modules/.bin/tsc --noEmit
npm run build
cd ..

# Native Wails build (also rebuilds bindings + frontend)
wails3 build
```

Last results:

| Check | Result |
| --- | --- |
| `go test -tags gtk3 ./...` | **PASS** — `internal/assets`, `internal/blocknote`, `internal/datadir`, `internal/plugins`, `internal/store`; no test package for the thin service/UI |
| `npm --prefix frontend test` | **PASS** — 3 files, 7 tests |
| `tsc --noEmit` | **PASS** |
| `npm --prefix frontend run build` | **PASS** — 2,618 modules, renderer ~1.33 MB (~405 KB gzip) |
| `wails3 build` | **PASS** — `bin/noteral`, `-tags production,gtk3`, stripped Go binary ~22.8 MB |

The Go tests cover:

- data-root precedence and write-probe failure;
- first-launch seeding exactly once, tabs/meta, save/reopen, revision conflicts;
- FTS5 search, backlinks, favorites, recent, delete cleanup, workspace isolation,
  rename without revision bump, move cycle rejection;
- asset save/resolve/serve, encoded names, traversal/symlink rejection, bad image
  rejection, export copy;
- plugin manifest validation, catalog install, enable/disable runtime, settings
  merge, uninstall, zip path traversal rejection.

The frontend tests cover the command registry, FTS snippet markers/relative
time, and editor-bridge lifecycle. BlockNote itself is exercised by the native
acceptance run rather than unit mocks.

## Native acceptance run

Data directory: `/tmp/noteral-final` (removed before the run). Binary:
`./bin/noteral --data-dir /tmp/noteral-final`, window 1366×745.

1. **First launch** — created `noteral.db` in the data directory, `Default Workspace`, a seeded
   `Welcome to Noteral` page, and UI settings. `meta` contained
   `initialized=1`, `welcome_seeded=1`. Restarting did not duplicate the
   welcome page.
2. **Create/type** — `Ctrl+N` created a page while the editor had focus;
   renamed it **Alpha Project**; typed
   `Zebra launch notes for the final acceptance journey.` Status showed
   `Unsaved changes`, then `Saved`. SQLite confirmed revision 2 and the full
   text.
3. **Image** — pasted a PNG from the system clipboard. The backend wrote
   `assets/2026/11/<id>-image.png`; the document stored the **relative** path;
   the image rendered through `/__assets/ws_default/...`. A second image was
   pasted after deleting the first to verify delete/re-upload.
4. **Page link / backlinks** — created **Beta Page**, used the `/` menu →
   **Link to page**, selected Alpha. Document contains `pageLink` with Alpha's
   stable ID; `page_links` row was written; Alpha's inspector showed
   `LINKED FROM → Beta Page`. Clicking the chip navigated to Alpha. Keyboard
   selection in the picker was also verified: focus lands in the search field
   and Enter selects the first match.
5. **Workspace switching** — opened Workspaces from the avatar, created
   **Second Brain**, saw its seeded Untitled page. Returned to Default: the
   three tabs, active page, tree, image, and backlinks were restored. Page
   counts (`3 pages`, `1 page`) matched the databases.
6. **Search** — `Ctrl+K`, query `Zebra`, returned Alpha Project with the body
   snippet (FTS5, not just a title filter).
7. **Plugins** — installed **Reading Time** from the bundled catalog (at the time; the shipped catalog is now empty and these live in `examples/`, so install `examples/reading-time` as a zip to repeat this). It was
   auto-enabled, the status bar showed `10 words · 1 min read`, and the
   inspector panel showed the reading-time text. Toggling it off removed the
   status item and panel immediately and wrote `plugin_state.enabled=0`.
   Earlier runs also installed **Meeting Notes** and inserted its template from
   the command palette/slash menu, and tested disable → commands removed.
8. **Quit/reopen** — closed through the custom titlebar close button. The close
   hook saved dirty editors and the process exited. On restart, the last
   workspace opened, all three tabs were restored (Welcome active in this final
   repeat; Alpha active in the preceding run), the image and page link were
   intact, and the disabled plugin stayed disabled.
9. **Theme** — light/dark/system switching was exercised; the chosen setting
   persisted across restart.

The screenshot in the README (`docs/noteral-editor.png`) is from this run.

## Things that were not tested

- **macOS and Windows** builds, traffic lights, and installers. Only Linux was
  built/run. Packaging targets (`.deb`, `.AppImage`, `.app`, `.msi`) were not
  exercised.
- **Large seeded workspace** performance. The 1,000-page measurement mentioned
  as optional in the brief was not run, so no performance claim is made.
- **Native drag-and-drop gestures** for tree/tab reordering were not driven by
  the UI automation. The underlying `MovePage` and tab persistence paths are
  covered by tests and the tree/tab components are implemented, but the pointer
  gesture itself is a manual-test item.
- **Local plugin zip through the file dialog** was not clicked through in the
  UI; the install/zip validation path is covered by Go tests. The catalog
  install/enable/disable path was verified in the running app (Go tests now use
  a fixture catalog, since the shipped one is empty).
- **Remote catalog fetch** was not performed against a live URL. It is
  explicit-only, validates http(s), has a timeout/size limit, and is covered by
  code/tests rather than a network test.
- **Accessibility audit** with a screen reader was not performed. Controls have
  accessible names/tooltips/focus states; keyboard navigation was exercised for
  the palette, picker, menus, and tree rename.
- **GTK tooltips under the test X server** intermittently paint as black
  rectangles (native GTK, not app HTML). This is a test-environment artifact;
  it does not affect the app on a normal desktop, but it is why screenshots
  were taken with the pointer moved away.

## Repeating a smoke test

```sh
rm -rf /tmp/noteral-smoke
./bin/noteral --data-dir /tmp/noteral-smoke
# create a page, type, attach an image, link a second page, create a workspace,
# search, install/disable examples/reading-time (zip manifest.json + main.js),
# close, reopen with the same data dir.
```

For the database spot checks used during acceptance:

```sh
sqlite3 /tmp/noteral-smoke/noteral.db \
  'select id,name,last_opened_at from workspaces; select * from plugin_state;'

sqlite3 /tmp/noteral-smoke/workspaces/ws_default/workspace.db \
  "select title,revision,text_content from pages;
   select * from page_links;
   select value from workspace_settings where key='ui';"
```

If `sqlite3` is unavailable, the same queries work from Python's `sqlite3`
module (used during the recorded run).

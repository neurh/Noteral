Build **Noteral**, a fast, local-first personal knowledge desktop app using **Wails v3 + Go + React + TypeScript + BlockNote**. Aim for the editing quality of Notion and the responsiveness of a native notes app, but give Margin its own visual identity. It must work offline, require no account, and keep the user in control of their files.

Work directly in the repository. Inspect what exists, give a short implementation plan, then build and test the app. Do not stop at a design document, static mockup, or scaffold. Make reasonable product decisions without waiting for approval unless genuinely blocked.

## 1. Start with a working desktop slice

Use actual Wails **v3**, not v2, Electron, or a browser-only substitute. Check the current official v3 APIs, pin compatible dependency versions, and use generated Go-to-TypeScript bindings. Use Go for persistence, filesystem access, and native integration; React for the interface; and BlockNote as the real editor.

Get this flow working first: **launch → default workspace → write a note → quit → reopen → see the same note**. Build the rest around that working slice.

## 2. Build this exact workspace layout

- **Top bar:** A draggable desktop title bar with a left-sidebar toggle, a horizontal strip of open page tabs, a new-tab button, a right-sidebar toggle, and working minimize, maximize/restore, and close controls. Respect platform conventions, including macOS traffic lights. Tabs and buttons must not act as drag regions.
- **Far-left navigation rail:** A narrow, persistent icon rail for the workspace switcher, Library, Search, Plugins, and Settings. It stays visible when the left sidebar is collapsed.
- **Left sidebar:** A resizable panel with an **icon-only tab strip** for Page Tree, Favorites, and Recent Pages. Only the tab selectors are icon-only; page names remain visible. Support nested pages, inline rename, and drag-to-reorder.
- **Center:** The active BlockNote document. Page tabs support opening, switching, reordering, and closing. Restore open tabs and the active page per workspace.
- **Right sidebar:** An independently toggleable, resizable inspector with icon tabs for Outline, Backlinks, and Page Info. Clicking an outline entry jumps to its heading.

Give every icon-only control a tooltip, accessible name, keyboard focus state, and clear selected state. On narrow windows, collapse panels before squeezing the document into an unusable column.

## 3. Make the editor the best part

Use BlockNote’s supported APIs for headings, paragraphs, lists, checklists, quotes, code, tables, links, slash commands, inline formatting, and block dragging. Support pasted or dropped local images and attachments. Copy assets into the workspace rather than depending on their original paths.

Add internal page links using stable page IDs so renaming a page does not break links or backlinks. Provide workspace-wide full-text search and a `Cmd/Ctrl+K` palette for finding pages and running commands. Keyboard shortcuts must not interfere with normal text editing.

Autosave without interrupting typing or moving the caret. Show an unobtrusive **Saving / Saved / Error** indicator. Flush pending edits on tab close, workspace switch, and normal quit. Never report “Saved” before the backend confirms the write. Provide lossless JSON export and readable Markdown export.

## 4. Keep all app-owned data together

Default to a portable `Data/` directory beside the executable, or beside the `.app` bundle on macOS. Resolve it from the application location, not the current working directory. If it is unwritable, explain the problem and support an explicit `--data-dir` override; do not silently save notes somewhere else.

- On first launch, create **Default Workspace** and an editable **Welcome** page exactly once.
- Support creating, renaming, and switching workspaces. Reopen the last active workspace on launch.
- Keep workspace databases, attachments, settings, plugins, and backups under the single data root. Store asset references as relative paths. Copying this directory while the app is closed should be sufficient to move the library to another machine.
- Use SQLite with migrations and transactional saves. Store versioned BlockNote JSON as the canonical document format; derive plain text, search indexes, and backlinks from it. Do not maintain two competing sources of truth.
- Isolate workspace data. A delayed save from one workspace must never overwrite a page in another.
- Bundle fonts, icons, and editor assets locally. No telemetry, CDN dependency, or browser localStorage as the primary database.

## 5. Make extensibility real: SDK + community plugins

Create a **versioned TypeScript SDK** with documented APIs for workspaces, pages, blocks, assets, search, commands, tabs, panels, settings, and events. Keep Wails internals behind the SDK. Use the same command system for menus, shortcuts, the command palette, and plugin contributions rather than implementing each action several times.

Build a working **Plugin Manager** that can install a local plugin bundle, display its requested permissions, enable, disable, and uninstall it. Support a simple community catalog format; any remote registry access must be explicit and optional. Do not create a fake marketplace.

Define a plugin manifest with ID, version, SDK compatibility, entry point or declarative contributions, and permissions. Enforce permissions at the host boundary. Never load arbitrary community JavaScript directly into the privileged app renderer or give it raw Wails, filesystem, or shell access. Use isolated execution with validated messages, or a restricted declarative plugin format.

Ship two installable examples that use only the public SDK:
1. **Reading Time** — contributes a live word count and reading-time indicator.
2. **Meeting Notes** — contributes a slash command that inserts a structured meeting template.

Include a starter plugin and a short guide showing how to build, package, install, and debug it. Disabling a plugin must remove its commands, UI contributions, and listeners without restarting the app.

## 6. Visual and performance direction

Design a quiet writing environment: warm neutral surfaces, crisp typography, one restrained accent color, a comfortable reading width, and subtle dividers. Use shared design tokens and support light, dark, and system themes. Spend the visual effort on the editor, tab states, sidebar hierarchy, and command palette—not dashboard cards or decorative gradients.

Keep typing independent of sidebar rerenders. Load documents on demand, index search text on save, and avoid loading every page body at startup. Use a seeded large workspace to check search and navigation performance; report measurements only if actually tested.

## 7. Verify and hand off

Test migrations, save/reopen, workspace isolation, search, and plugin permissions. Test the tab and panel interactions. Run the available tests and a native build on the current host; distinguish verified results from anything requiring another OS.

**Final acceptance journey:** From an empty data directory, write a page in Default Workspace, attach an image, link to a second page, create another workspace, switch back, find the first page through search, install and disable an example plugin, then quit and reopen. The content, attachment, links, tabs, and workspace selection should survive, and the entire flow should work offline.

Finish with exact development, test, and native build commands; the data directory layout; SDK/plugin documentation; and an honest list of remaining limitations. Prefer a smaller working feature over a polished button that does nothing.

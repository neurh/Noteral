# Rehearsal: Workspaces dialog

Gold: the app's existing warm editorial surfaces — Settings, CoverPicker/IconPicker, and the rail/token system. Kept the serif display type, cream `--bg`/`--bg-raised` layers, restrained accent, 1px borders, compact control heights, and sentence-case copy. Changed the previous single-list workspace overlay into a current-workspace card, a switch list, and a footer create/rename flow.

States: default (current + two others), row hover, inline rename (hero and row), create form, zero workspaces, workspaces present but none active, dark theme, 390px mobile, and keyboard focus/escape paths.

Captured: exact CDP viewports 1100×800 and 390×844 at DPR2. Frames: `/tmp/stage-desktop.png`, `stage-create.png`, `stage-rename.png`, `stage-dark.png`, `stage-empty.png`, `stage-none.png`, `stage-hover.png`, `stage-mobile.png`, `stage-mobile-create.png`, `stage-mobile-dark.png`, `stage-mobile-empty.png`. Focus visuals were checked separately with Chromium focus emulation (`/tmp/stage-focus-create.png`); plain headless frames can show a stale focus ring.

Gate: not a filmed faux-UI demo, so the stageshow `film --gate` loop does not apply. Rehearsed instead as a real app screen: exact-width stills for every state plus scripted interaction checks (rename Enter/Escape/blur, create Escape, focus return, no API call on cancel).

Frames → findings → fixes:
- `/tmp/stage-desktop.png` — initial ring landed on the hero pencil and read as a stray outlined control. Modal now prefers a footer action over an arbitrary body button; ring lands on "New workspace".
- `/tmp/stage-rename.png` — hero rename field stretched the full card width. Capped at `min(100%, 300px)` with the serif face.
- `/tmp/stage-mobile.png` — footer CTA was small and left-aligned; the bare check badge read as an unexplained checkbox. CTA is full-width and the pill is hidden on mobile, where the "CURRENT WORKSPACE" heading already carries the state.
- `/tmp/stage-mobile-create.png` — three controls were crammed on one line and the input height was overridden by `.inline-input`. The form wraps to a full-width input plus a right-aligned Cancel/Create row; control heights align at 36px.
- `/tmp/stage-empty.png` — the old empty state was one dashed sentence. Replaced with a centered icon, short title, and one line of guidance. With zero workspaces the footer CTA becomes the primary action; `/tmp/stage-mobile-empty.png` checks the full-width mobile version.
- `/tmp/stage-none.png` — with workspaces present but none active, the old branch rendered "No workspaces yet" above the list. Now the empty state appears only at zero workspaces; otherwise the section reads "Open a workspace".
- `/tmp/stage-hover.png` — switching was only implied by the row. Hover/focus reveals "Open →"; mobile keeps an accent arrow visible.
- `/tmp/stage-dark.png` — hero gradient, borders, and muted text retain contrast in dark theme.

Interaction checks: rename Escape restores the old name and returns focus to the pencil; Enter commits and returns focus; blur commits without stealing focus from the clicked target. Create Escape closes the form, makes no API call, and returns focus to "New workspace". Failed create keeps the form open instead of closing on a swallowed error.

Review: a fresh-eye reviewer run was dispatched with the frames, live stage, and source, but the upstream model gateway returned 503 before it wrote a final list; no findings were returned. I re-reviewed every frame directly instead, which produced the empty-CTA hierarchy fix and the no-active-state copy/branch fix above. No unresolved visual findings remain in the reviewed frames.

Assumptions:
- Store actions already surface backend failures through the app's toast/status system; this dialog only closes after the active workspace actually changes.
- Duplicate workspace names are allowed by the backend; the dialog does not invent a uniqueness rule.
- Relative "last opened" labels use local time and refresh when the dialog opens.

Not checked:
- Real touch hardware, screen readers, IME composition during rename, and Windows WebView2 font/AA differences.
- Very long workspace names, 200% zoom, and reduced-motion behavior of the modal entrance.
- Concurrent rename while switching workspaces (no visual regression seen; not stress-tested).
- Workspace deletion is not part of this dialog and was not added or reviewed.

# Rehearsal: top bar and inset panels (app frame)

Gold: the app's own layers — `--bg-sunken` shell, `--bg` panels, 1px `--border`, `--radius-lg` 14px, the accent square + serif "N" already used by the splash brand, and the existing `icon-button`/`window-controls`. The window chrome was rebuilt around that: a transparent 46px top bar (brand + sidebar toggle left, 430px search centered, inspector toggle + window controls right) over three inset panels — left (rail + sidebar in one rounded panel), center, right — separated by an 8px `--panel-gap`, with the tab row moved into the top of the main panel above the page header.

States: page open, Home tab (no page header under the tabs), left sidebar closed (rail alone), both sidebars closed, dark theme, macOS traffic-light band, 1180/900/600 breakpoints, 390×844 mobile, handle hover, after a sidebar drag, Library overlay, command palette.

Captured: exact CDP viewports 1366×745 (the running app's real window size) and 390×844, DPR1 full frames plus DPR2 crops for edge judgement. Frames in `/tmp/noteral-stage/`: `01-app-1366.png`, `02-app-1366-home.png`, `03-app-1366-left-closed.png`, `04-app-1366-both-closed.png`, `05-app-1366-dark.png`, `06-app-1366-darwin.png`, `07-app-1180.png`, `08-app-900.png`, `09-app-390.png`, `10-detail-topbar-left.png`, `11-detail-rail-join.png`, `12-detail-main-top.png`, `13-detail-right-panel.png`, `14-detail-status.png`, `15-detail-left-bottom.png`, `20c/20d-handle-*-hover.png`, `21-after-restore.png`, `22-overlay-library.png`, `23-palette.png`, `24-final-1366.png`. Harness: `stage.vite.config.ts` + `stage.html` + `stage/` (mocked `AppService` binding), launched with `npx vite --config stage.vite.config.ts --port 9355`, shot with Playwright (`/tmp/stage-shots.mjs`, `/tmp/stage-interactions.mjs`, `/tmp/final-check.mjs`); the harness was removed after the pass.

Gate: not a filmed faux-UI demo, so the stageshow `film --gate` loop does not apply. Rehearsed as a real app screen: exact-size stills per state plus scripted interaction and geometry checks.

Frames → findings → fixes:
- Geometry dump (`.left-panel` 8…339, `.center-column` 347…1053, `.right-sidebar` 1062…1358, status 717…745, `scrollHeight == innerHeight`) confirmed the 8px gaps, 1px seams, 14px radii, and no page-level overflow; `--panel-gap` is the only spacing constant involved.
- Sidebar drags anchored on `window.innerWidth`/the rail width, so the first pointermove jumped the panel by the new inset + border (≈36px right, ≈3.5px left). Now the pointerdown records the measured panel rect and the drag adds the pointer delta: 272→320 for +48 travel (left) and 296→336 for −40 (right), exact and without a grab jump.
- `.resize-handle::after` was pinned at `left: 3px` of a 7px handle, which put the hover accent line 5px inside the new seam. The line now sits on the handle's inner edge (`right: 0` / `left: 0`), landing next to the panel border while keeping the full 7px grab area.
- The main tab row reuses `--panel-head-h` (44px) and the page-header tint, so the rail, sidebar and tab rows all align at the same height and the tab strip reads as the panel's own head rather than a leftover title bar.
- macOS: the old 32px reserved band (rail padding-top, sidebar-tab margins) is gone; the top bar now owns the traffic-light space via `padding-left: 78px`, which is where the native buttons are drawn. Verified only as layout, not against real AppKit.
- Narrow widths: brand name and the search kbd hide ≤860px, the search collapses to a 30px icon ≤520px, the inspector toggle hides ≤1180px exactly where the inspector itself hides, and the rail alone still reads as a panel when the sidebar is closed.

Interaction checks: Ctrl+B / Ctrl+Shift+B still hide both panels (they unmount, as before); the Library overlay and the command palette open above the inset panels with no z-order change; no console or page errors during the pass.

Assumptions:
- "move tabs section in top and under header bar" (m00001) reads as: the tabs stay the first row of the main panel, directly under the new top bar, with the page header below them (the pre-change order of tab row above page header is preserved). If the page header was meant to come first, it is a one-line swap in `App.tsx`.

Not checked:
- Real Wails frameless drag/resize behaviour of the top bar in the GTK window (the bar keeps `--wails-draggable: drag` with every control as `no-drag`; only exercised in the browser harness).
- Real macOS traffic lights, Windows WebView2 font/AA and window-control glyphs, and touch input on the drag handles.
- 200% zoom, IME, reduced-motion transitions.

Round 2 (same session): the rail now carries a divider at its right edge while the sidebar is open — it is the sidebar's own `border-left`, so it appears and disappears with the sidebar instead of leaving a stray line on the rail; and the outer/inter-panel spacing dropped from 8px to 6px (`--panel-gap`, a single knob for both the outer margin and the gaps). Re-rehearsed on the rebuilt stage: `railToSidebarGap 0`, `sidebarBorderLeft 1px rgb(228, 220, 208)` and `0px` once the sidebar is closed, panel edges 6 / 341 / 1059 / 1366, no page overflow, no console or page errors. Frames: `/tmp/noteral-stage/30-tweaks-1366.png`, `31-tweaks-left-closed.png`, `32-tweaks-390.png`, `33-detail-seam.png` (2×), `34-detail-corners.png` (2×).

# Rehearsal: split panes and pane tab bars

Gold: the app's own pane head — the old `.main-tabs` row (44px `--panel-head-h`, `color-mix(bg-raised 42%, bg)` tint, 1px bottom border) — plus the existing `.tab`, `.icon-button` and `.menu` idioms and the `.tree-row.drop-before/after` 2px accent caret. The tab row moved from one per window to one per pane without changing its shape, and the page header moved into each pane, resolving that pane's active tab (focused or not).

States: single pane, split right (2 panes), nested split (3), 4 panes, cross-pane tab move, edge drag with left/right/top/bottom drop hint, drag caret inside a bar, maximized pane (accent Minimize2), tabs menu open (only the pane's own tabs, portaled above the panes) with its top action row and per-item close on hover, a pane closed from that menu, per-pane page headers in focused and unfocused panes, bar actions pinned to each pane's right edge, 390×844 with 4 panes, unfocused-pane dim, splitter hover/drag, dark theme (not captured).

Captured: `/tmp/noteral-shots/` — `01-single-home.png`, `02-single-page.png`, `03-page-tabs.png`, `04-split-right.png`, `05-three-panes.png`, `06-drag-moved.png`, `07-drag-hint.png`, `07-drag-split.png`, `08-maximized.png`, `09-tabs-menu.png`, `10-narrow-390.png`, `11-close-pane.png`, `notes.txt`; exact viewports 1280×820 and 390×844, headless Chromium. Harness: server-mode build (`go build -tags server,production,gtk3 -buildvcs=false -o bin/noteral-server .`, `WAILS_SERVER_PORT=8123 --data-dir /tmp/noteral-rehearsal-data`, fresh data dir per run) with scripts `/tmp/pw2/shots.mjs`, `probe-menu.mjs`, `probe-narrow.mjs`, `probe-keys.mjs`, `probe-persist2.mjs`.

Gate: not a filmed faux-UI demo, so the stageshow `film --gate` loop does not apply. Rehearsed as a real app screen: exact-size stills per state plus scripted interaction and geometry checks.

Frames → findings → fixes:
- Bar actions were sitting immediately after the tabs instead of at the pane's right edge: the old `.main-tabs .tab-strip { flex: 1 1 auto; }` rule no longer matched once the strip moved inside `.pane-tabs`. Added `.pane-tabs .tab-strip { flex: 1 1 auto; min-width: 0; }`; measured `actions pinned right: [8,8,8,8]` — every cluster ends exactly at the bar's 8px padding.
- `09-tabs-menu.png` — round 1: the menu rendered in flow (base `.menu` is `position: static`; `.tab-bar-menu` had no positioning rule yet), so items truncated and the popover sat over the document. First fixed with a right-aligned absolute rule under the chevron. Round 2: opened from a left-edge pane it was clipped by `.center-column`'s `overflow: hidden` (and `.pane-tabs`' `container-type: inline-size` makes a stacking context the pane body can paint over). It is now `createPortal`-ed to `document.body` and positioned inline-fixed from the anchor rect — right-aligned when there is room, left-aligned otherwise, clamped to the window, `top = rect.bottom + 6` — and it lists only the clicked pane's own tabs (the `PANE n` group labels were removed along with their `.menu-label` rule; outside-click now ignores both the anchor and the portaled menu).
- `10-narrow-390.png` — at 4 panes in 390px the bar actions no longer fit. `@container pane-tabs` queries now fold Split down (≤260px), Split right (≤200px), Maximize/Restore (≤165px) and the `+` (≤120px). The first set of breakpoints (300/240/190/140) hid Split down already in a ~310px pane and the rehearsal caught it (the script's click timed out); refolded below the width where all four actions stop fitting (~165px). Probe at 390 with 4 panes: `actionOverflow: 0` in every pane, only the “Tabs in this pane” button remains, tab strips scroll (`tabsHidden > 0`).
- `07-drag-hint.png` — claimed by the mid-drag frame: the edge hint (half-pane accent tint + 2px accent edge) previews exactly where the new pane lands, while the dashed center ring is reserved for a plain move.
- `08-maximized.png` — maximize renders one pane filling the center column with an accent Minimize2; the tree survives, so restore returns the same four-pane layout.
- `04-split-right.png` — the new pane starts on a Home tab and takes focus, so it shows no header until a page is active there; each pane with a page renders its own header.
- `06-drag-moved.png` — with pages in two panes, two headers are visible at once (`headers=2 pagePanes=2`), and moving focus keeps the other pane's header (`focused=0 headers=2`); each header resolves its own pane's active page, so back/forward, title focus and the `···` menu follow the pane rather than the window.
- `09-tabs-menu.png` (round 3) — the menu opens with a top action row (split right, split down, Maximize/Restore while more than one pane, then a red Close pane) above the separator; each row reveals its close X on hover (`opacity: 1`), the menu only ever lists the clicked pane's tabs, and it is positioned inline-fixed so it stays inside the window from any pane. Closing a tab from the menu removes it from that pane (`2 -> 1`) and closes the menu; Close pane took a 4-pane layout to 3 without touching the pages themselves (`/tmp/noteral-shots/11-close-pane.png`).
- Splitter hit area is a 1px seam with a ±4px `::before`, so the drag target is 9px without changing the visual seam; hover/drag paints the seam in `--accent`.

Interaction checks: split right 1→2; split down 2→3; cross-pane drag moved `["Untitled"]` from pane 1 to pane 2; edge drag on the right edge 3→4; maximize 4 rendered→1; restore 1→4; tabs menu lists exactly the clicked pane's tabs (2 in the final run) with zero group labels, its action row reads `Split right,Split down,Maximize pane,Close pane`, hovering a row reveals its close X, Escape closes it, picking an entry closes it and activates that tab in the clicked pane, closing a tab from it removes that tab and closes the menu (`2 -> 1`), and Close pane collapses 4 panes to 3; every page pane shows its header whether focused or not (`headers=2 pagePanes=2`, then `focused=0 headers=2`); bar actions measured 8px from each pane's right edge; 390×844 with 4 panes stays inside each pane; keyboard Ctrl+\ 1→2, Ctrl+Shift+\ 2→3, Ctrl+\ 3→4 with the new Home pane focused; layout and maximize state survive reload (4 → maximize → reload 1 → restore 4 → reload 4, tab lists match); zero page/console errors. Unit coverage: `frontend/src/lib/panes.test.ts` (31 tests) for move/collapse/split/resize/normalize/restore/remove-pane, `internal/store` tests for the layout round-trip and invalid-JSON rejection.

Assumptions:
- Splitting creates a new pane with a fresh Home tab; a page lives in exactly one pane because the document store keeps one editor per page.
- Every pane with a page shows its own header; the header follows the pane's active page while back/forward history stays global (m00764).
- The tabs-menu action row and per-item close are the menu's only pane/tab commands; Close pane closes tabs, never pages, and a lone pane is reset to a fresh Home tab instead of disappearing.
- Maximize is a view state of the layout, not a structure change: the tree is kept, restore is exact, and the state persists like the rest of the layout. The toggle is only offered while the tree holds more than one pane.
- New tabs created from a pane's `+` (and Ctrl+T) open in the focused pane, matching the “tabs belong to a pane” model.

Not checked:
- The real Wails desktop window: drag feedback was only exercised in Chromium. WebKitGTK hides custom MIME types during `dragover`, so `frontend/src/lib/dragTab.ts` keeps the payload in module state and reads `text/plain` at drop; the desktop path was not hand-tested in this pass.
- Dark theme stills of the pane chrome and drop hints (they use `color-mix` tokens; one light-theme pass only).
- Touch drag, pointer-capture resizing on a touchscreen, IME, and screen-reader labels beyond the existing aria attributes.
- Dragging a pane's last tab while the neighbour is maximized; the store path is unit-tested, not rehearsed visually.

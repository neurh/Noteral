# Rehearsal: Favorites/Recent list rows

Gold: the Trash list rows — a flat row with a 14px page icon, a left-aligned title over a muted relative time, and the trailing action at the row's right edge (`frontend/src/components/TrashView.tsx`). Favorites and Recent are the same `.page-list-row`, but `frontend/src/components/PageList.tsx:25` puts the row body in a `<button className="page-list-main">` while Trash uses a `<div>`, and the button had no reset, so the UA chrome (2px outset border, `buttonface` background, centered text, `1px 6px` padding) boxed and centered every row.

States: recent (favorite and non-favorite rows, active row), hover on a row, favorites (2 rows), trash (reference), dark theme (recent + trash), 390 mobile.

Captured: exact 1366×745 DPR1 full frames, DPR2 row crops and a 390×844 frame in `/tmp/noteral-rows/before/` (broken) and `/tmp/noteral-rows/after/` (fixed): `01-recent-1366.png`, `02-recent-hover-1366.png`, `03-favorites-1366.png`, `04-trash-1366.png`, `05-recent-dark-1366.png`, `06-trash-dark-1366.png`, `07-mobile-390.png`, `08-favorites-detail.png`, `09-trash-detail.png`, `10-recent-zoom.png` (2× nearest crop of the recent list). Same server-mode harness as the earlier sidebar rehearsal (rebuilt `bin/noteral-server`, `WAILS_SERVER_PORT=8123`, `/tmp/noteral-rehearsal-data`), scripts `/tmp/pw2/rows-seed.mjs`, `rows-shots.mjs`, `rows-measure.mjs`, `rows-check.mjs`, `rows-restore.mjs`.

Gate: real app screen, not a faux-UI demo, so the stageshow `film --gate` loop does not apply. Rehearsed with exact-width stills plus scripted geometry and contrast checks, as in the earlier sections.

Frames → findings → fixes:
- `before/10-recent-zoom.png` — the rows rendered as boxed, centered buttons: computed on the live DOM, `border 2px outset`, `background rgb(239, 239, 239)`, `text-align center`, `padding 1px 6px`, against Trash's `0px none` / transparent / `left` / `0px`. Fix: `.page-list-main` reset (`frontend/src/styles.css:515`: `border: 0; background: transparent; padding: 0; text-align: left;`), the same property set the tree's `.tree-page` buttons already use (`frontend/src/styles.css:478`); `color: inherit` and `cursor: pointer` come from the global button rules (`frontend/src/styles.css:88,91`).
- `after/01-recent-1366.png`, `03-favorites-1366.png`, `08-favorites-detail.png` — rows now read as trash rows; measured geometry is identical across all three lists: row 259×39, icon x 6 (14px), title x 26 (dy 5, h 15), time x 26 (dy 21), trailing action right edge inset 2px.
- `after/02-recent-hover-1366.png` — hover highlights the row and brings its star to full strength, mirroring `.trash-action`.
- `after/05-recent-dark-1366.png`, `06-trash-dark-1366.png`, `07-mobile-390.png` — no fault; 390 keeps the sidebar in its rail.
- Contrast fix (reviewer finding): an always-visible star at the trash-action opacity (0.55 `--text-muted`) composites to 1.73:1 light / 2.17:1 dark, under the 3:1 WCAG 1.4.11 floor for UI components — and no opacity of `--text-muted` reaches 3:1 on the light active row (2.99 even at opacity 1). `.favorite-toggle` now uses `--text-soft` at `opacity: 0.7`, measured on the final frames at 3.06:1 (light active row, the worst case) / 3.25:1 (light base row) / 4.08:1 (dark active row) / 4.86:1 (dark base row); `.favorite-toggle.on` stays `--warning` at 4.07:1. `.trash-action` keeps its pre-existing 0.55 (1.78 light / 2.30 dark) — untouched, since Trash is the reference look.
- `.trash-row { padding-right: 2px; }` removed as redundant — `frontend/src/styles.css:511` now carries the 2px right inset for every `.page-list-row` (only consumers are `PageList.tsx` and `TrashView.tsx`). Re-shot frames were pixel-diffed against the previous run: identical everywhere except the trash row's relative-time text, which ticked from “3 minutes” to “4 minutes”.

Interaction checks: all four tabs switch; a star click toggles the page's favorite state (favorite rows 2 → 3 → 2, restored after the check); `:focus-visible` brings the star to full opacity; zero page/console errors. `npm run build` (tsc) clean; `npx vitest run` 8 files / 57 tests pass.

Assumptions:
- “Same list as Trash” means the row chrome and geometry, not that Favorites/Recent gain Trash's second action; the star stays the row's only action and remains clickable in both tabs.
- The idle star is slightly stronger than a trash action (0.7 `--text-soft` vs 0.55 `--text-muted`) because that is what keeps it at ≥3:1 on the active row; the amber `.on` state still carries the favorite signal.

Not checked:
- Real Wails/GTK rendering, screen readers, touch input, 200% zoom, RTL, longer titles.
- Contrast of `.trash-action` (pre-existing 0.55 `--text-muted`, under 3:1) — left as it was, since the user pointed at Trash as the target look.


# Rehearsal: pane tab icons

Gold: the page tree's per-page icon, reused at tab scale. Tabs now render the same `PageIcon` as the tree (`frontend/src/components/TabStrip.tsx`), sized 13px, muted by default and accent on the active tab of the focused pane; icon-less pages and child-less tabs keep the FileText fallback so the icon column never collapses, which keeps titles from shifting between tabs.

States: icon-less page (FileText fallback), lucide page icon, emoji page icon, home tab house, focused vs unfocused pane, pane tabs menu open, two tabs in one pane, dark theme, 390px.

Captured: the real server-mode app (`bin/noteral-server --data-dir /tmp/noteral-tabs-data`), exact 1366×745 at DPR1 plus a DPR2 strip crop, in `/tmp/noteral-tabs-real/`: `00-current.png` (before), `01-pane1-icon.png` (lucide via picker), `02-pane2-emoji.png` (emoji via picker), `03-menu-open.png` (tab menu rows), `04-dark.png`, `05-detail-tabs.png` (DPR2 crop of `x330 y38 w1036 h90`), `06-mobile-390.png`. The earlier harness pass (real TabStrip + real styles.css on a scratch page, seeded emoji/lucide/no-icon/long-title pages) produced `/tmp/noteral-tabs/01-desktop-light.png` … `08-detail-paneB.png`; the scratch page was deleted afterwards.

Gate: real app screen, so the stageshow `film --gate` loop does not apply. Rehearsed with exact-width stills plus scripted interaction checks: the icon picker was driven through the app (search icon → color popover → "Default ink"; emoji tab → "rocket"), and after each pick the tab, page header, page tree, and Home recents were compared in the same DOM.

Frames → findings → fixes:
- `01-pane1-icon.png` / `02-pane2-emoji.png` — the icon appears on the tab, header, tree, and Home recents in the same frame, so the store → tab wiring is live; no reload needed.
- `03-menu-open.png` — the pane tabs menu shows the same icon per row as the strip, so the two lists cannot disagree.
- `05-detail-tabs.png` — at 1:1 the 13px icons sit on the title baseline and the fallback keeps column width identical to a real icon; emoji render slightly larger than lucide glyphs at the same box, matching how the tree already behaves.
- `04-dark.png` (pixel-sampled: sidebar rgb 26,24,21 · canvas rgb 29,27,24) — muted and accent resolve correctly in dark; the emoji keeps its own colors on the dark surface.
- `06-mobile-390.png` — with three persisted panes at 390 the tabs shrink to the icon plus a sliver of title; the icon is the surviving affordance and no strip overflows.

Checks: `npx tsc --noEmit` clean; `npx vitest run` 8 files / 57 tests pass; no page errors in any frame.

Assumptions:
- The tab icon is presentational only (decorative `aria-hidden`), so accessibility does not depend on it; the title remains the accessible name.
- `pageById` is derived from the store's page list, which is already loaded for the tree; no extra fetch is introduced.

Not checked:
- Real touch hardware, screen readers, RTL locales, IME.
- 200% zoom, reduced motion, Windows WebView2 font/AA differences.
- Very many tabs in one pane beyond the six used in the harness pass.


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

# Rehearsal: rail page-tree button

Gold: the rail's own `rail-button` idiom — 36px hit, 19px lucide glyph at stroke 1.8, `--accent-soft` selected fill plus the 3px `--accent` left bar (styles.css:301-309) — and the sidebar's Page tree tab glyph (`ListTree`, LeftSidebarTabs.tsx). The button is the rail-sized copy of that tab, not a new control style, and follows the VS Code activity-bar model: closed → open on the tree, open on another tab → switch to tree, tree showing → hide. The topbar toggle and Ctrl+B remain plain sidebar toggles.

States: sidebar closed (unselected), click → open on tree (selected), sidebar open on Favorites → rail click switches to tree without closing, tree showing → click hides, Ctrl+B while closed, dark theme, hover, keyboard focus, 390×844 (button hidden), reload persistence.

Captured: exact viewports 1366×745 (the running app's real window size) and 390×844, DPR1 full frames plus DPR2 rail crops in `/tmp/noteral-rail/`: `01-closed-1366.png`, `01-closed-rail-detail.png`, `02-open-tree-1366.png`, `02-open-rail-detail.png`, `03-favorites-1366.png`, `04-tree-switch-1366.png`, `05-closed-again-1366.png`, `06-open-tree-dark-1366.png`, `07-hover-rail-detail.png`, `08-focus-rail-detail.png`, `09-mobile-390.png`, `10-mobile-390-topbar-open.png`, `mobile-verify.png`, `mobile-rail-detail.png`. Harness: server-mode build (`go build -tags server,production,gtk3 -buildvcs=false -o bin/noteral-server .`, `WAILS_SERVER_PORT=8123 ./bin/noteral-server --data-dir /tmp/noteral-rehearsal-data`) shot with `/tmp/pw2/probe-rail.mjs`, `verify-mobile.mjs`, `reload-rail.mjs`, `focus-debug.mjs`.

Gate: not a filmed faux-UI demo, so the stageshow `film --gate` loop does not apply. Rehearsed as a real app screen: exact-size stills per state plus scripted interaction and geometry checks.

Frames → findings → fixes:
- `09-mobile-390.png` (round 1) — the button tracked `settings.leftOpen`, but at ≤900 `.left-sidebar { display: none; }` (styles.css:1486-1488) left it a dead selected control. It is now hidden in the same media query (`.rail-tree-button { display: none; }`), matching how the inspector toggle hides exactly where the inspector hides. Re-shot at DPR2 (`mobile-verify.png`, `mobile-rail-detail.png`): `btnVisible false`, five visible rail buttons, no layout gap — the rail is a flex column, so the next button keeps the first slot.
- `02-open-rail-detail.png` — the first item carries the same selected treatment as every other rail button (accent-soft fill, 3px left bar measured `3px rgb(177, 83, 61)`); no new token was needed.
- `01-closed-1366.png` — with the sidebar closed the rail is 56px and the added button leaves no gap (`leftPanelWidth 58` = 56 rail + 2px seam, same as before the change).
- No other frame faults; the dark frame (`06-open-tree-dark-1366.png`) stays legible on `--accent-soft`.

Interaction checks: closed → click opens 272px on tab "Page tree" with 3 rows, `title` flips to "Hide page tree", aria-pressed true and selected; Favorites → click keeps the sidebar open (272) and switches to the tree; tree → click hides it (left panel 58); Ctrl+B opens on tree and reads selected, a second click closes. Reload: open+tree persists and closed persists (`leftOpen` goes through `updateSettings`/`scheduleSettings`; `leftTab` is state-only). At 390 the click changes state but nothing visible happens and the control is hidden. Zero page/console errors. `npx tsc --noEmit` clean; `npm test` 8 files / 57 tests pass (including `frontend/src/components/Rail.test.ts`: open from any tab, switch from favorites/recent/trash, hide on tree).

Review: a fresh-eye reviewer returned no blocking findings (static review only — it did not run the app or the suite). Its non-blocking list, and the responses:
1. `frontend/src/components/Rail.tsx:43-49` — the accessible name flipped between "Show/Hide page tree" while `aria-pressed` also changed, so a voice command no longer resolves after activating (APG recommends a fixed name). Fixed: the name is now the constant "Page tree"; only `title` flips, `aria-pressed` still carries the state, and the name matches the sibling rail buttons' constant labels. Re-verified: name "Page tree" in every state.
2. `frontend/src/components/Rail.tsx:26-36` — the three-branch decision had no test. Fixed: extracted the pure `nextTreeAction(leftOpen, leftTab)` in `frontend/src/components/Rail.tsx` (used by `toggleTree`) with `frontend/src/components/Rail.test.ts` covering open/switch/hide.
3. `frontend/src/components/Rail.tsx:43-49` duplicates the "Page tree" label and `ListTree` glyph from `frontend/src/components/LeftSidebarTabs.tsx:4-9`. Accepted: one string plus one glyph is cheaper than coupling the two components; the rehearsal checks the two against each other visually.
4. Pre-existing and adjacent: at ≤900px `frontend/src/components/TopBar.tsx:25-32` can still set `leftOpen: true` while `styles.css:1487` hides the sidebar (a pressed control with nothing visible). Not introduced by this diff; the new button specifically does not join it (hidden at the same breakpoint). Recorded, not changed.
The reviewer also verified clean: no stale closures, correct persistence split (`updateSettings` persists `leftOpen`, `setLeftTab` is session-only), `onResize`/Ctrl+B/topbar only touch `leftOpen`, no focus-ring suppression, `display:none` leaves no flex gap, and overlay backdrops keep the rail unclickable behind modals.

Assumptions:
- The button means the page tree, not the sidebar in general, so while open on another tab it switches to the tree instead of closing, and only the tree state closes it.
- `leftTab` is not persisted (`setLeftTab` only sets state), so the rail forces "tree" whenever it opens the sidebar; Ctrl+B keeps reopening on the last tab.
- Hiding the button ≤900px is correct because the sidebar itself cannot show there; the state-level control (`leftOpen`) stays reachable through the topbar toggle and Ctrl+B, which keep their pre-existing mobile behavior.

Not checked:
- Real Wails/GTK hover and AA rendering; Chromium only.
- Screen readers and IME — aria-label/aria-pressed were set and read back from the DOM only.
- Focus-ring pixels: the button inherits the global `button:focus-visible` rule (styles.css:89); headless programmatic focus did not paint it, so it was not judged as a still.
- 390–900px and 520–900px intermediate widths (same media query, expected identical) and touch input.

# Rehearsal: sidebar without the workspace row

Gold: unchanged — the same warm sidebar should now read tabs → section header → list on every tab, with the PAGES header carrying the role the workspace card used to have. New page keeps its entry points (the tree header's own `+` at `frontend/src/components/PageTree.tsx:317`, the Home tab's New page button, and the palette's "New page"); workspaces keep the rail's bottom Workspaces button and the dialog it opens.

States: tree (with rows), favorites (empty), recent, trash, page created from the tree header, workspaces overlay opened from the rail, dark theme, 390 mobile.

Captured: exact viewports 1366×745 and 390×844, DPR1 full frames plus a DPR2 sidebar-top crop in `/tmp/noteral-sidebar/`: `01-tree-1366.png`, `02-favorites-1366.png`, `03-recent-1366.png`, `04-trash-1366.png`, `05-workspaces-overlay.png`, `06-tree-dark-1366.png`, `07-sidebar-top-detail.png`, `08-mobile-390.png`. Same server-mode harness (rebuilt `bin/noteral-server`, `WAILS_SERVER_PORT=8123`, `/tmp/noteral-rehearsal-data`), script `/tmp/pw2/probe-sidebar-top.mjs`.

Gate: not a filmed faux-UI demo, so the stageshow `film --gate` loop does not apply. Rehearsed as a real app screen: exact-size stills per state plus scripted interaction and geometry checks.

Frames → findings → fixes:
- `07-sidebar-top-detail.png` — the tabs row now meets the PAGES header directly, with no leftover slot from the removed row (its `padding: 8px 8px 4px` went with `.workspace-switcher`); the header keeps its own inset and the list rows stay aligned with earlier frames (`contentTop 94` in the tree).
- `01-tree-1366.png` — the `4` at the tab row's right edge is the pre-existing `.left-tab-count` page counter, not the removed workspace avatar (the sidebar DOM now reports `switcher: 0, avatar: 0`).
- `02-favorites-1366.png`, `04-trash-1366.png` — empty states start directly under the tabs with their own padding; no orphan gap or missing separator.
- `05-workspaces-overlay.png` — Workspaces stays reachable: the rail's bottom Layers button opens the dialog (`.workspaces-body` present) and Escape closes it.
- `06-tree-dark-1366.png` — headers and rows keep their dark-theme contrast; nothing had depended on the removed card (the rail focus ring in the frame is probe focus, not styling).
- No other frame faults; 390 keeps the sidebar hidden as before.

Interaction checks: all four tabs switch; the tree header `+` still creates a page (rows 3 → 4 and the count badge updates); the rail Workspaces button opens the overlay and Escape closes it; zero page/console errors. `npx tsc --noEmit` clean (removed the now-unused `ChevronDown`, `Plus`, `workspace`, `createPage`, `setOverlay`); `npm test` 8 files / 57 tests pass. Deleted dead CSS: `.workspace-switcher`, `.workspace-button` and its hover/descendant rules, the base `.workspace-name`, and `.workspace-button` from the shared transition list; `.workspace-avatar` stays because WorkspaceDialog uses it.

Review: a fresh-eye reviewer returned no blocking findings (static review; it did not run the app or tests). Its non-blocking list, and the responses:
1. Favorites/Recent might start tight under the tab strip because `.page-list { padding: 3px 6px 18px }` lost the gap the switcher supplied. Checked at 1:1 and 2× (`/tmp/noteral-sidebar/10-recent-zoom.png`, `09-favorites-top-detail.png`): the first list row sits ~9px below the tab strip and the empty state carries its own ~26px inset, so the rhythm reads intentional — no change.
2. The removal drops the in-sidebar "New page" `+` from favorites/recent/trash, leaving only the palette/Ctrl+N there. Accepted: the user asked for that `+` to go; the tree's PAGES `+`, the palette's "New page" (`App.tsx:59-66`), Ctrl/⌘N (`App.tsx:310-313`) and the Home button cover page creation.
The reviewer also confirmed clean: no leftover references to the removed classes, no dead imports/selectors, workspaces still reachable (rail button + palette "Switch workspace" `App.tsx:177-184`), `.left-tab-count` is the page counter, a11y intact, and no double padding or scroll regression.

Assumptions:
- "remove this section" means the whole workspace row, which rendered on every tab, not only on the tree tab; it is gone everywhere.
- The removed `+` was a second New page entry point; the tree's PAGES `+`, the Home button and the palette still cover it.
- Workspace switching now lives only on the rail's Workspaces button (plus the dialog); no other tab has a workspace affordance, by design.

Not checked:
- Whether some other surface should show the current workspace name from within the sidebar.
- Real Wails/GTK rendering, screen readers (the removed buttons took their aria labels with them), and touch input.
- 880–900px widths and 200% zoom.

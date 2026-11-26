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

## Databases, folders and the "+" menu

Stills in `/tmp/noteral-db-shots` (server-mode build, 1366×820, 390×844 and dark).

- **New menu**: the header "+", the empty-tree "Create a page" button and the row "+" all open Page / Folder / Database. The row "+" on a database adds a row directly. New folders open in rename mode inside the tree.
- **Table**: the gutter (check box and drag handle) hangs outside the text column, so names line up with the title. The footer only shows calculations on hover until one is set. The selection bar floats over the header row.
- **Board / Calendar / Gallery / List**: each view keeps its own filters, sorts, calculations and hidden properties. The calendar compacts at narrow container widths: smaller day numbers and no per-day "+".
- **Inline block**: `/database` creates a child database and embeds it. `/linked database` embeds an existing one. The `.bn-block-content[data-content-type=database]` element is forced to `display:block; width:100%`, because `.db` is an inline-size container and otherwise collapses to 0 width.
- **Popover focus bug (fixed)**: popovers start at `left:0; top:0; opacity:0` instead of `visibility:hidden` or -9999px. Editors focus with `preventScroll`, and popovers re-place themselves on scroll instead of closing. Before this fix, clicking a partly visible cell scrolled the table, which closed the cell editor and lost the typed value.
- **Functional probe** (`/tmp/pw2/dbfunc.mjs`): passed drag card to Done, add a Number property, type values, Sum calculation, sort by date, select and delete a row, then reload. Values persisted, with no page errors.

# Rehearsal: page editor pass

Gold: the page reads like one document. The title wraps like a heading and always outranks body headings. The keyboard moves between title and body, and finding text never needs the browser. Everything uses the existing warm tokens (`--bg-sunken`, `--border`, `--accent`, `--font-reading`, `--font-mono`). Nothing new was invented.

States: welcome page, typed rich content (H1–H3, inline code, code block), slash menu open and filtered, selection toolbar, Ctrl+K on a selection, find bar (find, next, replace, replace all, undo), long title, inline page link, new page (Ctrl+N), dark, 390.

Captured: real server-mode build (`bin/noteral-server`, fresh `--data-dir`), 1366×745 and 390×844 at DPR1. Before frames are in `/tmp/noteral-ed/before/` (script `/tmp/ed-base.mjs`). After frames are in `/tmp/noteral-ed/after/`: `02-typed`, `03-slash`, `04-slash-filter`, `05-toolbar`, `07-longtitle`, `08-dark`, `09-390`, `09b-390-find`, `10-find`, `11-replace`, `12-link`, `13-inline-link`, `14-dark-code`. The scripted checks are in `/tmp/ed-after.mjs`, `/tmp/ed-link.mjs` and `/tmp/ed-save.mjs`.

Gate: this is a real app screen, not a filmed faux-UI demo, so `film --gate` does not apply. It was rehearsed as exact-size stills plus scripted interaction checks.

Frames → findings → fixes:
- Before `07-longtitle`/`09-390`: the title was a single-line `<input>` and long titles were cut off with an ellipsis. It is now an auto-growing `<textarea>`. Newlines are stripped and whitespace collapses on commit. After: 3 lines, 137px at 1366 and 5 lines at 390.
- Pressing Enter in the title used to drop focus on `<body>`. Now Enter, Tab, and ArrowDown at the end of the title put the caret at the start of the first block. If that block has no text (a database or an image), a paragraph is inserted above it first. ArrowUp on the first line of the body climbs back into the title. Escape reverts the title.
- Heading scale: before, body H1 was larger than the 40px title and H2 rendered at weight 700. Now H1 is 30px, H2 24px and H3 19.5px, all at weight 600. The weight is set on the `h*` tags themselves because BlockNote's long selector sets 700.
- Code block: before it was a black `#161616` slab with 24px padding. Now it uses `--bg-sunken`, a `--border` hairline and 14×16 padding, in both themes (`14-dark-code`). Inline code uses mono and `--accent-deep`, and loses its chip style inside code blocks.
- Ctrl+K on a selection opened the command palette on top of BlockNote's link popover. The app now ignores Ctrl+K when the editor has already handled it (`defaultPrevented`).
- Page link chip: it showed two icons (FileText plus a CSS `↗`) and had a UA button border. It sat on its own baseline, which made its line about 57px tall. It now shows the target page's own icon, falling back to the kind icon. It has no border, aligns to the text baseline (a two-line paragraph is 63px) and truncates long titles.
- Slash menu: plugin commands now use a puzzle icon, and Linked database uses a link icon instead of repeating the table icon. Filtering ranks results: exact title, then title prefix, then word start, then alias, then substring (`lib/slashMenu.ts`, tested). With no query the menu keeps its groups.
- Formatting toolbar: added inline code after strike, and moved the link button next to the text styles.
- Find in page (new, `FindBar.tsx` + `lib/findInDoc.ts`, tested): Ctrl+F opens it, Ctrl+H opens it with the Replace row, and selected text seeds the query. Enter and Shift+Enter step through matches, with a count ("2 of 2"). Match case is a toggle. Replace and Replace all (Ctrl+Enter) each apply as one transaction, so one undo restores them. Matches are painted with the CSS Custom Highlight API, which adds no document marks and no dirty state. Escape closes the bar and selects the current match.
- Clicking the empty area below the last block now continues writing there. It reuses a trailing empty paragraph or appends one. This runs on mousedown so focus never lands on `<body>`.
- Outline jump (`scrollToBlock`) used to query `[data-id]` across the whole document, so it could hit the same page open in another pane. It is now scoped to this editor's DOM and places the caret in the block.
- New page (Ctrl+N): the caret used to land in the body, so the name got typed as body text. A blank "Untitled" page now focuses and selects its title (`13-inline-link`: the title is "Reading list").
- Store bug: re-selecting the page that is already in front (a self-link, its own sidebar row) cleared the outline and word count to 0 until the next tab switch (`08-dark` first pass). `selectPage` now resets these only when the page actually changes.
- Placeholders are shorter: "Type '/' for commands", and an empty document shows "Start writing, or type '/' for commands".
- `10-find`: the find field had a doubled focus ring from the global `input:focus-visible` rule. Fixed.

Checks: `npx tsc --noEmit` clean. `npx vitest run` passes: 12 files, 84 tests, including the new `findInDoc` (6) and `slashMenu` (3) tests. `npm run build` OK. `/tmp/ed-after.mjs` checks: title Enter goes to the body, ArrowUp at the top goes to the title, ArrowDown goes back to the body. Clicking below the content adds a block (14 → 15) and keeps editor focus. Typed headings measure 30/24/19.5px. Ctrl+K on a selection does not open the palette. Find counts are correct; Replace all changes the document and undo restores it. No horizontal scroll at 390. Autosave and reload keep an inline page link plus the text after it (`/tmp/ed-save.mjs`). The only console error is the existing 404 favicon/resource.

Assumptions:
- Ctrl+H is free in the desktop app (WebKitGTK has no history shortcut), so it opens Replace, as in code editors.
- No code-language selector: BlockNote's `supportedLanguages` throws for unknown languages in stored documents, and syntax highlighting would need a new dependency.
- Ctrl+F is global when a page is active, including from sidebar fields, because the shell has no native find.

Not checked:
- Real Wails/WebKitGTK rendering of `::highlight()`. If the Highlight API is missing, find still counts, steps and replaces, but it does not paint the matches.
- IME composition in the title beyond the `isComposing` guard. Screen readers. Touch.
- The same page open in two panes: the editor bridge still keeps one handle per page id, which is pre-existing behaviour.

# Rehearsal: Block marquee selection and the six-dots menu

Gold: Notion's block selection. Dragging from empty space draws a box, every block the box touches turns into a whole-block selection with a tinted highlight, and the six-dots handle opens a menu that acts on that selection. Implementation: `frontend/src/lib/blockSelection.ts` (a ProseMirror selection over a run of sibling blocks, plus the highlight and key plugin), `frontend/src/lib/blockActions.ts` (delete, duplicate, move, turn into, color, and the BlockNote extension), `frontend/src/components/useBlockMarquee.ts` (the box), and `frontend/src/components/BlockHandleMenu.tsx` (the menu).

States: marquee mid-drag (light), selection after release, handle menu on 4 selected blocks, menu on one unselected paragraph, Turn into submenu, Color submenu, dark theme drag and menu, 390 mobile drag.

Captured in `/tmp/pwm/`: `01-dragging.png`, `02-selected.png`, `03-menu-multi.png`, `04-turn-into.png`, `05-color.png`, `12-after-menu.png`, `20-dark-drag.png`, `21-dark-menu.png`, `20-m390-drag.png`, `21-m390-menu.png`, `30-dark-sel.png`. Server-mode harness: `CGO_ENABLED=0 go build -tags server` into `bin/noteral-server`, `WAILS_SERVER_PORT=8123`, `NOTERAL_DATA_DIR=/tmp/noteral-marquee-data`. Scripts are `/tmp/pwm/marquee.mjs`, `actions2.mjs`, `move.mjs`, `dnd2.mjs` and `themes.mjs`.

Gate: real app screen, so the stageshow `film --gate` loop does not apply. Rehearsed with exact-width stills plus scripted interaction checks.

Frames → findings → fixes:
- A box that stays in the left gutter selects nothing. The box hit-tests each block's text box, not its row, so it selects only the blocks it touches. For text blocks the vertical bounds come from the first line box, so a box that grazes a heading's top padding does not pick the heading.
- `01-dragging`: the heading highlight covered its 20px top padding, so the band sat above the text. The highlight now starts lower on H1, H2 and H3.
- `21-dark-menu`: a 14% accent tint was too faint on the dark page. A `--block-selected` token now sets 14% for light and 22% for dark.
- The menu's heading shows the block type, or "N blocks". Delete says "Delete N blocks". Move up is disabled on the first block. Turn into is offered only when every target holds text. Text and Background color show the current value checked.
- Hovering a block used to highlight it: BlockNote mounts the handle menu as soon as the handle shows, so the select-on-open effect ran on hover. It now lives in a child of the dropdown (`SelectWhileOpen`), which exists only while the menu is open. Checked: hovering 3 blocks and the handle selects 0, opening the menu selects 1.
- Opening the menu on a block outside the selection selects that block, so it's always clear what the menu acts on. Opening it on a block inside a selection keeps the whole selection. Closing it puts focus back in the editor, so Delete, Ctrl+D and the arrow keys still work.

Checks: on the welcome page, scripted in the real app.
- Marquee: right-margin drag selected 2 bullets. Drag started in text still made a text selection. A drag from below the last block selected it. Clicking below added a paragraph. A margin click put the caret in the row.
- Keys and menu: Ctrl+D duplicated and kept the copies selected, Delete and then Ctrl+Z restored them, and Ctrl+Shift+↑/↓ and the menu's Move up/down moved the block. Shift+↑/↓ grew and shrank the selection, and a plain ↓ collapsed it to one block. Escape cleared it, and typing a character over the selection did nothing. Turn into → Check List converted 2 blocks at once.
- Handle drag: dragging the handle of a 2-block selection moved both blocks.
- `blockSelection.test.ts` (4 tests) covers sibling runs, mixed depths lifting to a shared level, and move + reselect.

Not checked: autoscroll while dragging past the scroller edge. The scripted check started on a page that fits without scrolling, so `scrollTop` stayed 0. Also unchecked: touch, WebKitGTK rendering, and nested blocks inside tables or columns.

Follow-up (databases, Shift+Arrow):
- The marquee missed database blocks: React node views wrap `.bn-block-content` in a `.react-renderer` div, so the `:scope > .bn-block > .bn-block-content` lookup skipped them. It now accepts both shapes. Checked: a box across the middle of an inline database selects it and highlights the whole embed (`/tmp/pwm/53-db-sel.png`).
- Shift+↑/↓ from a caret: within a multi-line block the text selection extends line by line as before. At the block's top or bottom line it becomes a block selection of that block plus the neighbour, and further presses grow or shrink it. A text selection spanning two blocks becomes a selection of those blocks. Checked in `/tmp/pwm/shift.mjs`, including growing over a database (`60-shift-up.png`).

# Rehearsal: Home redesign (views, options menu, backgrounds)

Gold: a Home tab that reads as part of Noteral (paper tokens, Newsreader display, Inter UI), with eight views, a two-level options menu (root → View / Background panels with back + close), a widget-based Custom view, and animated ASCII backgrounds that never cost the editor its frame rate.

Harness: server-mode build (`CGO_ENABLED=0 go build -tags server,production -o bin/noteral-server .`), `NOTERAL_DATA_DIR=/tmp/noteral-rehearsal-data WAILS_SERVER_PORT=8123`, workspace seeded with 18 pages (emoji icons, colour/gradient/image covers, 4 favourites). Playwright chromium-1148, 1366×860 and 390×844, light and dark.

States filmed: Desk, Focus, Dashboard, Gallery, Timeline, Index, Launchpad, Custom (editing); menu root, View panel, Background panel (ASCII hover preview); Rain, Tide, Aurora (dark), Ripples at 390.

Findings → fixes
- Background thumbnails and gallery/continue covers rendered 0px wide. Chromium's UA sheet gives `<button>` `align-items: flex-start`, so block children of column-flex buttons shrink to content. → `align-items: stretch` on `.home-pick-card`, `.home-card`, `.hw-continue-card`.
- Dashboard was three cramped columns inside a 715px pane at a 1366 window: breakpoints keyed to the viewport, not the pane. → `.home-scroll` is a size container (`container: home / inline-size`); layout breakpoints are `@container home`. Header/menu rules stay on `@media`.
- Activity heatmap cells grew to 40px squares in wide cards. → week count fitted to card width with a ResizeObserver (~15px cells, 6–52 weeks).
- Quick actions truncated ("Sea… Ctrl K") in half-width cards. → widget is an inline-size container; kbd hint hides under 330px.
- Custom view stacked every M widget full-width below 900px. → M stays half-width until 640px.
- Eyebrow wrapped leaving a dangling "•" at 390. → eyebrow stacks without the dot under 640px.

Checks
- ASCII cost (headless, software raster, 1366×860): main-thread ~180–210 ms/s, script 48–88 ms/s at the 20 fps cap, no long tasks; paper baseline ~1 ms/s. Engine already pauses off-screen / hidden tab / inactive Home tab, honours reduced motion (still frame), batches ≤3 fillText per row, and steps down to 12 fps then larger cells if frames exceed 14 ms.
- Keyboard reorder in Custom (ArrowLeft on grip) persists across reload.
- `tsc --noEmit`, vitest 92/92, `go test ./internal/...` (store) pass.

Not checked
- Real WebKitGTK desktop window (GPU path) — only headless Chromium.
- Pointer-drag reorder filmed as a loop; only keyboard reorder was driven.

## Round 2: Custom view editor and ASCII wallpapers

Gold: Custom is a real editor, not a toggle. A docked Customize inspector (Page · Add · Widget) beside the live canvas. Twenty-one widgets on a 12-column grid. Spans and heights are free, every widget has its own settings, and there's undo/redo. The ASCII scenes read as illustrated wallpapers (peaks, sunset, aurora, city, galaxy, deep sea, code rain, sakura, dunes, silk), not as noise fields.

Harness: same server build and data dir as above. Scripts live in `/tmp/rh/`: `custom.mjs` films Page/Widget/Add/view stills at 1366 (inspector open and closed) and 390, light and dark. `interact.mjs` drives the presets, resize drag, undo, keyboard move and add. `ascii*.mjs` measures fps per scene, `exp.mjs` bisects the CSS, and `trace.mjs` records a CDP trace.

Findings → fixes
- The inspector rendered as a floating sheet over the canvas at 1366. The `@container homeshell` rule was trying to style its own container, and a container query can't do that. → added an inner `.home-custom-frame`: row when docked, column (bottom sheet, 54%) under 760px.
- Planner preset left holes at the editing width (about 700px). The clock and countdown kept 4/12 while their neighbours went to 6/12. → under 900px, every span from 2 to 5 becomes 6 and every span from 7 to 11 becomes 12, with no type exceptions.
- At 390, a half-width clock sat orphaned beside nothing. → under 640px, every slot takes the full row.
- The widget search showed a double focus ring (field ring plus input ring). → the input drops its own ring.
- The root menu's Background thumbnail was blank for ASCII scenes. → it now shows a still `AsciiCanvas` (5px cells, not playing).
- Empty-state copy said "panel on the right", which is wrong for the bottom sheet. → "in the Widget panel".

Checks
- All six still passes: 7–9 slots, no horizontal overflow, no console errors.
- Presets apply the expected span sets (Balanced, Minimal, Planner, Writer, Command center).
- Resize drag 4→2 then Ctrl+Z → 4. ArrowRight moves the focused slot. Adding "Countdown" from search inserts it after the selection and switches to the Widget tab.
- ASCII engine, headless Node, 1016×731 at 8×16 cells: 0.08–0.9 ms/frame. 14–224 cells change per frame out of 5842 (code rain is the most).
- In-app fps (headless, software GL): 59–61 on 7 scenes, 31–39 on Sakura, Dunes and Silk. A CDP trace puts the cost in `VizCompositorThread` (1200 ms per 1.5 s, against 470 for Aurora). `CrRendererMain` used 2 ms and the worker used 89 ms. The UI thread is never blocked. Bisecting points at the gallery cards' covers over the moving canvas, which is software compositing only.
- `tsc --noEmit` and vitest pass.

Not checked
- Compositor cost with a GPU / WebKitGTK. The Sakura/Dunes/Silk slowdown is expected to vanish there, but that hasn't been measured.
- Touch drag for the grip and resize handles.

### Home round 3 — free-form custom views, new widgets, interactive wallpapers

- Real app screen (no faux UI): `bin/noteral-server` on 8123 with `/tmp/noteral-rehearsal-data`, Playwright at 1366×860 and 390×844, light + dark (`/tmp/rh/free.mjs`).
- Scripted checks: View panel lists built-ins + "Your views n/16" + New view; dbl-click opens the editor; bottom-handle resize of a full-width card pushes only cards beneath it; body-drag moves a card with a drop ghost on the 24-col lattice; two Ctrl+Z restore the exact boxes; adding Buttons places it in the first free spot; no horizontal overflow and no console errors at either width.
- Under 600px canvas width the layout stacks in reading order and the inspector becomes a bottom sheet; gestures are off there (keyboard + inspector steppers still work).
- Wallpapers: isolated esbuild harness `/tmp/rh/bg/` (main-thread engine, scrim), stills wide / hover+ripple / 390 in `montage-all.png`; compute per frame ≤ ~2ms at 1366×860 normal density (ridges 2.08ms while hovered with a ripple).
- Known soft spots: Cross stitch and Signal read faint on low-contrast panels; Fireflies glow is small; Moon shading is slightly stripy at normal density.

### Home round 4 — fewer wallpapers, per-view backgrounds, default view

- Wallpapers trimmed to one "ASCII wallpapers" group: Full moon, Ocean sunset, Spiral galaxy, Code rain, Dunes, Topography. Removed scenes map to the closest survivor (TS `LEGACY_BACKGROUNDS`, Go `legacyHomeBackgrounds`).
- Tuner is a 3-column grid (label · control · value); segmented controls fill the control column so every row lines up at 1366 and 390 (`/tmp/rh/r4/*-tune.png`).
- Edit mode: the wallpaper ignores the cursor and dims to 70%, so dragging widgets doesn't trigger ripples behind them (`calm` prop on HomeBackdrop).
- Backgrounds live in workspace `homePrefs.backgrounds[viewKey]` (template id or custom view id); switching view switches background. Old per-tab backgrounds migrate once.
- View panel has "New Home tabs open [select]" + Default badge; Ctrl+T / + opens the chosen view. "New Home tab" / "Open a copy" removed from the menu.
- Scripted: `/tmp/rh/bgmenu.mjs`, `/tmp/rh/calm.mjs` — no console errors, no horizontal overflow.

## Plugin store (`PluginManager.tsx`) and permission review

Gold: the existing modal language: `.modal` header with the reading-font title, `--bg-raised` body, `--bg-sunken` footer, `.primary-button` for the one committing action. The store reuses it; the only new visual elements are the risk badges (`--danger` / `--warning` / neutral, the same tones the assistant's approval card uses) and the switch already used in Settings.

States: Installed (empty, then one community plugin), Bundled (two catalog plugins), Community (five registry entries, one already installed showing `v1.4.0 installed`), review of a high-risk plugin (`network` + `editor.write`), review → install → Installed. Light and dark, 1366×860 and 390×844.

Harness: server mode (`CGO_ENABLED=0 go build -tags server,production -o bin/noteral-server .`, `WAILS_SERVER_PORT=8125`, `NOTERAL_DATA_DIR=/tmp/noteral-pl-data`) with a local GitHub mock (`/tmp/pl-rh/gh.mjs` on :9912 serving `registry.json`, `releases/latest` and `releases/latest/download/{manifest.json,main.js}`), pointed at by the new `NOTERAL_GITHUB_BASE` / `NOTERAL_GITHUB_API` env overrides (`internal/plugins/plugins.go` `New`), and the registry URL set via `localStorage["noteral.pluginRegistryUrl"]`. Stills and geometry come from `/tmp/pl-rh/shots.mjs <scheme> <W> <H> [--setup]`: modal rect, page h-scroll, overflowing descendants, console errors.

Gate: a real app screen, so the `film --gate` loop does not apply (as above). Exact-width stills plus scripted geometry: zero console errors, no h-scroll, no overflowing elements in any state.

Frames → findings → fixes:
- The modal height jumped between tabs (654 → 723 → 740 px) and the tab bar moved under the cursor. Fix: `.modal.plugin-store { width: min(100%, 700px); height: min(86vh, 760px); }`, with the body `flex: 1; min-height: 0`. All states now measure 700×740 (366×726 at 390).
- At 560 px the community cards truncated the repo (`ada/noteral-focus-ti`) to make room for tags. Fix: the wider modal, plus the tags now shrink and ellipsize first (`.plugin-tags { flex: 0 1 auto }`, `.plugin-repo-link { flex: 0 0 auto; max-width: 70% }`).
- The review meta read `v1.4.0 · by Ada Okafor · GitHub · ada/noteral-focus-timer · 1.4.0`, repeating the version. It now reads `v1.4.0 · by … · github.com/<repo>`, and the tag is shown only when it differs from the manifest version.
- The risk badge column (56 px) left a gap before the permission title. It is now 46 px.
- At 390 the "Release page" button squeezed the meta into a broken `github.com/lin-` line. Fix: `.plugin-review-head` stacks at ≤620 px and the meta wraps anywhere.
- Found while staging: `styles.css` was allowed up to 512 KB by Go (`maxStylesBytes`), but the runtime refused anything over 64 KB at load time, so the plugin would install and then fail to start. The runtime limit (`MAX_STYLE_BYTES`, `frontend/src/plugins/runtime.ts`) now matches Go at 512 KB.

Not covered: the update flow with added permissions (`new` tags) and the runtime-failure row are covered by Go tests (`community_test.go`) and the code path, but weren't filmed. "Install from file" opens the native picker, which server mode can't drive.

## Round 4: full custom pages and transparent views

I checked this with a mock Creator turn (`/tmp/ai-rh/board.mjs`). The turn registers a `board` page type with `layout: "full"`, a custom block and an HTML status widget, then calls `nodes.create`. Results at 1366 and 390:

- The item opens in `.custom-node-pane` with no title, cover or icon, and the frame fills the pane (1016×693 at 1366).
- No outer element scrolls. The only scroll area is the view's own `main`.
- Inside each frame, `html` and `body` compute to `rgba(0, 0, 0, 0)`, so the status widget blends into the bar.
- `noteral.surface` is `page` / `status` and `noteral.fill` is `true` for the full page.
- Fault fixed: the status bar showed "0 words · 1 blocks" for custom items, folders and databases. Stats now show only for documents.

## Round 5 — assistant: batch rows, edit tools, model list, files, compaction (2026-11-25)

Mock: OpenAI-compatible server on :9911 (8 models), app server on :8124. Driver samples the reply every 120 ms while a "reading list with 20 books" run streams in Edit mode, at 1366 and 390.

- **Timeline flicker** — 0 open/close flips across 32 samples at both widths. The timeline stays open while the run is live, the label switches to "Writing" when the answer starts, and it folds to "Worked for 4s · 4 steps" once the run ends. Before this fix, answer text hid the steps and they came back on the next tool call.
- **Batch rows** — the model made one `databases.addRows` call with 20 rows, not 20 calls. The timeline shows "Added rows · 20 rows".
- **Token use** — loading tools on demand sends 29 tool schemas (~18 KB) in Edit mode instead of 98 (~50 KB). Older tool results are cut to 1,200 characters in history.
- **Files** — chips for image + text in the composer (image chip shows a 16 px thumbnail, or an icon if the image won't decode). The sent message shows a 36 px thumbnail. A model without vision gets a warning chip and a note in the request instead of the image bytes.
- **Compaction** — `/compact` adds a "Compacted N messages" divider that expands to show the summary. The context ring drops from 8% to 5%.
- **Model list** — after Load models: alphabetical list with a filter (shown when there are more than 6), the selected model scrolled to the centre, badges for window, vision and thinking (a dashed badge means the window is an estimate), and a pencil that opens options inline. Files and Thinking now sit on their own rows, so the level buttons don't wrap into ragged lines at 390.
- **Behaviour** — the auto-compact slider (50–95%, default 80) plus an on/off switch; "Load tools on demand" checkbox.
- No page errors, no horizontal overflow in the panel at 390.

## Round 6 — databases: header, view settings, filters, formula, chart, custom, row peek, AI embed (2026-11-25)

Real app (production server build, :8124, data /tmp/noteral-r6) with a "Q4 planning" page holding an inline Projects database of 12 rows and 7 properties. Drivers: /tmp/ai-rh/r6/db.mjs and custom.mjs at 1366 and 390, ai.mjs against the mock provider on :9911. Screenshots were checked at 1:1.

- **Header** — the tabs and actions sit on one row at both widths: the tab tops are at 172/173 px and the action tops at 177 px. At 390 the extra views fold into "+1" and the active tab truncates instead of running under the actions. Before this fix "1 more" overlapped the Filter icon.
- **View settings** — the root page shows Layout, Properties, Filter, Sort, Group, the filter-bar switch, duplicate and delete. The Layout grid is now 4 columns. Before, there were 5, which left one orphan tile. "Open pages in" is a 2×2 grid with the glyph beside the label, replacing four squeezed tiles whose "Center peek" label wrapped. The Group page has hide empty, collapse/expand all, and per-group eye toggles.
- **Editor block selection (bug fixed)** — clicking a tab or opening settings inside an inline database selected the whole BlockNote node, which greyed out the database. `lib/blockSelection.ts` now hands mousedown inside `.db-block` / `[data-editor-isolated]` back to the embed. After clicks there are 0 selected nodes.
- **Filter bar** — 6 chips plus Clear scroll on one 26 px line: scrollWidth is 718 against clientWidth 597 at 1366, and 189 at 390. Nothing wraps or pushes the page wider.
- **Advanced filter** — the popover fits inside the viewport at both widths and states that it is combined with the simple chips.
- **Chart** — a stacked bar of Budget by Team and Status. Whole-currency totals now show "$131,000" instead of "$131,000.00". The header wraps cleanly at 390.
- **Row peek** — center peek (default) is 960×757, side peek docks on the right, and both are full-screen at 390. Prev/next, switch-mode and full-page buttons are present.
- **Formula** — highlighted source, live "Returns text", and a 5-row preview. A deliberate typo shows the error under the editor with the token highlighted, and Save is disabled. The reference section heading reads "Reference" instead of a second "Properties". The error no longer repeats the token twice.
- **Custom view** — the starter list renders in the transparent frame on the database surface. A row with no icon no longer gets a 📄 placeholder. The code editor modal shows the bridge reference.
- **AI embed** — the mock run calls `databases.embed` in Edit mode, the database block appears in the page, and its marker survives a markdown round-trip.
- No page errors and no horizontal overflow in any step.

Not checked: stageshow `film.mjs --gate`. It only films `.ss-stage` / `.ss-fit` stages ("no visible stages in .page-pane"), so it can't film app screens. Also not checked: calendar and board with 100+ rows, and RTL.

## Round 7 — databases: one Database block, multi-source tabs, formula editor + Ask AI, chart zoom, number display (2026-11-26)
Real app (production server :8124, data /tmp/noteral-r6, mock provider :9911). Drivers in /tmp/ai-rh/r7: settings.mjs, multi.mjs, chart.mjs, zoom.mjs, fx.mjs, cells.mjs, rating.mjs. Run at 1366 and 390, light and dark where colour matters, and checked at 1:1.

- **View settings**: the root shows the icon button + name, then Layout, Source, Properties, Filter, Sort, Group, the display switches (wrap, row numbers, page icons, load limit, filter bar), Open pages in, Duplicate and Delete. Layout is now only the layout grid, and charts get a "Chart options ›" page. Scrolling with the wheel outside the popover leaves the page in place (scrollTop 165 → 165 → 165). The icon button opens the existing icon picker, whose subtitle now says what a view icon is for.
- **One Database slash item**: "Add a database" offers New database or an existing one. Each existing one is labelled "in <parent>", because two "Projects" looked identical. Picking an existing database creates a table view owned by the block.
- **Multi-source (bug fixed)**: "+ → From another source" did nothing for a database the block didn't show yet, because `schemas` only held the block's current sources. DatabaseView now reads any database's schema from the store (`schemaOf`). After the fix the new tab is added and a following "+ Board" uses that source (board columns Not started 4 / In progress 5 / Done 3). Settings → Source moves a tab.
- **Tabs**: dragging reorders them in the row ([Table, Board] → [Board, Table]) and in the "+N" menu at 390 ([Table, Budget…] → [Budget…, Table]). The menu ends with "Add a view". The right-click menu has Change icon.
- **Block selection**: clicks in the margin of a database block no longer show the blue node overlay.
- **Chart**: the toolbar shows Zoom in / Zoom out / Zoom to a range / Expand, plus Reset when zoomed. Ctrl+wheel zooms the bars and a plain wheel scrolls the page. Dragging pans without opening rows. Expand opens a large dialog that Esc closes. The Chart options page has Chart type, Data, Style, then collapsible Colors, Labels & numbers, Axes, Legend & tooltip, Goal line, Zoom and Empty state.
- **Formula editor (2 bugs fixed)**:
  - Fast typing garbled the source. Enter and Tab restored the caret in a rAF, so keys typed in between landed at the old caret. The caret is now restored in a layout effect.
  - At 390 the body overflowed by 52 px and clipped the left edge, because the grid used `1fr` instead of `minmax(0,1fr)`. That is fixed too.
  - Checked: line numbers, comments, the "Unknown function roundd. Did you mean round?" hint with line and column, styled and link output in the preview, and the reference panel with clickable examples.
  - Ask AI against the mock: the card with the formula and note appears, Apply swaps it in and the preview shows "7 days" etc., and the error card shows when there is no provider.
- **Table cells**:
  - Double-clicking a resize handle fits the column (Status 190 → 108 px with pills intact).
  - The checkbox is a filled accent tile with a tick in light and dark.
  - Show as Bar / Ring / Rating / Heat all work.
- **Bar and rating fixes**:
  - Bars on currency all looked full against the default max of 100. Choosing Bar/Ring/Heat now starts "fills at" from the column's largest value rounded up (30000).
  - The bar track can shrink to 16 px, so `$12,000.00` no longer truncates in a narrow column.
  - Rating on a percent column filled 0.6 of one star. It now maps 100% to all the stars.
- No page errors in any run. Not checked: box-zoom on scatter and heatmap charts, and stageshow `--gate` (it can't film app screens).

## Round 8 — layout options, header selection, lock, formula modal

Driven with Playwright against the server build (`/tmp/ai-rh/r8/flow.mjs <width> [dark]`, `head.mjs`, `fxshot.mjs`) at 1366 light and 390 dark.

- **Layout page**: the layout grid comes first, then that layout's options: Wrap cell content, Row numbers, Show page icons, Load limit, Show filter bar and Open pages in. Back from Open pages in returns to Layout. The main settings page keeps the name and icon, the Layout/Source/Properties/Filter/Sort/Group pages, Lock database, and Duplicate/Delete.
- **Header selection bug**: a click on a header cell selected 118 characters of the whole block, because the browser's text selection spread across the embed. The database block is now `user-select: none`, while inputs inside it stay selectable. Measured after the fix: click, double-click and drag on a header all select 0 characters.
- **Lock**: the switch has a hint. When locked:
  - The **New** button is replaced by a "Locked" lock button that unlocks.
  - New row, drag handles, row checkboxes and card actions are hidden.
  - A formula cell click opens nothing, but property menu → Edit formula still opens the editor.
  - Writes are refused in `useDatabase`, shown as an info notice at most every 2.5 s, and refused in the SDK row handlers.
  - Property conversion still rewrites values, via `force`.
  - Cells no longer show a focus ring or hover tint.
- **Formula cell**: a click shows a popover with the row title, the property, the row's result (or its error) and Edit formula. The editor then previews that row (driver: clicked "Accessibility audit", the preview showed "Accessibility audit", MATCH).
- **Formula modal**:
  - Order: code first, then status, then a Preview card, then Ask AI as a composer at the bottom.
  - The Preview card has a row switcher (‹ › plus a picker with search that lists each row's result), the big result and the values of the properties the formula reads, and a footer with "Works for all N rows" or "K rows have errors" plus a Show link.
  - At 390 the switcher hides its count. No page errors.

## Round 9 — formula editor: autosave, undo/redo, docs under the code, Functions / Ask AI tabs (2026-11-26)
- Saves as you type (450 ms after the last change; an invalid formula keeps the last working one). There is no Save/Cancel footer, and the toolbar shows Saved / Saving… / Not saved.
- Undo/redo uses its own history (lib/editHistory.ts), because a controlled textarea loses the browser's stack. Quick typing merges into one step; completions, inserts and AI applies are separate steps.
- The preview shows only the result of the chosen row. The function reference sits under the code (caret or hover), and its examples are checked by formulaDocs.test.ts.
- The side panel has two tabs, Functions and Ask AI (a chat-like feed and composer).
- Completions open while typing or on Ctrl+Space, not when the caret is placed in a name, so that function's reference shows instead.
- Checked with /tmp/ai-rh/r9/fx9.mjs at 1366 and 390 dark: no footer, no input rows, both tabs present, autosave Saving…→Saved, error keeps the last good formula, undo/redo via keys and button, the value persists after closing, no page errors.

# Rehearsal: popups, AI split button, tab menu, status bar layout

Gold: the existing `.menu` popup (tree/page menus) for the shared popup menu (`HostPopups.tsx`, `lib/popups.ts`); the existing `.topbar-search` field for the AI split button inside it (`TopBar.tsx`).

States: AI split menu, Rewrite submenu, tab right-click menu, status bar right-click menu, tree multi-select bulk menu and row menu; light 1366×745 and dark 390×844. A test plugin (`com.test.popups`, server data dir only) drove the SDK end to end: an HTML status widget calling `noteral.menu` (with a submenu) and `noteral.modal`, and `pages.stats` from plugin code.

Harness: server mode (`CGO_ENABLED=0 go build -tags server,production -o bin/noteral-server .`, `WAILS_SERVER_PORT=8131`, data in `/tmp/nrh-data`), Playwright scripts `/tmp/nrh/shots.mjs` and `/tmp/nrh/plug.mjs`, frames in `/tmp/nrh/`.

Gate: a real app screen, so the `film --gate` loop does not apply. Rehearsed with exact-width stills plus scripted interaction checks.

Frames → findings → fixes:
- `dark-390-03-ai-submenu.png`: at 390 the Rewrite submenu could fit on neither side and covered its parent item. Fix: `placePopup` drops a submenu below its item, indented 24px, when neither side fits (`lib/popups.ts`, with a test).
- `dark-390-04-tab-menu.png`: items without icons ("Close others", "Close all") sat left of the items with icons. Fix: when any item in a panel has an icon, the others keep an empty 14px icon slot.
- `light-1366-02/03`, `05`, `06`: no faults. The menus stay inside the window, there is no horizontal scroll, and the status bar shows words · blocks on the left and Saved at the far right, with no Local-first badge and no separators.
- Plugin checks: the widget menu opened above the 22px status bar (190×105 at 129,613). Choosing More → Beta resolved `"b"`. The modal opened from the menu, and `noteral.close(42)` closed it and returned `42` to the widget. `pages.stats` returned words=11, chars=51 for the open page. There were zero console errors.

Checks: `tsc --noEmit` clean; vitest 38 files / 887 tests pass; `npm run build` OK; SDK rebuilt (163 plugin methods).

Not checked: the real Wails/GTK window, the popover method (`ui.popover`) with a real plugin, the page-background dialog and the ASCII backdrop (built by a sub-agent and type/test checked, not filmed), the database fixes in the browser (unit tests only), screen readers, and touch.

## Round 10 — rail, plugin store redesign, block handle, editor blocks, SDK 2.1 (2026-11-26)

**Rail (`Rail.tsx`).** The top holds only the page tree, now drawn with the `FileText` document icon. Search (top bar, Ctrl/⌘ K) and Library (Settings, command palette) left the rail. Plugins moved to the bottom group, above Settings and Workspaces.

**Plugin store (`PluginManager.tsx`, `.ps-*` in `styles.css`).** This is a two-pane store, replacing the tabs. A 208px nav on the left lists Installed (count), Updates (badge), Discover, Bundled and Created, with Install from file, Build a plugin and the App/SDK versions at the foot. The right pane has a header (title, blurb, search or "Check now", close), filter chips (All, On, Off, Needs attention) and rows with a glyph tile, version, update pill, source/author/risk and a switch. Clicking a row opens a detail page: switch, Update, Open settings, Repository, Uninstall, the inline options, "What it adds", "What it can access" and the details. Discover is a card grid. The review screen shares the detail head and has a sticky foot. Install, review, approve, toggle and uninstall logic did not change. The old doubled focus ring on the filter is gone. At ≤720px the nav turns into scrolling tabs and the grid becomes one column. Filmed with `ps-shots.mjs` (GitHub stand-in, three installs) in light and dark at 1366 and in light at 390. The modal measured 940×704 at 1366 and 366×760 at 390, with no horizontal overflow and no console errors.

**Six-dot handle (`BlockHandleMenu.tsx`).** BlockNote nudges the side menu by fixed offsets tuned to its own heading CSS. Our heading padding left the H2 handle 11px low and the code-block handle 17px high, and the database block got no offset at all. The `alignToFirstLine` middleware now centres the handle on the block's first line of text (`.bn-inline-content` outside tables), or on `[data-handle-anchor]`, `.db-inline-title` or `tr` for databases and tables. `keepInView` still keeps it on screen for tall blocks. Handle middle minus first-line middle, measured per type: paragraph 1, h1 0, h2 1, h3 0, bullet 1, to-do 0, quote 1, code 2, inline database 0, callout 0 (px).

**Editor.** A new **Callout** block (`CalloutBlock.tsx`): its icon button opens a 16-emoji grid and the ten database tones, and its icon centres on the first line. It is in the slash menu (Basic blocks), in Turn into, and exported to Markdown as `> icon text`. The slash menu is grouped Basic blocks → Insert → Media → More headings (`arrangeSlashItems`), with token-styled tiles. Toggles, tables, dividers, quotes (accent left rule) and to-dos (accent checkbox, muted when checked) now use the reading tokens. Enter at the end of a callout makes a paragraph. Shot in light and dark at 1366 and in light at 390; no overflow.

**SDK 2.1.0.** New: command shortcuts (`shortcut` in the manifest or `addCommand`; reserved, taken and bare-letter combos are refused), `editor.getBlock`, `moveBlocks`, `insertText`, `formatText`, `select` and `focus`, and the `selection:changed` and `layout:changed` events. Exercised live with a probe plugin through the GitHub stand-in: `Mod+Alt+L` from the manifest ran the command; `moveBlocks` kept the block id and changed `prevId`; `formatText` produced `<strong>` plus red text colour; `insertText` landed at the cursor; `commands.register` with `Mod+K` was rejected ("is used by Noteral"). Both events fired, debounced. The hub was exported, validated and tested (21/21), and `hub:check` reports it up to date.

Checks: `tsc --noEmit` clean; vitest 39 files / 892 tests; Go `internal/plugins` and `internal/blocknote` tests pass; `build-sdk --check` OK (169 plugin methods, 10 events).

Not checked: the real Wails/GTK window, macOS ⌘ shortcuts (only Ctrl was pressed), screen readers and touch.

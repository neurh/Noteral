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

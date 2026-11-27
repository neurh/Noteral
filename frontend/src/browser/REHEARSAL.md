# Browser and web clips — rehearsal notes

## Round 1 — in-app browser, Reader, clip (2026-11-27)

Real app screens, so `film --gate` does not apply; rehearsed with scripted
Playwright runs against the server build (`bin/noteral-server`, fresh copy of
the README data dir each run) at 1366 and 390, light and dark.

Script steps: open Browser from the rail (Ctrl+Shift+O at 390) → start page →
web search → type an address (suggestions) → Wikipedia loads → bookmark →
Reader → Clip menu → Clip article → More menu → new browser tab (filled start
page) → open the clip.

Checks (all four runs): 10–12 results from DuckDuckGo, page shown in the frame,
tab titled "Note-taking", notice "Saved to Web clips", clip page starts with
"Clipped from en.wikipedia.org on …". Only console error is Wikipedia's
Report-Only `frame-ancestors` warning, which does not block the frame.

Fixed after the first stills:
- Start-page search showed a second focus ring on the inner input (global
  `input:focus-visible` shadow) — cleared for the start search and address bar.
- Rail showed two active bars (page tree + browser). Browser now uses a quieter
  `current` tint; the bar stays with the sidebar panel.
- Titles kept the site suffix ("Note-taking - Wikipedia"). `tidyTitle` drops a
  trailing site name only when it names the host.
- Wiki "[edit]" section links cluttered Reader and clips. `tidyArticle` removes them.

Notes (superseded by round 2):
- Round 1 sent sites that refuse framing to Reader and drew its own search
  results list. Both are gone.

## Round 2 — real pages, search engines

Feedback: searching showed a custom results layout; the browser should behave
like a normal one (home, real pages, working links, Reader as an option) with a
default search engine that can be changed in Settings.

What changed:
- Pages load through `/__browse?url=…` (internal/web/frame.go): fetched by the
  guarded web client, frame-blocking headers dropped, a bridge script
  (frame_bridge.js) reports address/title and hands link clicks, GET forms and
  script navigations back to the app. Served with a CSP sandbox without
  `allow-same-origin`, so pages never reach the app. Google and Bing allow
  framing and load directly.
- Searches open the engine's own results page. Engines: DuckDuckGo (default,
  HTML results), Google, Bing, Brave, Startpage, Wikipedia, or a custom `%s`
  address — Settings > Browser, also reachable from "Change" on the home page.
- Home button and a configurable home page (Noteral home or any address).
- Result redirect links (DuckDuckGo `/l/?uddg=`, Google `/url?q=`) go straight
  to the result (`unwrapRedirect`); they rendered blank otherwise.
- Narrow panes (< 520px) put the address bar on its own row.
- Settings: the custom address field shows only after picking Custom (it was
  always there and took the modal's first focus).

Scripted run (`/tmp/nrh/br2.mjs`, server build, light/dark × 1366/390), each:
home → search "note taking" (10 DuckDuckGo results in the page) → click the
Wikipedia result (address follows, Back enabled) → type an address → click a
link inside the article (address follows) → Back → Reader → Clip Article
("Saved to Web clips") → Home → Change engine to Wikipedia → search again
(lands on the article). No console errors in any run.

Known limits:
- Sites behind bot checks (Startpage's "Verifying", Brave rate limits) may
  not load through the app; Open in system browser is in the More menu.
- Inside directly framed sites (Google, Bing) the address bar can't follow
  clicks; results still open.
- Sign-in and upload forms (POST with password/file) open in the system
  browser — the proxy is GET-only and keeps no logins.

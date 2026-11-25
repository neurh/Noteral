# Assistant panel — rehearsal

This is a real app screen, not a staged demo, so the `film.mjs --gate` loop doesn't apply. I rehearsed it against the real server-mode build with real states:

- `bin/noteral-server` (`CGO_ENABLED=0 go build -tags server,production`), `NOTERAL_DATA_DIR=/tmp/noteral-ai-data WAILS_SERVER_PORT=8124`
- An OpenAI-compatible mock model on `:9911` (`/tmp/ai-rh/mock.mjs`). It streams real SSE chunks: text deltas, `tool_calls` split across chunks, and `usage`. It drives three scripted turns: read the page (two tool calls, then a Markdown summary), move to the trash (a confirm-gated tool), and a web search (the real DuckDuckGo-backed `web.search` tool).
- Playwright stills `/tmp/ai-rh/shots.mjs <light|dark> <W> <H> [--setup]` at 1366×860 and 390×844, light and dark: `01-open` (provider picker), `05-empty-chat`, `06-streaming`, `07-reply`, `08-tool-open`, `09-approval`, `10-declined`, `11-web`, `12-model-menu`, `13-history`. Each run also logs geometry and console errors (zero errors in all four runs; no horizontal scroll at 390).

## Faults found and fixed

- **The agent loop stopped after the first tool call.** Go `ai.Manager.run` called its own `cancel()` before it checked `ctx.Err()`, so every normal finish was reported as `cancelled`. The check now runs before `cancel()`, and `TestStreamOpenAI` asserts `!done.Cancelled`.
- **The tab crashed (OOM) while a reply streamed in.** `renderInline` reused one global `/g` regex while recursing into `**…**`. The inner call reset `lastIndex`, so a partial `**spring launch*` looped forever. Each call now gets its own regex. `lib/markdownInline.test.ts` renders every prefix of a mixed-markup string.
- **"Choose a provider and model first" right after connecting.** A provider saved without a model, or a stored setting with an empty model, never got a model filled in. `saveProvider` and `init` now pick the provider's default model.
- A stray red focus ring showed on the composer textarea and the model filter (the global `textarea:focus-visible` rule). The composer now shows focus as a border plus `--shadow-sm` instead of a mode-colored glow.
- "Working…" showed under an approval card. It is now hidden while a tool awaits approval. The approval title drops the trailing period from the spec summary.
- Failed and declined tools read "Failed · …" / "Declined · …" with the plain method summary instead of a past-tense verb that suggested success.
- The model name in the footer truncated at about 100px. The picker now takes the free row space, and the provider label shrinks first.

## Judgement

- Framing: the panel lives in the right sidebar, 400px by default and resizable from 320 to 640. At ≤1180px it becomes a fixed drawer, and at ≤520px it goes full-screen with a close button.
- Hierarchy: the user's turns are soft bubbles on the right. The assistant's turns are plain Markdown at reading size. Tool calls are quiet one-line rows that expand to show args and results. The approval card is the only tinted surface in the stream (it uses danger for confirm-gated methods).
- Modes are a three-segment control in the composer. Ask is neutral, Edit uses `--accent`, and Creator uses `--warning`. There are no sparkles and no purple, and every color comes from the existing `styles.css` tokens.

## Not covered

- Real Anthropic and Gemini endpoints. Their wire formats are covered by `assistant/protocol.test.ts`.
- Very long chats (hundreds of messages). The list isn't virtualized.

## Round 2: composer, mentions, thinking, context

I rehearsed this with `/tmp/ai-rh/shots2.mjs` against the same server build and mock model. Two scripted turns were added: a reasoning turn (`reasoning_content` chunks plus a long one-line bash block) and a `ui.ask` turn (a question card with two options). I ran it in light at 1366×860, dark at 1366×860 and light at 390×844, and every run finished with no page errors.

What I checked:
- `@` menu: the open page comes first ("Open page"), then the other open tabs. Enter turns it into a chip. Backspace on an empty input removes the last chip. A sent message shows its chips above the bubble.
- `/` menu: commands are grouped (Actions, Mode, Prompts) and filtered as you type. `/tr` + Enter fills the translate template.
- Dragging a tree row onto the chat shows the "Drop to mention" overlay and adds a chip (`pg_welcome`). This was a synthetic DragEvent with the tree's own `dragstart` data.
- The thinking picker only shows the levels set for the model (Settings → Models). Choosing High is reflected in the chip.
- Horizontal scroll: `.assistant-scroll` scrollWidth equals clientWidth in every state (388/388, or 380/380 at 390), including a long code line, which scrolls inside its own block.
- Scroll pinning: after opening "Reasoning" on the last reply, the gap to the bottom stays 0.

Faults found and fixed:
- At low usage the context ring read as a loading spinner. It now shows a percentage beside the ring ("4%").
- The model name lost 3px to a negative margin combined with `max-width: 100%` on the button, so short names showed an ellipsis. The margin moved to the wrapper, and the name now fits exactly (span 106/106).

Not covered: dragging BlockNote blocks, database rows or cards, tabs and sidebar tabs onto the panel. Only the tree-row path was filmed. The others go through the same `mentionsFromDrop` (`assistant/mentions.ts`) with their own MIME types, and nothing tests that path. Real provider thinking streams (Anthropic signed thinking, Gemini thought parts) are covered only by unit tests in `assistant/models.test.ts`.

## Round 4: timeline, sub-agents, approval, sources, ledger, context window

Rehearsed against the real server-mode build using a new mock (`/tmp/ai-rh/mock3.mjs`, OpenAI-compatible on `:9911`) and `/tmp/ai-rh/shots3.mjs`. The mock drives four turns:

1. "Research and compare…" starts two `agents.run` calls in parallel. Each sub-agent thinks, runs `search.query` / `web.search` / `web.fetch` against the real DuckDuckGo-backed tools, and writes a report. The parent then answers with a table.
2. "Write that into a page" calls `pages.create`, which shows up as a change.
3. "Delete the Scratch page" calls `pages.moveToTrash`, which is gated, so the approval card appears. The script declines it.
4. The context popover and the ledger popover are opened while a run is live and again after it finishes.

I ran light and dark at 1366×860 and light at 390×844. The app's saved theme overrides `prefers-color-scheme`, so the dark run forces `data-theme="dark"`. Every run finished with no page errors and no element overflowing the panel.

### Faults found and fixed
- After the timeline was collapsed, the next user turn didn't scroll into view. A new user message now always re-pins the scroller to the bottom (`ChatView` `userCount`).
- The approval card's method label was squeezed beside the title and got clipped (`pages.moveToT`). It now wraps onto its own line under the title.
- While an approval was pending, the timeline header said "Worked for 0s", which reads as if the run had finished. It now says "Waiting for you" with a hand icon (`Timeline` `waiting`).
- The live header said "2 agents working · … · 2 agents". The agent count now shows only once the run is done.
- Mock bug, not an app bug: it counted tool results across the whole chat, so turns 2 and 3 skipped their tool calls. It now counts only results after the last user message.

### Judgement
- Framing: a long tool loop folds into one line ("Worked for 7s · 4 steps · 2 agents · 11 sources"). While the run is live, the timeline is open with a shimmer label and a ticking timer, and it collapses when the answer arrives. Each sub-agent gets its own card with a live activity line and progress ticks.
- Hierarchy: the answer is the loudest thing in a finished reply. The timeline, changes and sources sit quietly above and below it. The approval card is the loudest element while it is pending, and the composer says "Waiting for you above…".
- Polish: the source marks use letter tiles hued from the host, with no remote favicons, so nothing leaks. Timers use tabular numbers. Reduced motion turns off the shimmer, the step-in and the pulse.

### Not covered
- Real provider streams with parallel tool calls from Anthropic and Gemini: only the OpenAI-compatible path was filmed. The parsers are covered by `assistant/models.test.ts`.
- Two chats running at the same time were exercised through the ledger "Running" list with one chat only. Per-chat runs are covered by the code paths in `assistant/store.ts`, but no test drives two chats at once.

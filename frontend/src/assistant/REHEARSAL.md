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

# Project conventions

**Product direction:** TypeDuel is its own product — a typing-race app (1v1 races plus a solo timed test) with a modern dark SaaS visual identity (inspired by giga.ai's layout language: a floating pill nav, card-based sections, one vibrant accent colour, generous rounded corners and soft shadows/glows), not a Monkeytype clone. Monkeytype's typing-test *mechanics* — word generation, scoring, the DOM-measured caret/scroll engine — are kept because they're proven and have nothing to do with visual style; see Typing engine below. Use our own name/logo ("TypeDuel"), never Monkeytype's branding. Controls that aren't built yet (punctuation, numbers, words/quote/zen/custom, settings, themes, leaderboards) are drawn in the same style as working controls but inert: `aria-disabled`, no hover, tooltip "not available yet". Don't wire a fake action to them.

Constraints future sessions must follow. Stack: Next.js 15, React 19, strict TypeScript, Tailwind v4 (tokens in `src/app/globals.css`), standalone Socket.IO server in `server/`, code shared by both in `shared/` (`@shared/*`).

## Page frame (`src/components/mt/`)

- Every page renders inside `MtShell` (floating pill header, 1280px content column, footer). The config bar is segmented-pill cards on an elevated surface; active/selected state is an accent-filled pill, not just a text-colour change. The typing canvas keeps Monkeytype's proven numbers because they're load-bearing for the engine, not a style choice: words 2rem, line pitch 1.6em (word `m-[.25em]`, `leading-[1.0375]`, 2px bottom border), 3 visible lines, caret `.1em × 1.2em`. Fonts: Lexend Deca is the UI chrome font (nav, buttons, body text, wordmark) via `next/font`; Roboto Mono is reserved for "data" — the typing canvas, timer, WPM/stat numbers, room codes, kbd hints — set explicitly, since body no longer defaults to mono.
- **Focus mode:** while a test runs, the engine calls `useTestFocus().setFocusMode(true)`; header nav, config bar and footer fade out and return on mouse movement. Tab focuses the restart button, Enter restarts (Monkeytype's `tab > enter`).
- Time mode (15/30/60/120) is the only mode. Solo shows `ResultScreen` (wpm/acc/chart/raw/characters/consistency/time); races show the versus result modal.

## Typing engine (`src/components/typing-engine.tsx`)

- **Input capture:** a hidden `<textarea>` holds only the current word's input. Never listen for keys on `document` to type, and never use `contenteditable`.
- **Space** commits the word (handled in `onKeyDown` with `preventDefault`); space on an empty word is ignored. **Backspace on an empty input** steps back only into a previous word that was typed wrong, and must `preventDefault` or the browser also deletes a letter of the restored word. Block Enter, arrows, Home and End.
- **Caret and ghost caret position come from measured DOM rects** (`getBoundingClientRect` of the target `[data-letter]`, relative to the words container). Never compute positions from character widths. Move with `translate3d` and a CSS transform transition, enabled only after the first measured position has painted. Re-measure on state change, `ResizeObserver` and `document.fonts.ready`.
- **Three-line viewport:** exactly 3 lines are visible; once the active word passes line 1 the words container translates up by one line so it stays on the middle line. Compute that scroll from rects (`wordBox.top - innerBox.top - lineH`), not integer `offsetTop`. When the caret changes line, its transition duration must equal the scroll's (`LINE_MS`, 150ms) so the caret stays steady on screen while the text scrolls; moves within a line use `TYPE_MS`. Extra letters (up to 10) render in-flow as `text-incorrect` after the word.
- **Layout stability:** an error underline is an inset box-shadow (no height change); reserve footer space; never add layout shifts while typing or finishing.
- **Scoring** lives in `shared/scoring.ts` and must be reused, not re-implemented. WPM is `chars / 5 / minutes`, crediting only fully correct words (plus the correct prefix of the word in progress). Accuracy is keystroke-based, so corrected errors still count against it.
- **Word text** comes from `shared/words.ts` (`generateWords(seed, count, bankVersion)`): deterministic, integer-only PRNG, never `Math.random`. Bank v2 = Monkeytype's english-200 (random with replacement, never the same word twice in a row); v1 is kept only so old persisted matches regenerate. Changing a bank means bumping `BANK_VERSION`. Word count for a timed test is `wordsForDuration(seconds)`.
- **Time mode:** the clock runs from the first keystroke (solo) or from the race GO (`clockStartMs`). At zero the engine dispatches `timeup`: the word being typed is *not* committed and scores on its correct prefix (`tallyTimed` / `scoreTimed` in `shared/scoring.ts` must match the engine). The engine samples per-second wpm / burst raw / errors for the result chart; consistency is computed from the burst-raw series.
- Change `words` only by remounting the engine (`key`). In a race the engine is controlled by props (`locked`, `clockStartMs`, `opponent`, `onProgress`, `onFinish`) and restart is disabled.

## Socket.IO

- **Event names** are `domain:action` strings defined once in `EVENTS` (`shared/protocol.ts`): `room:*`, `race:*`, `player:*`, `session:*`, `time:*`. Never inline an event string.
- Client-to-server requests use acks returning `{ ok: true, data } | { ok: false, error: { code, message } }`. Every server-bound payload is validated by a zod schema in `shared/schemas.ts` (server-only; keep zod out of the client bundle).
- **Identity** is in the handshake `auth: { playerId (uuid), name (1-16) }`, never in event payloads. The server owns all state transitions, the countdown clock and the seed; the seed is sent only in `race:countdown`, never in `room:state`.
- **Throttling:** the client emits `race:progress` at most once per **150 ms**, plus immediately on word completion, and only from state-change effects, never from raw keydown. Send it with `socket.volatile.emit` and a monotonically increasing `seq`. Server limits per socket: **40 requests / 10 s** for acked events, **300 events / 10 s** for `race:progress`; stale `seq` and out-of-range values are dropped silently.
- **Disconnects mid-race pause the race** (`room.pausedAt`, snapshot `paused: { until, graceMs, playerIds }`): input is locked client-side, the server ignores `race:progress` and rejects `race:finish` while paused, and on return `race:resumed` shifts `startsAt` by the paused time so nobody loses time. When the 10s window (`graceRaceMs`) expires the remaining player wins by forfeit; the absent player keeps their seat for the lobby grace so they can see the result. Explicit `room:leave` forfeits immediately.
- Rematch reuses the room: both players toggle `room:ready` after a result; the server picks a new seed/`matchId` and starts the 3s countdown. A client that reconnects mid-race keeps its engine mounted (same seed ⇒ same race) and must not reset its progress `seq`.
- **Races are timed:** the host sets the length with `room:config { durationSec }` (15/30/60/120) between races; `race:countdown` carries `durationSec`. The server arms an end timer at `startsAt + duration` (shifted by pauses), emits `race:timeup`, and each client answers with `race:finish { typed, activeIndex, correctKeys, totalKeys }`. The server recomputes WPM from that input and settles when everyone has submitted (or after `submitWaitMs`); higher WPM wins, then accuracy, else a draw. A player who never submits is scored from their last streamed progress.
- Room codes are 6 characters from `ROOM_CODE_ALPHABET` (no O/0/I/1). Rooms hold exactly 2 players and live in memory (single server instance).

## Text-state color tokens

These Tailwind utilities are reserved for typed-text state. Do not use them for general UI, and do not hard-code hex values for these states.

| State | Token | Use |
|---|---|---|
| Untyped | `text-untyped` | letters not yet typed |
| Correct / active | `text-correct` (alias `text-active`) | correctly typed letters |
| Error | `text-incorrect`, `bg-incorrect-bg`, `border-incorrect` | wrong letters, error highlight, underline of a wrong word |
| Extra | `text-extra` (`#7a2140`) | extra letters typed past the end of a word |
| Cursor | `text-cursor`, `bg-cursor` | the local caret; also the single UI accent |

The opponent's ghost caret uses `bg-text-muted` at reduced opacity, not the cursor color.

Chart series (results breakdown): `series-a` = you (cursor violet, `#7c5cfc`), `series-b` = opponent (`#45d0c7`), grid lines use `--chart-grid` (`#8c8b96`) at 35% opacity. Use these tokens (via `var(--series-a)` etc. in SVG), never raw hex. `recharts` is loaded only through `next/dynamic` in `results-breakdown.tsx`.

## Database (Neon Postgres + Drizzle)

- Schema is `db/schema.ts`; change it, run `bun run db:generate`, **review the SQL**, then `bun run db:migrate`. Migrations use `DATABASE_URL_UNPOOLED` (direct); runtime uses the pooled `DATABASE_URL`. Real values live only in `.env.local`. Migrations are additive and never run at app boot.
- `db/` is server-only: never import it from client components. Use `@db/*` in Next server code.
- Match persistence is a **background side effect**: `RoomMachine.endRace` emits `race:result` first, then calls `MatchRecorder.enqueue` (sync, never throws, never awaited). Writes are idempotent per `matchId` (`ON CONFLICT DO NOTHING`), retried with backoff, bounded by timeouts, and reported with `match:saved` / `match:save_failed`. Never `await` the database inside a socket handler or timer callback.
- Until real sign-in exists, the handshake `playerId` is `users.id`; a profile row is created on a player's first recorded match. Raw `db.execute` returns timestamps as strings: wrap them in `new Date()`.

## Checks

Run `npx tsc --noEmit` and `npx eslint .` before finishing. Run `bun run test:server` when `server/` or `shared/` changed, and `bun run test:db` (real Neon, cleans up after itself) when `db/` or persistence changed. When running a second dev server, use `NEXT_DIST_DIR=.next-e2e` so it doesn't clobber the user's `.next`.

# TypeDuel

A pixel-tight typing test with one extra feature Monkeytype doesn't have: real-time 1v1 races.
Same proven typing-test mechanics (word generation, scoring, the measured-DOM caret/scroll
engine), our own name, logo, and a modern dark UI.

## Features

- Solo timed typing test — 15 / 30 / 60 / 120 seconds, with a Monkeytype-style results screen
  (WPM, accuracy, raw, consistency, per-second chart).
- 1v1 races — create or join a 6-character room, both players type the exact same text,
  live opponent progress, pause-on-disconnect with a reconnect grace window, rematches.
- Match history & profiles, backed by Postgres — win/loss record, best WPM, head-to-head.
- Controls that exist in the UI but aren't wired up yet (punctuation, numbers, other test
  modes, settings, themes, leaderboards) are visible but intentionally inert.

## Stack

- [Next.js 15](https://nextjs.org) (App Router) + React 19 + strict TypeScript
- [Tailwind CSS v4](https://tailwindcss.com) — design tokens in `src/app/globals.css`
- A standalone [Socket.IO](https://socket.io) server (`server/`) for real-time races
- Code shared between the Next.js app and the server (`shared/`, imported as `@shared/*`)
- [Neon Postgres](https://neon.tech) + [Drizzle ORM](https://orm.drizzle.team) (`db/`) for match
  history — optional; the app runs fine without it, it just won't persist matches

## Getting started

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env.local   # fill in the values you need, see below
bun run dev:all              # Next.js dev server + the Socket.IO server, together
```

Open [http://localhost:3000](http://localhost:3000).

`dev:all` runs both processes concurrently; use `bun run dev` and `bun run dev:server`
in separate terminals if you'd rather see their logs apart.

### Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (default `4000`) | Port the Socket.IO server listens on |
| `CLIENT_ORIGIN` | no (default `http://localhost:3000`) | Comma-separated browser origins allowed to connect to the socket server |
| `NEXT_PUBLIC_SOCKET_URL` | no (default `http://localhost:4000`) | Where the browser connects for 1v1 races |
| `DATABASE_URL` | no | Pooled Neon connection string, used at runtime. Leave unset to run without match persistence |
| `DATABASE_URL_UNPOOLED` | only if running migrations | Direct (non-pooled) Neon connection string, used by `db:generate` / `db:migrate` |

Put real values in `.env.local` (git-ignored) — never in `.env.example`.

## Scripts

| Command | Description |
|---|---|
| `bun run dev` | Next.js dev server only |
| `bun run dev:server` | Socket.IO server only, with reload on change |
| `bun run dev:all` | Both, concurrently |
| `bun run build` / `bun run start` | Production build / start of the Next.js app |
| `bun run start:server` | Run the Socket.IO server without a watcher (production) |
| `bunx eslint .` | Lint |
| `bunx tsc --noEmit` | Type-check |
| `bun run test:server` | Smoke-tests `server/` and `shared/` |
| `bun run test:db` | Integration tests against a real Neon database (cleans up after itself) |
| `bun run db:generate` | Generate a Drizzle migration from `db/schema.ts` — always review the SQL before running it |
| `bun run db:migrate` | Apply pending migrations |
| `bun run db:studio` | Open Drizzle Studio against the configured database |

## Project structure

```
src/app/                 Next.js routes (/, /versus, /versus/[code], /profile, /profile/[handle])
src/components/mt/       Page frame: shell, header, footer, config bar, solo test, results
src/components/versus/   1v1 race UI: lobby, in-race view, result modal, charts
src/components/typing-engine.tsx   The typing test itself (shared by solo and 1v1)
src/hooks/               Client hooks (e.g. the Socket.IO room connection)
shared/                  Word generation, scoring, the Socket.IO protocol and zod schemas —
                          imported by both the Next.js app and the server as @shared/*
server/                  Standalone Socket.IO server: room/match state, matchmaking, persistence
db/                      Drizzle schema, queries, and generated migrations (Neon Postgres)
```

## Conventions

Project-specific conventions (design tokens, the typing engine's measurement rules, the
Socket.IO protocol, database workflow) are documented in [`CLAUDE.md`](./CLAUDE.md).
# Typeduel-typing

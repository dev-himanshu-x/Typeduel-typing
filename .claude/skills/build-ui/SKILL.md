---
name: build-ui
description: Build or change customer-facing UI in this typing app using the existing design tokens, component primitives and monospace conventions. Use for new screens, components and visual changes.
disable-model-invocation: true
---

# Build UI

Build the requested UI with the design system that already exists. Do not invent a new look.

Feature request: $ARGUMENTS

## Project conventions (read before writing any markup)

- **Stack:** Next.js 15 App Router, React 19, TypeScript (strict), Tailwind CSS v4. There is no `tailwind.config`: tokens live in `src/app/globals.css`.
- **Tokens:** raw CSS variables in `:root` (`--bg`, `--bg-elevated`, `--border`, `--text`, `--text-muted`, `--typing-*`, `--accent`, `--radius`, `--canvas-*`). They are exposed to Tailwind through `@theme inline`, so use utilities such as `bg-bg`, `bg-bg-elevated`, `text-text`, `text-text-muted`, `text-untyped`, `text-correct`, `text-incorrect`, `bg-incorrect-bg`, `text-cursor`, `bg-cursor`, `border-border`. Never hard-code hex colours or px font sizes that a token already covers.
- **Typography:** monospace only. `font-mono` and `font-sans` both resolve to JetBrains Mono, loaded in `src/app/layout.tsx` (the font variable lives on `<html>`). Do not add another font family.
- **Primitives** (plain classes in `@layer components`): `.page-container`, `.panel`, `.btn` + one of `.btn-primary | .btn-secondary | .btn-ghost | .btn-danger` (+ `.btn-sm`), `.input`, `.modal-backdrop` / `.modal` / `.modal-header` / `.modal-body` / `.modal-footer`, `.typing-stage`, `.typing-canvas`, `.caret-blink`.
- **Tone:** minimal and dark. The cursor yellow is the single accent. Prefer spacing and subtle borders over extra colours and shadows.
- **Client code:** components that use state, effects or the socket are `"use client"`. Shared types and constants come from `@shared/*`; the Socket.IO state lives in `src/hooks/use-room.ts`.

## Checklist

Work through these in order. Do not skip a step; say so explicitly if one does not apply.

1. **Inspect the current implementation and related components.** Read the files the feature touches and their neighbours: `src/components/`, `src/components/versus/`, `src/hooks/`, `src/app/`, and `src/app/globals.css`. Understand the existing behaviour, props, state and layout before editing.
2. **Search for reusable components before creating new ones.** Grep `src/components`, `src/hooks`, `src/lib` and `globals.css` for an existing component, hook, helper or CSS primitive that already does the job. Extend it if it is close; create something new only when nothing fits.
3. **Reuse the existing design system and patterns.** Use the tokens, primitives and monospace conventions above, and follow the surrounding code's patterns (naming, `data-testid` hooks, accessibility attributes, `aria-live` regions). If a genuinely missing token or primitive is needed, add it to `globals.css` in the right section rather than inlining a one-off value.
4. **Keep the change focused on the requested feature.** No drive-by refactors, renames, dependency additions or unrelated cleanups. Note unrelated problems you spot in the summary instead of fixing them.
5. **Verify responsive behavior.** Check at least a phone width (about 390px) and a desktop width (about 1280px). Look for horizontal overflow, truncated text, wrapped or stacked controls, tap-target size, and layout shift. The canvas tokens shrink under 40rem; make sure new UI cooperates with that.
6. **Run and visually verify the application.** Start the dev server and look at the real result in a browser, not just the code. Use an isolated build directory so you do not clobber any dev server the user already has running: `NEXT_DIST_DIR=.next-e2e npx next dev -p 3114`. If the feature needs the socket server, start it too (`PORT=4020 CLIENT_ORIGIN=http://localhost:3114 npx tsx server/index.ts`) and point the client at it with `NEXT_PUBLIC_SOCKET_URL=http://localhost:4020`. Exercise the feature end to end and capture screenshots. Check for console errors. Stop every process you started and delete `.next-e2e` when finished.
7. **Run the normal project checks.** `npx tsc --noEmit` and `npx eslint .` always. Add `bun run test:server` when `server/` or `shared/` changed, and a production build in an isolated directory (`NEXT_DIST_DIR=.next-build npx next build`, then delete it) when routes, config or dependencies changed.
8. **Fix reproducible issues without expanding scope.** If a check fails or the visual check shows a bug in what you built, reproduce it, fix the cause, and re-verify. Do not widen the work to unrelated areas; report anything you chose not to fix.
9. **Summarize what changed.** Briefly list: what the user will see, the files added or changed, what you verified (widths, flows, checks) and what you did not or could not verify, plus any follow-ups you noticed but left alone.

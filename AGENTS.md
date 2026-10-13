# ShowSteps: notes for coding agents

ShowSteps is a local-first how-to guide recorder: a Chrome MV3 extension and a Windows desktop app (Electron), joined by a native messaging bridge. Full working notes (layout and conventions) are in `docs/DEVELOPING.md`; recorded decisions are in `docs/DECISIONS.md`.

## Commands (repo root, pnpm 10, Node 22)

| What                                           | Command                              |
| ---------------------------------------------- | ------------------------------------ |
| Install                                        | `pnpm install`                       |
| Build (core, ui, extension, desktop, in order) | `pnpm build`                         |
| Unit tests                                     | `pnpm test`                          |
| Typecheck                                      | `pnpm typecheck`                     |
| Lint and formatting                            | `pnpm lint` (fix with `pnpm format`) |
| End-to-end tests (after `pnpm build`)          | `pnpm e2e`                           |
| Chromium for Playwright (once)                 | `pnpm setup:browsers`                |

Always run Playwright through `scripts/playwright.mjs` (the scripts above do). `pnpm e2e:desktop` drives the real mouse and keyboard on Windows: do not run it in CI or a shared machine.

## Rules that keep the product safe

- Local-first: no accounts, servers, telemetry or remote fonts and scripts. Optional AI is on-device and off by default.
- Never capture secrets: password fields and inputs with `autocomplete` values such as `current-password`, `new-password`, `one-time-code` or `cc-*` are never stored.
- Strict content security policy: no `eval` or `new Function`. Guide HTML is sanitised with DOMPurify before rendering.
- Every colour comes from `packages/ui/src/tokens.css` (mirrored in `packages/core/src/tokens.ts`); every interface string comes from `packages/ui/src/strings.ts`. Tests fail on hard-coded colours.
- `packages/core` never touches DOM globals.
- Text an agent reads comes from `toProcedure` (`packages/core/src/agent/procedure.ts`) and describes the procedure; it never addresses the reader.

## Before finishing a change

Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build` then `pnpm e2e` when the change touches the extension or exports. Record a new default in `docs/DECISIONS.md` (one line) and a new manual check in `docs/MANUAL_TESTS.md`.

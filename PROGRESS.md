# Progress

Resume from the first unchecked item. Each milestone ends with build, lint, tests and its acceptance checks passing, this file updated, and a commit `M<n>: <summary>`.

## Milestones

- [x] **M0** Monorepo scaffold, tooling, docs, demo app, CI
- [ ] **M1** `core`: schema and migrations, step-text writer, target descriptors, matching engine, storage interfaces, IndexedDB and Folder adapters
- [ ] **M2** Extension capture C1–C7, C9; side panel; library L1–L2
- [ ] **M3** Editor E1–E10 and image editor
- [ ] **M4** Exports X1–X8, viewer
- [ ] **M5** Guidance G1–G7, notes, pins, discover, comments L4, analytics L5
- [ ] **M6** Desktop app, bridge, C8/C10, G8, L3, L6, E11 (web steps)
- [ ] **M7** U1–U6, U10 (agent view, Agent Pack, embedded procedures)
- [ ] **M8** U8 OCR, E11 for desktop and image steps
- [ ] **M9** U7, U9, hardening, performance, docs, release

## M0 detail (done 2026-10-09)

- [x] Environment check (Windows 10 x64, Node 22, git, pnpm 10 installed); recorded in `docs/DECISIONS.md`
- [x] pnpm workspace: `packages/core`, `packages/ui`, `apps/extension`, `fixtures/demo-app`
- [x] TypeScript strict, ESLint, Prettier, Vitest, Playwright
- [x] `core` package builds with a smoke test
- [x] `ui` package: design tokens (light/dark), `Button`, shared strings
- [x] Extension (WXT, MV3): toolbar icon opens a side panel; no host permissions at install
- [x] Demo app with every awkward feature from section 10, verified by Playwright
- [x] e2e harness that loads the unpacked extension into Chromium
- [x] CI workflow (`windows-latest` + `ubuntu-latest`)
- [x] `docs/DEVELOPING.md`, `PARITY.md`, `docs/DECISIONS.md`, `docs/MANUAL_TESTS.md`, `README.md`, MIT `LICENSE`

**Acceptance:** `pnpm i && pnpm build && pnpm test` pass; `pnpm lint` passes; `pnpm e2e` passes (5 tests); `pnpm demo` serves the app on <http://localhost:5173>.

## Waiting on the owner

- **.NET SDK** (needed from M6 for `uia-helper`). Not blocking M1–M5.

## Deferred

- Desktop app package (`apps/desktop`) is created in M6, not as an empty scaffold now. Reason: no stub code in shipped paths; .NET SDK not yet installed.
- Extension icon: designed with the capture UI in M2.

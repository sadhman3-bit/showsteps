# Progress

Resume from the first unchecked item. Each milestone ends with build, lint, tests and its acceptance checks passing, this file updated, and a commit `M<n>: <summary>`.

## Milestones

- [x] **M0** Monorepo scaffold, tooling, docs, demo app, CI
- [x] **M1** `core`: schema and migrations, step-text writer, target descriptors, matching engine, storage interfaces, IndexedDB and Folder adapters
- [x] **M2** Extension capture C1–C7, C9; side panel; library L1–L2
- [x] **M3** Editor E1–E10 and image editor
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

## M1 detail (done 2026-10-09)

- [x] Zod schema v1 (`schema.ts`) with secret-safety rules, duplicate-id and variable checks
- [x] Migration framework (`migrations.ts`): upgrades older files, refuses newer ones with a friendly message
- [x] Rich text helpers (plain, Markdown, safe HTML)
- [x] Step-text writer covering all 13 actions, with naming fallbacks and no sensitive values
- [x] Target descriptors: implicit ARIA roles, accessible names, labels, ranked selectors scored by uniqueness, shadow-host chains, frame selectors
- [x] Matching engine: ranked strategies, narrowing, position tie-breaks, neighbourhood fallback, `waitForTarget` (MutationObserver + polling)
- [x] Storage interface + IndexedDbStore + FolderStore (atomic writes, trash, versions ≤ 50, images, per-user sidecars, nested folders)

**Acceptance:** 103 core unit tests. They cover every action's text, schema round-trips and migrations, and matcher round-trips for 26 demo-app elements across login, dashboard, form, dialog, shadow DOM and both iframes (each described in one page load and found in another load with different IDs). A shared storage contract suite runs against IndexedDB, real disk folders and an in-memory file system.

## M2 detail (done 2026-10-10)

- [x] Capture session rules in core (merges, insert position, restore), screenshot geometry, sensitive-field detection, .trailmark archives
- [x] Background recorder: optional permission, runtime content-script registration, rate-limited screenshots with reuse, iframe mapping, tab following, navigation steps, persistence across worker restarts, Alt+Shift+R
- [x] Content script in every frame: clicks, typing, selects, checks, uploads, keys, double and right clicks; never records secret values
- [x] On-page controller (drag, pause/resume, delete last, Live Blur, finish, cancel), hidden from screenshots
- [x] Side panel: Start, status, recent guides, capture-more hand-over
- [x] Library page: grid/list, nested folders, move, rename, tags, search, sort, app/tag filters, Trash (restore, delete permanently), duplicate, import/export `.trailmark`; read-only guide view
- [x] Extension icon

**Acceptance:** `e2e/capture.spec.ts` records the demo "create invoice" flow (20 steps across 2 pages, a cross-origin and a same-origin iframe, shadow DOM and the dialog). It checks every title, screenshot, Action Box and frame chain, that the password is stored nowhere, and that the dialog-opening click's screenshot was taken before the dialog appeared. 13 e2e tests in total, stable across 3 repeated runs; 151 unit tests.

## M3 detail (done 2026-10-10)

- [x] Core editing operations (move, delete, duplicate, insert, merge, split, sections) and undo history
- [x] Guide editor: rich titles and descriptions, alt text, drag to reorder (with compact view), multi-select, headings, callouts, image steps (upload and paste), keyboard shortcuts with a shortcut sheet
- [x] Image editor: highlight box, crop, magnify and zoom, blur, bulk blur, arrow, rectangle, ellipse, text, pen, numbered badge, colours, undo/redo, replace, paste, re-capture, reset to original
- [x] Autosave and version history (view, restore); branding (logo, accent, font); preview with copy-link-to-step and deep links
- [x] Two sample guides built from the demo app, installed on first run
- [x] Capture fix found while testing: screenshots finished after the page was replaced are discarded and the previous screenshot is reused; the toolbar is reliably hidden

**Acceptance:** `e2e/editor.spec.ts` reorders by drag, inserts a heading and a callout, blurs, annotates, undoes and redoes, and restores a version, plus multi-select, merge, split, keyboard shortcuts, autosave across reload, bulk blur, reset, branding, preview, step links and image-only steps. Stable across 3 repeated runs. 18 e2e tests in total; 164 unit tests.

## Waiting on the owner

- **.NET SDK** (needed from M6 for `uia-helper`). Not blocking M1–M5.

## Deferred

- Desktop app package (`apps/desktop`) is created in M6, not as an empty scaffold now. Reason: no stub code in shipped paths; .NET SDK not yet installed.

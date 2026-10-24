# Progress

Resume from the first unchecked item. Each milestone ends with build, lint, tests and its acceptance checks passing, this file updated, and a commit `M<n>: <summary>`.

## Milestones

- [x] **M0** Monorepo scaffold, tooling, docs, demo app, CI
- [x] **M1** `core`: schema and migrations, step-text writer, target descriptors, matching engine, storage interfaces, IndexedDB and Folder adapters
- [x] **M2** Extension capture C1–C7, C9; side panel; library L1–L2
- [x] **M3** Editor E1–E10 and image editor
- [x] **M4** Exports X1–X8, viewer
- [x] **M5** Guidance G1–G7, notes, pins, discover, comments L4, analytics L5
- [x] **M6** Desktop app, bridge, C8/C10, G8, L3, L6, E11 (web steps)
- [x] **M7** U1–U6, U10 (agent view, Agent Pack, embedded procedures)
- [x] **M8** U8 OCR, E11 for desktop and image steps
- [x] **M9** U7, U9, hardening, performance, docs, release

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
- [x] `docs/DEVELOPING.md`, `PARITY.md`, `docs/DECISIONS.md`, `docs/MANUAL_TESTS.md`, `README.md`, `LICENSE` (PolyForm Noncommercial 1.0.0; was MIT)

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

- [x] Capture session rules in core (merges, insert position, restore), screenshot geometry, sensitive-field detection, .showsteps archives
- [x] Background recorder: optional permission, runtime content-script registration, rate-limited screenshots with reuse, iframe mapping, tab following, navigation steps, persistence across worker restarts, Alt+Shift+R
- [x] Content script in every frame: clicks, typing, selects, checks, uploads, keys, double and right clicks; never records secret values
- [x] On-page controller (drag, pause/resume, delete last, Live Blur, finish, cancel), hidden from screenshots
- [x] Side panel: Start, status, recent guides, capture-more hand-over
- [x] Library page: grid/list, nested folders, move, rename, tags, search, sort, app/tag filters, Trash (restore, delete permanently), duplicate, import/export `.showsteps`; read-only guide view
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

## M4 detail (done 2026-10-10)

- [x] Exporters in core (`@showsteps/core/export`): PDF (pdf-lib), Word (docx), Markdown zip, self-contained HTML page, embed card, clipboard HTML and plain text, with branding
- [x] Pictures flattened for export with blurs, highlight and annotations burned in
- [x] Share dialog in the reader and the editor: six downloads, Copy HTML, Print, Save to shared folder (remembered, overwrites on re-save)
- [x] Print view route

**Acceptance:** golden-file tests for Markdown, the HTML page, the embed card and clipboard HTML. The PDF opens in pdf.js and the Word file in mammoth, each with every step and picture (unit tests and `e2e/export.spec.ts` on the 17-step sample). Copy HTML puts `text/html` and `text/plain` on the clipboard. A blurred region is measured as blurred in the exported picture. 20 e2e tests in total; 178 unit tests.

## M5 detail (done 2026-10-10)

- [x] Core: page matching and Discover, page marks (notes, pins), step plans and Run values, DOM actions and expectation checks, comments and analytics sidecars, on-device AI prompt and translation helpers
- [x] Background guidance engine (Guide Me and Run for me) with frame routing, tab following, resume after restarts, confirm, secret and manual stops, speed and step-through
- [x] In-page guidance script: highlight ring and step card (inside modal dialogs too), visible pointer for Run for me, note and pin badges, element picker
- [x] Side panel: running guide with step list and controls, Discover, notes and pins for the page, Guidance switch
- [x] Library: Guide Me and Run for me in the reader, comments and reactions, view counts, Insights page, Settings (name, Guidance, on-device AI), AI tools in the editor
- [x] Fix found while testing: the capture toolbar was inert while a page's modal dialog was open; it now moves into the dialog

**Acceptance:** `e2e/guidance.spec.ts`: Guide Me completes the 17-step demo flow with every step done on the highlighted target (two pages, a cross-origin iframe, a same-origin iframe, shadow DOM, a modal dialog). Run for me completes it, waits for the password and stops at the confirm step until approved. `e2e/pages.spec.ts` covers notes, pins, Discover, the Guidance switch, comments, reactions, Insights and the AI tools. 25 e2e tests in total; 197 unit tests.

## M6 detail (done 2026-10-11)

- [x] Windows helpers without a .NET SDK (built-in csc.exe): uia-helper.exe (UI Automation, pre-click window screenshots, typing reported without characters, foreground events, guarded input) and showsteps-host.exe (native messaging relay to the pipe `showsteps-<user>`)
- [x] Electron desktop app: library, editor, reader and insights from `ui`; tray, Ctrl+Alt+R, capture toolbar, desktop recorder, Guide Me overlay (G8), My library and Team library folders (L3), read-only guides and personal copies (L6), settings
- [x] Bridge: fixed extension ID, optional nativeMessaging, one shared capture (the extension recorder is the only writer), mixed guides in Guide Me, guides kept in the desktop library from the browser
- [x] Secure Blur for web steps (E11): word positions saved with each screenshot, detection with check digits in core, review screen in the editor
- [x] Installer: electron-builder NSIS per user (`pnpm --filter @showsteps/desktop dist`), registers the native host on install and removes it on uninstall
- [x] Fixes found while testing: typing in a desktop app is committed when another app comes to the front; screenshots show only the clicked window

**Acceptance:** `pnpm e2e:desktop` (3 tests, real mouse and keyboard, only into a Notepad window the test opened):

- `desktop-mixed.spec.ts` records one guide across the demo app and Notepad through the bridge, edits it, exports it to Markdown and plays it back with Guide Me (web ring and desktop overlay);
- `desktop.spec.ts` covers desktop-only capture;
- `desktop-library.spec.ts` covers the team library and read-only guides.

Stable across 3 repeated runs. The installer builds, and the install/uninstall hooks were checked against the registry. `pnpm e2e`: 26 tests. Unit tests: 207. PARITY.md is fully ticked except U1–U10 and E11 for desktop and image steps (M8).

## M7 detail (done 2026-10-11)

- [x] Core: procedure model, confirm detection, variable suggestions and input modes, sensitive marking, agent warnings, page observation for expectations
- [x] Exports: Agent Pack (SKILL.md, procedure.json, screenshots, Playwright replay) with a validator; procedure embedded in HTML, Markdown, Word (custom XML) and PDF (attachment)
- [x] Capture: confirm flags, captured expectations (page diff after 800 ms, new address from the background), default input mode
- [x] Editor: Agent tab, value controls with suggestions, Agent Pack in Share; Settings default for typed values (extension and desktop); Guide Me card says what to type
- [x] Run for me checks captured expectations (regular expressions for addresses, retried briefly)
- [x] Sample guides recorded again with these features

**Acceptance:**

- the Agent Pack passes the format checks (core tests, and the e2e download);
- embedded copies are read back from all four formats;
- the generated Playwright replay runs the demo flow, stops before "Submit invoice", and completes with `SHOWSTEPS_ALLOW_CONFIRM=1`;
- a fresh AI agent with only the Agent Pack completed the demo flow (`docs/agent-run-transcript.md`).

`pnpm e2e`: 28 tests (the replay runs as its own project after the extension tests, because its second browser slowed timing-sensitive capture tests); `pnpm e2e:desktop`: 3 tests. Unit tests: 224.

Fixes found while testing:

- word positions are read after the screenshot is requested, and saved even if they arrive late;
- the capture toolbar is shown again only when every pending screenshot is taken.

## M8 detail (done 2026-10-11)

- [x] Offline OCR: tesseract.js engine and English model copied into both apps at build time (`scripts/copy-ocr.mjs`), loaded on first use, WebAssembly allowed by CSP
- [x] Secure Blur reads pictures without word positions (desktop, uploaded, older steps) and keeps the result
- [x] Visual-only steps get `target.ocrText` (text around the action) when the guide is opened in the editor

**Acceptance:**

- Secure Blur finds all eight planted values on the demo dashboard screenshot by OCR alone, with no request leaving the machine (`e2e/secure-blur.spec.ts`), and on a pasted picture in the desktop app (`e2e/desktop-library.spec.ts`);
- a visual-only step gets the text around its action.

`pnpm e2e`: 29 tests; `pnpm e2e:desktop`: 4 tests; unit tests: 225.

## M9 detail (done 2026-10-11)

- [x] U7 self-check: Agent view → Check every step (dry run in a new tab, ring only, per-step report)
- [x] U9 guide health: Re-capture this step from the side panel; the step is replaced in place and guidance carries on
- [x] Settings: colours, Live Blur default, zoom level, picture quality, shortcuts link, Delete all ShowSteps data (extension); colours (desktop)
- [x] Performance: pictures encoded as soon as they are taken; a 68-step guide stays smooth (`e2e/performance.spec.ts`)
- [x] Hardening:
  - the toolbar hide is counted per picture;
  - word and page-state reads happen after the picture request;
  - IndexedDB lets go when the database is deleted elsewhere;
  - desktop settings are validated from the renderer.
- [x] README user guide; `pnpm release` writes the extension zip, the installer and checksums to `dist/`; version 1.0.0

**Acceptance:**

- the self-check report works on the sample guide;
- 50+ step guides stay smooth: a 68-step guide opens in about 1.4 s, with no long tasks;
- README has install steps for the extension (Load unpacked) and the desktop installer;
- the release files are in `dist/`.

`pnpm e2e`: 32 tests; `pnpm e2e:desktop`: 4 tests; unit tests: 227. PARITY.md and the upgrade list are fully ticked.

## Waiting on the owner

- Nothing.

## Deferred

- Extension capture: screenshot encoding takes 1.5–2.5 s per step on a busy machine before the step appears (the step still lands in order). Look at faster encoding in M9's performance pass.
- Secure Blur reads words only from the top frame of a web page at capture; a picture with iframe text can be re-read with OCR by deleting its word file (no button for that yet).

## Polish

- [x] P0: branch `polish`, "before" screenshots in `docs/design/before/` (`DESIGN_OUT=before pnpm design:shots`)
- [x] P1: rename to ShowSteps (`@showsteps/*`, `--ss-`/`ss-`, `.showsteps`, `com.showsteps.host`, `app.showsteps.desktop`; compatibility for `.trailmark` imports, `trailmark-procedure`, the old library folder and the old native host keys)
- [x] P2: tokens (`--ss-*`, Pink and Ink, light/dark/chrome; TypeScript copy in core/src/tokens.ts), bundled Funnel fonts (OFL), components (Button sizes and variants, IconButton, form controls, checkbox/toggle, segmented, badge, card, callout, dialog, menu, tooltip, toast, empty state, chip, key cap, disclosure), icon set, Ripple and Trail patterns; contrast, token-sync and no-hard-coded-colour tests. Also restyled the on-page toolbar (P4) and Guide Me tooltip and spotlight (P5) early, since they held hard-coded colours
- [x] P3: logo, wordmark, lockup, tile and patterns in `brand/` (text as paths via opentype.js), `pnpm brand` renders the extension icons (16/32 small mark, 48/128 with the ring ~112 px of 128), desktop icon.png and icon.ico, tray icons (with a dark-taskbar variant) and favicons
- [x] P4: side panel (Ripple band and lockup, Start card with key cap, recent guides; recording header with pulsing dot, icon buttons, ⋯ menu with confirmed Cancel, signal Finish, shadow on scroll, site chip; step cards with 16:10 thumbnails framed on the Action Box, delete on hover/focus, newest animates in), on-page toolbar (navy pill, 44 px buttons, Undo step) and 1.5 s step toast
- [x] P5: Guide Me and Run for me: spotlight (navy dim, 3 px pink ring with halo), navy tooltip with pink step count, ghost Back/Skip, pink I did this, progress bar, alert-style confirm ("Confirm and continue"); side panel guidance card and step list; desktop overlay to match
- [x] P6: editor (three-group top bar with title, save status, Edit/Preview/Agent, undo/redo, Record more, Share and a ⋯ menu; 820 px column; highlighter section headings; Copy link icon on hover; screenshots never enlarged past their pixels; crops about 2.2× the Action Box, at least 720 px; pink ring with halo, navy automatically on pink/red interfaces with a per-step override), agent view (warning callout, 160 px label grid, full-width fields, mono chips, disclosure), image editor (icon toolbar, pink/navy/white/yellow colours, highlight colour), dialogs, library (lockup, big search, cards with site chip and two-line titles, Ripple empty state)
- [x] P7: reader (cover title in Funnel Display, callouts with icons) and exports: HTML and embed card with a Trail cover band and embedded Funnel WOFF2 (Latin subset; CSP allows only data fonts), PDF with the cover band and embedded Funnel TTFs via fontkit, Word with Funnel Sans/Display embedded and token colours, Copy HTML callouts without side stripes; fixed a PDF bug where a line break in a callout printed as "?"
- [x] P7b (owner request): agent instructions tuned for computer-use agents and the GitHub Copilot coding agent (Agent Pack, embedded procedure, repo instructions): SKILL.md gains "How it runs" with browser-automation (Playwright, Playwright MCP, Copilot) and computer-use sections, each step an "On screen" position and its screenshot; every procedure step carries `screen` (target box as fractions of the screen); packs include AGENTS.md; the repo has AGENTS.md, .github/copilot-instructions.md and a copilot-setup-steps workflow
- [x] P8: desktop app: shared tokens and components, navy pill controller window (44 px buttons, Undo step), overlay matching Guide Me, lockup in the window bar, About dialog (Ripple band, lockup, version, licences; also in the extension library), new tray icons, installer ShowSteps-Setup-1.0.0.exe with the new icon; links open in the browser, never in app windows; licences (NOTICES.txt with every bundled package, OFL font licences) ship in both apps
- [x] P9: store images (3 × 1280×800, 440×280 promo, 1400×560 marquee), README with screenshots and the move from Trailmark/ABCXYZ, docs/design/POLISH_REPORT.md, after screenshots, accessibility e2e (names, 24 px targets, visible focus, reduced motion), offline e2e (no outside requests), `pnpm release` → dist/ (extension zip, Web Store zip, ShowSteps-Setup-1.0.0.exe, SHA256SUMS). Notification runs after P10
- [x] P10 (owner request): privacy policy and store listing corrected so every claim matches the code; trader/non-trader guidance; licences shipped (NOTICES.txt); README states the name is not covered by the MIT licence; commit emails rewritten to the GitHub no-reply address; pushed to the private repo sadhman3-bit/showsteps with a draft v1.0.0 release. **Waiting on the owner:** the name check below, then make the repo public, publish the release and submit to the Chrome Web Store

### Waiting on the owner (Polish)

- Nothing. The repo is public, v1.0.0 is published on GitHub and the extension is live on the Chrome Web Store (`hlkihjibgiehjcaemfhfnfcjphgkcnoa`).

### Polish: open issues

- `e2e/guidance.spec.ts` "Guide Me: completes the demo invoice flow" occasionally times out waiting for step 6 in a full run; it passes when re-run.

- `e2e/performance.spec.ts` can miss its time limits when it runs beside another Playwright worker on this machine; it passes when run alone (`node scripts/playwright.mjs test e2e/performance.spec.ts --project=chromium`).

- `e2e/secure-blur.spec.ts` "Secure Blur finds every planted value…" timed out once (5 s) waiting for a region in a full run during R2; it passes when re-run alone.

- Seen in the 1.2 baseline (23 October 2026), both pass when re-run alone: `e2e/capture.spec.ts` "records the create-invoice flow…" (the iframe step's `frames` read before the frame finished loading) and `e2e/controller.spec.ts` "capture follows the active tab (C6)" (the controller still in the old tab after 5 s).

## Update 1.1: schedules

- [x] S0: branch `schedules`, baseline, progress section. Baseline on 2026-10-20: lint, typecheck and build pass; unit tests 261 (core 194, ui 27, desktop 11, extension 21, demo 8); `pnpm e2e` 34 tests: 31 pass in the parallel run, and capture, library and performance pass when re-run alone (they miss timing limits while the machine is busy; the library helper now waits up to 15 s for slow screenshot encoding)
- [x] S1: schedule model in `core` (`packages/core/src/schedule/`: `ScheduleSchema`, `RunLogSchema`, `nextRun`/`nextRuns`/`missedRun` with Sydney daylight-saving and month-end tests, `resolveTokens` placeholders, `guideVersion` and approvals, `SIGN_IN_HOSTS`). Unit tests 286 (core 219)
- [x] S2: running a schedule in the extension: `alarms` permission and optional `notifications`; `Scheduler` (`apps/extension/lib/schedules.ts`: alarms, start-up rebuild and catch-up, busy retry, unattended stops with notifications and waits, desktop-step guides ask to start, check first) and `RunLogStore` (IndexedDB `showsteps-runlogs`, JPEG per step, newest 20 per schedule); Run for me gains pre-approved confirm steps, the sign-in stop ("Sign in, then press Continue") and stays in a scheduled run's window and tab; the demo app has a session cookie and a mock identity provider. Tests: extension unit 38, demo 11, e2e `schedules.spec.ts` (3)
- [x] S3: interface: Schedule dialog (`packages/ui/src/schedule/ScheduleDialog.tsx`: repeat, time, skip dates, next three runs, values with placeholder picker and preview, pre-approvals with the "Guide changed" warning, missed run, wait, keep window, check first, desktop and Chrome-only notes) from the reader's new ⋯ menu and library cards; Schedules page (`SchedulesPage.tsx`: next run, last outcome, switch, Run now, Edit, Delete, run history with values and pictures, what schedules can't do); side panel run card; badge cleared by the page; recording and other guidance refused during a scheduled run. e2e: 40 (`schedule-screens.spec.ts` 2 new)
- [x] S4: desktop app: Start with Windows (off by default, `--hidden`); hello reply carries `appVersion`, `capabilities: ['schedule-wake']` and `startWithWindows`; the extension sends `schedule-next` only to a capable app; `ScheduleWake` (`apps/desktop/src/main/wake.ts`) starts Chrome from App Paths with no arguments when a run is due and Chrome isn't running, remembering the time across restarts; the Schedule dialog suggests Start with Windows. Also fixed a race that revived finished runs. Tests: desktop unit 18, extension unit 41, e2e 40; `e2e/desktop-schedule.spec.ts` written, `pnpm e2e:desktop` 6/6 on 24 October 2026 after the owner's go
- [x] S5: hardening: `docs/SECURITY_REVIEW_SCHEDULES.md` (approvals tied to the guide version, nothing arrives in imports or team folders, no secrets typed or clicks unrecorded, notifications and logs hold no sensitive values, desktop starts only Chrome with no arguments, CSP unchanged; no open issues); mixed versions (`bridge.test.ts`); accessibility (`e2e/a11y-schedules.spec.ts`: dialog, page and run card, keyboard-only set-up; fixed date/time focus rings); performance (`e2e/schedules-performance.spec.ts`: 10 schedules × 20 runs open in about 0.3 s); design shots refreshed (dialog says "When", Start capture disabled during a scheduled run, run card border in dark). Unit 318, e2e 43
- [x] S6: docs, privacy policy and store listing: README and INSTALL (Schedules section, placeholders, approvals, stops, limits, Start with Windows, update over the old desktop app, Web Store first), privacy policy dated 21 October 2026 (Scheduled runs section, While a guide runs, Limited Use statement, new controls), listing (description, `alarms` and `notifications` justifications, storage and host-access rows), `4-schedules.png` in `pnpm store:images`, `docs/release-notes/1.1.0.md`, PARITY U11–U16; every policy and listing claim checked against the code in `docs/SECURITY_REVIEW_SCHEDULES.md` section 9
- [ ] S7: release 1.1.0 and go live. Done: version 1.1.0; release manifest = 1.0's permissions plus `alarms`, optional `nativeMessaging` and `notifications`, CSP unchanged; full gate (lint, typecheck, unit 318, build, e2e 43, `pnpm e2e:desktop` 5/5); PR #1 merged after CI passed on windows-latest and ubuntu-latest; `pnpm release` on `main`; GitHub release v1.1.0 published on the owner's go (checksums verified from GitHub); owner's desktop app updated to 1.1.0 over 1.0 (library kept). Manual tests MT-S-1 to MT-S-8 not run before release (owner chose to publish). **Left:** Chrome Web Store update and review, then the smoke test

### Waiting on the owner (1.1)

- **Waiting on the owner: Chrome Web Store review.** Version 1.1.0 was submitted for review on 21 October 2026. If it's rejected, fix what the reviewer names, raise the version to 1.1.1 and resubmit (the store needs a higher version than the last upload).
- **After it's published, smoke test the store copy:** the store page shows 1.1.0; `chrome://extensions` shows 1.1.0, still on, no permission prompt; a schedule set 2 minutes ahead runs in its own window and appears in the run log; a confirm step pauses with a notification; an expired sign-in stops the run; with Chrome closed and desktop app 1.1 running, a due run opens Chrome and runs.
- **Manual tests MT-S-1 to MT-S-8** (`docs/MANUAL_TESTS.md`) when convenient.

### Deferred (1.1)

- **Next, 1.2: attach the file a run downloaded** (owner request, 21 October 2026). Today Run for me always stops at an upload step for the person to pick a file. Plan: in the editor, mark an upload step "Use the file downloaded in step N"; when Run for me does that download click it keeps a private copy of the file for the run (fetched the way the page would, so no new permission if possible; otherwise an optional `downloads` permission asked only when used), and at the upload step it sets that copy on the site's file field without opening a picker. Only a file the same run downloaded, only on marked steps, its name in the run log. Falls back to stopping for the person when the file can't be fetched (files built in the page, extra security checks). Works for webmail (Outlook on the web, Gmail); Outlook desktop still needs the person.

## Update 1.2

- [x] R0: branch `update-1.2` from `main`, this section, baseline on 23 October 2026: lint and typecheck clean; unit 318 (core 220, ui 27, desktop 18, extension 42, demo 11); build OK; e2e 43 (full run: 40 passed, 2 timing failures under parallel load that pass when re-run alone, listed below, and 1 skipped after them)
- [x] R1: core: `StepInputSchema.from` (`latest` or a step ID; upload steps only); `planStep` `attach`, `planGuideStep` (a missing or later source step falls back to a plain upload) and `attachAhead`; start links (`packages/core/src/guidance/links.ts`: `buildStartLink`, `parseStartLink`, `withoutStartLink`, `guideStartUrl`); procedure `input.from` with step numbers, Agent Pack "Input: the file downloaded in step N"; `replay.ts` collects downloads (`page.on('download')`) and saves the chosen one for `setInputFiles`, `TM_FILE_STEP_<n>` still overrides; `RunStepLogSchema.file`; demo `/exports.html` (plain link, `blob:` link, form POST) and `/send.html` (hidden file field behind Attach, `?accept=` variant). Run for me still stops at attach steps until R3. Tests: core 230, demo 13, e2e `agent-replay.spec.ts` attach case
- [x] R2: editor: upload steps get a File control (`packages/ui/src/editor/FileControls.tsx`: Choose it yourself, the file this run downloaded last, the file downloaded in step N), "Attach the file this run downloaded? Use it" after a download-looking step (`suggestAttachSource`), a warning when the source step was deleted or moved after the upload, the download-access note with Allow download access (`permissions.request({ permissions: ['downloads'] })` inside the click, through the `downloadAccess` prop) and the line shown after declining; the desktop app's editor says "Download access is set in Chrome". `downloads` added to the optional permissions. Tests: ui 31, core 232, e2e `attach-editor.spec.ts`; full e2e 41 passed with 2 timing failures under load (capture, Secure Blur) that pass when re-run alone
- [x] R3: Run for me attaches the file: the run keeps files only while an attach step is ahead (`apps/extension/lib/attachments.ts`, `RunAttachments`), in IndexedDB `showsteps-run-files` (`lib/runfiles.ts`), at most 25 MB a file and 50 MB a run, deleted when the run ends and at start-up when no run owns them; a `blob:`/`data:` link (and, without download access, a same-site `download` link) is read in the page before the click; with download access the run's downloads are matched to its clicks (10 s, not from an extension, same site; two from one click attach neither) and fetched again from the background with size and HTML checks; the attach path in `guide-run` finds the field even when hidden (`fileInputFor`, `acceptsFile`, `setInputFile` in `packages/core/src/dom/attach.ts`); waiting for a download in progress; stops with `file-…` reasons and the file's name and step; Guide Me's tooltip says which download to choose. Tests: core 235, extension 52, e2e `attach-run.spec.ts` (7). MT-R-1 and MT-R-2 for the owner
- [x] R4: desktop app reads the download: capability `read-download` in `BRIDGE_CAPABILITIES` (so the hello reply lists it); `readDownload({ path, size })` (`apps/desktop/src/main/downloads.ts`) refuses a relative path, a missing file, a folder, a link or junction, a size that differs, a file over 25 MB or one written more than 15 minutes ago; the reply's bytes use the existing chunking; the extension asks only an app that lists the capability (`readDownloadVia`), before re-fetching; desktop app version 1.2.0. Tests: desktop unit 21, extension `bridge.test.ts` (1.1 never asked, 1.2 reads). `e2e/desktop-attach.spec.ts` written, `pnpm e2e:desktop` 6/6 on 24 October 2026 after the owner's go
- [x] R5: scheduled runs: an attach step whose file is ready runs on; a missing file pauses the run as a step for the person with its `file-…` reason, notifies ("step N needs the downloaded file") and logs that reason when the run ends; the run log's `file` entry (name, size, host, source step) shows as "Attached report.pdf (589 bytes), downloaded in step 2" in the run history; Check first finds an upload step's file field even when hidden (`guide-probe` `fileField`), without attaching; the Schedules page's limits and a Schedule dialog note say uploads stop unless set to a downloaded file. Tests: extension 55, e2e `schedules.spec.ts` (2 new)
- [x] R6: Guide Me and Run for me everywhere: visible buttons on library cards (above the card's title link) and in each card's ⋯ menu; the editor's top bar (before Share; icons only between 1101 and 1500 px wide; the start waits for pending edits to be saved); icon buttons on the side panel's Recent guides and Run for me beside Guide Me in Guides for this site; Run for me opens `RunDialog` first everywhere, which fits the side panel; guides without a browser step show both disabled with the reason; accessible names include the guide's title. Tests: e2e `entry-points.spec.ts` (3), `a11y.spec.ts` (1 new), card-title selectors made exact in older tests; design shots refreshed. Full e2e 55 passed with the capture timing flake, which passes alone
- [x] R7: links in exported files: "Open in ShowSteps: Guide Me · Run for me" under the title in the HTML page, embed card, Copy HTML, Markdown, PDF (URI link annotations) and Word (hyperlinks); Share dialog toggle (on by default, remembered); background spots the marker (`webNavigation`, top frame, start-page match, one prompt per tab per 10 s) and opens the `#/start/…` window (Start, Not now, not in library, guide changed, busy); `StartOptions.fromLink` goes to the clean start page. Tests: core `links.test.ts`, e2e `start-links.spec.ts` (6) and `export.spec.ts` (1 new), all passing; full e2e 61 passed with the performance flake and a cold-start link miss (see Deferred)
- [x] R8: hardening and docs: `docs/SECURITY_REVIEW_1.2.md` (run files, which downloads belong to a run, fetching, `readDownload`, attaching, start links, permissions and CSP, every privacy-policy and listing claim checked against the code; no open issues); accessibility (`e2e/a11y-attach.spec.ts`: File control, download-access note and start window, keyboard only); performance (a 25 MB file attaches well inside the 15 s step timeout; the whole six-step run took under 8 s); README (Downloads and uploads, Links in exported files), INSTALL (updating to 1.2), privacy policy dated 24 October 2026 (Files a run attaches, Links in exported files), listing (description, `downloads` and `webNavigation` justifications), `docs/release-notes/1.2.0.md`, PARITY U17–U19, store images refreshed, `submit.html` steps for 1.2; the link handler now waits for start-up like the message handler. Full e2e 68 passed
- [ ] R9: release 1.2.0. Done: version 1.2.0; release manifest = 1.1.0's permissions plus optional `downloads`, nothing new required, CSP unchanged; full gate (lint, typecheck, unit 359, build, e2e 68, `pnpm e2e:desktop` 6/6); PR #2 merged after CI passed on windows-latest and ubuntu-latest; `pnpm release` on `main`; GitHub release v1.2.0 published on the owner's go on 24 October 2026 (checksums verified from GitHub). Manual tests MT-R-1 to MT-R-4 not run before release (owner said go). **Left:** Chrome Web Store update once 1.1.0 is live, then the smoke test

### Waiting on the owner (1.2)

1. **Manual tests MT-R-1 to MT-R-4** (`docs/MANUAL_TESTS.md`): Gmail, Outlook on the web, a link in a PDF, a link in Word.
2. **Chrome Web Store, only once 1.1.0 is live there** (don't cancel the 1.1.0 review): open `docs/webstore/submit.html` and follow its steps: upload `dist/showsteps-extension-1.2.0-chrome-web-store.zip`; paste the new Description; replace the four screenshots; on Privacy practices add the `downloads` justification and replace the `webNavigation` one (Copy buttons on the page); submit.
3. **After the store publishes 1.2.0, smoke test:** the store page and `chrome://extensions` show 1.2.0 with no permission prompt on update; a guide that downloads then uploads runs through with Run for me; the editor's Allow download access shows Chrome's prompt; a Run for me link in an exported PDF opens the start window and runs; desktop app 1.2 installed over 1.1 keeps the library.

### Deferred (1.2)

- **A start link opened in the first moments after ShowSteps starts in a brand-new profile** sometimes opens no window (seen only under parallel e2e load, right after the extension is installed in a new test profile: the worker never receives that navigation event; later links in the same profile work). `e2e/start-links.spec.ts` waits until ShowSteps has started before the first link. Worth checking by hand: click a link right after starting Chrome (part of MT-R-3).

## Security (H)

Plan: `SECURITY_PLAN.md` (H0 to H9). 1.2.0 was already released, so this work is branch `security` from `main`, merged back to `main` as version 1.2.1.

- [x] H0: branch `security` from `main` at `e6794a0`; baseline is the R9 gate on that commit (lint and typecheck clean; unit 359: core 239, ui 31, desktop 21, extension 55, demo 13; build OK; e2e 68; `pnpm e2e:desktop` 6/6). `pnpm audit --prod`: 4 vulnerabilities (1 low, 2 high, 1 critical) in dompurify, zod and electron, fixed in H8
- [x] H1: shared `.showsteps` files are redacted: `exportGuideArchive(store, id, { mode: 'share' | 'backup', redact })`; share mode burns blurs (16-px mosaic, then blur) and crops into each picture, moves highlights and annotations to match, and leaves out page text (`.words.json`), pictures from before edits (`original`), pictures no step uses, `updatedBy` and `capture.tabId`; it refuses without a redactor. The Share dialog, shared-folder saves and library Export use share mode; library ⋯ **Back up (includes hidden details)** asks first ("This file includes everything under your blurs. Keep it to yourself."); the desktop app's copy into its own library stays a full copy. Privacy policy, listing and README say what a shared file holds. Tests: core `archive.test.ts` (3), e2e `share-redaction.spec.ts` (blur the invoice number, share, import into a fresh profile: no blur rectangles, the pixels under the blur changed and lost their edges, no `.words.json`)
- [x] H2: the replay script and SKILL.md can't be turned into code by guide text: `comment()` in `replay.ts` (line breaks including CR, U+2028 and U+2029, and other control characters become spaces; at most 200 characters) for the title, each instruction, variable labels and defaults; an attach source's step number is written as a number; SKILL.md writes the names a step took from the screen in code spans, under "Names in backticks are copied from the app’s screens." Tests: core `replaySafety.test.ts` (every interpolation in `replay.ts` goes through `q()`, `comment()` or a number), `agent.test.ts` parses the generated spec with the TypeScript compiler for seven payloads (top-level statements exactly as expected, no `require` or `execSync` call); e2e `agent.spec.ts` wording
- [x] H3: Run for me attaches only files from the run's own site: `downloadCreated` requires the download's address on the run tab's site (`downloadHost`, `sameSite`) whether or not Chrome gives a referrer, and the referrer too when there is one; a redirect to another site is fetched again without cookies (`refetch(download, { credentials: 'omit' })`) and never read through the desktop app; another site's file stops the run at the attach step with `file-other-site` ("The file came from another site (bank.example) than this step (shop.example), so ShowSteps didn't attach it."), in the side panel, the run log and the scheduled-run notice. Demo `exports-cross.html` (on 127.0.0.1, a no-referrer download from localhost). `SECURITY_REVIEW_1.2.md` sections 2 and 3 updated. Tests: extension `attachments.test.ts` (4 new), e2e `attach-run.spec.ts` (1 new)
- [x] H4: guides from someone else ask before acting: optional `received: { at, from: 'import' | 'shared-folder', file? }` on guides, set by `importGuideArchive` (ShowSteps's samples and copies of the person's own guides pass `received: false`) and by a team folder for guides someone else saved last (`FolderStore` `othersAreReceived`); import re-arms `agent.confirm` for every step whose control can't be undone (`rearmConfirms`); Run for me sends `confirmed` and a schedule's `approvedName` with each `guide-run`, and the content script replies `cannot`/`needs-confirm` when the live element's name needs confirming (`liveNeedsConfirm`), so the run asks first; a schedule's approval holds only while the live name is the approved one. The Run dialog shows **From someone else** (sites, typed values, files moved between sites, stops) and Start waits for "I've checked this guide"; **Trust this guide** removes the mark (library, editor, reader, side panel, start window). Schedules refuse such a guide until it's trusted, and a scheduled run of one ends with `guide-received`. Privacy policy section "Guides from other people". Tests: core `received.test.ts` (4), `storage.test.ts` (team folder), extension `guidance.test.ts` (2 new), e2e `received-guide.spec.ts` (export from one profile, import into a fresh one, panel, tick, stop at Send, trust, schedule), `a11y-attach.spec.ts` (panel by keyboard)

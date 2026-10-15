# Developing ShowSteps

Local-first how-to guide recorder (Chrome MV3 extension + Windows desktop app, joined by a native messaging bridge). Progress is in `PROGRESS.md`, feature checklist in `PARITY.md`, defaults in `docs/DECISIONS.md`, manual checks in `docs/MANUAL_TESTS.md`.

## Commands (run from the repo root)

| What                               | Command                                                                                          |
| ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| Install                            | `pnpm install`                                                                                   |
| Build everything                   | `pnpm build`                                                                                     |
| Unit tests (all packages)          | `pnpm test`                                                                                      |
| Typecheck                          | `pnpm typecheck`                                                                                 |
| Lint + format check                | `pnpm lint` (fix formatting with `pnpm format`)                                                  |
| Install Playwright Chromium (once) | `pnpm setup:browsers`                                                                            |
| End-to-end tests (build first)     | `pnpm e2e`                                                                                       |
| Desktop e2e (real mouse/keyboard)  | `pnpm e2e:desktop` (Windows; opens Notepad and a headed Chromium; hands off input)               |
| Desktop app from source            | `pnpm --filter @showsteps/desktop start` (after `pnpm build`)                                    |
| Release files (`dist/`)            | `pnpm release` (extension zip, Web Store zip, installer, SHA256SUMS; builds first)               |
| Chrome Web Store images            | `pnpm store:images` (after `pnpm build`; writes `docs/webstore/images`)                          |
| Desktop installer                  | `pnpm --filter @showsteps/desktop dist` → `apps/desktop/release/*.exe`                           |
| OCR engine files (build does this) | `node scripts/copy-ocr.mjs <app public folder>/ocr` (tesseract.js, offline)                      |
| Windows helpers only               | `pnpm --filter @showsteps/desktop build:native` (built-in csc.exe, no .NET SDK)                  |
| Demo app                           | `pnpm demo` → <http://localhost:5173> (widget on `http://127.0.0.1:5174`)                        |
| Extension dev mode                 | `pnpm --filter @showsteps/extension dev`                                                         |
| One package's tests                | `pnpm --filter @showsteps/core test`                                                             |
| Re-capture demo DOM snapshots      | `pnpm snapshot:demo` (matcher test fixtures in `packages/core/test/fixtures/demo`)               |
| Rebuild the sample guides          | `pnpm make:samples` (records the demo app; writes `apps/extension/public/samples`)               |
| Logo, icons, patterns (brand/)     | `pnpm brand` (after `pnpm build`; writes brand/*.svg, extension and desktop icons)               |
| Design screenshots                 | `pnpm design:shots` (light and dark, into `docs/design/after/`)                                  |
| Promo video                        | `pnpm motion` (renders `docs/promo/motion.html` to `docs/promo/showsteps-promo.mp4` and `.webm`) |
| Stress-test e2e for flakiness      | `node scripts/playwright.mjs test --repeat-each=3`                                               |

Always run Playwright through `scripts/playwright.mjs` (the `e2e` and `setup:browsers` scripts do). It sets `PLAYWRIGHT_BROWSERS_PATH=0` so browsers live in `node_modules`; Chromium will not start from `%LOCALAPPDATA%\ms-playwright` on the owner's machine.

The extension builds twice: `.output/chrome-mv3` (release) and `.output/chrome-mv3-e2e` (adds `<all_urls>` host access and the `__showsteps` service-worker hook used by e2e tests; see `e2e/helpers.ts`). e2e tests load the `-e2e` build; `e2e/extension.spec.ts` checks the release manifest stays minimal.

## Layout

```
packages/core/       pure TS: schema, migrations, stepText, richText, factory, geometry, archive, branding, ai,
                     secure (Secure Blur detection), bridge (desktop protocol), desktop (process lists),
                     agent/ (procedure = agent-readable guide, confirm, variables = input modes, warnings)
                     capture/session.ts (events → steps), editor/ (ops, history, image), dom/ (aria, traverse, describe, match,
                     sensitive, act = Run for me actions, text = word positions for Secure Blur,
                     observe = page diff for captured expectations), storage/ (types, folder, indexeddb, summary),
                     guidance/ (pages, marks, plan, social = comments, analytics)
                     node/ = Node FileSystem, imported as @showsteps/core/node
                     export/ = PDF, Word, Markdown, HTML, embed, clipboard exporters, imported as
                     @showsteps/core/export (golden files in test/golden; update with vitest -u);
                     also agentpack.ts (Agent Pack + validator) and replay.ts (Playwright replay script)
packages/ui/         Preact: library/ (Library, filter), guide/ (GuideView, GuideReader, Screenshot, PrintView),
                     ocr/ (offline tesseract.js: readPicture, readAround), export/ (ShareDialog, flatten = burn edits into PNGs, folder = shared-folder saves),
                     guidance/ (RunDialog, Comments, Insights, SettingsDialog), ai/builtin.ts (Chrome on-device AI),
                     editor/ (GuideEditor, AgentView, ImageEditor, SecureBlurDialog, RichTextField, TextField, dialogs), components/,
                     tokens.css, app.css + editor.css, strings.ts (all UI text), brand.ts
apps/extension/      WXT MV3 extension
  entrypoints/       background.ts, capture.content.ts + guide.content.ts (runtime-registered), sidepanel/
                     (SidePanel, GuidancePanel, PagePanel), library/
  lib/               recorder.ts (capture engine), guidance.ts (Guide Me / Run for me engine), frames.ts, shots.ts,
                     messages.ts + guideMessages.ts (Zod), settings.ts (settings, notes and pins), recapture.ts,
                     samples.ts, client.ts (page helpers), content/ (capture.ts, controller.ts, liveBlur.ts, guide.ts)
  lib/bridge.ts      native messaging client, BridgeStore (guides in the desktop library)
  lib/selfcheck.ts   U7 dry run (find and ring each step's element, never act)
apps/desktop/        Electron app (Windows)
  native/            UiaHelper.cs (UI Automation, hooks, screenshots, input) + ShowStepsHost.cs (native host relay)
  src/main/          index.ts (windows, tray, IPC), helper.ts, recorder.ts, events.ts, guide.ts (G8 overlay),
                     bridge.ts (pipe server), nativeHost.ts (HKCU registration), settings.ts
  src/renderer/      App (library/editor), Controller (capture toolbar), Overlay (Guide Me)
  build/installer.nsh  NSIS hooks: register / unregister the native host
fixtures/demo-app/   test web app (server.mjs, public/, xorigin/), planted-secrets.json
e2e/                 Playwright tests; fixtures.ts launches Chromium with the unpacked extension
scripts/             repo tooling
docs/                DECISIONS.md, MANUAL_TESTS.md
```

## Conventions

- TypeScript strict with `noUncheckedIndexedAccess`. ESM everywhere; relative imports in `core`/`ui` use `.js` extensions.
- Library packages build with `tsc` to `dist/`; the extension imports them via `workspace:*`, so build `core` and `ui` before the extension (`pnpm build` does, in order).
- Preact 11: import HTML attribute types from `preact` (e.g. `ButtonHTMLAttributes`).
- Colours only from `tokens.css` variables (`--ss-*`); every string from `strings.ts`.
- No `eval`/`new Function`; sanitise guide HTML with DOMPurify before rendering; never store values from password, OTP or `cc-*` fields.
- `core` never touches DOM globals (lint-enforced): DOM helpers take nodes and reach the window via `ownerDocument.defaultView`; storage takes an `IDBFactory` or `FileSystem` in its constructor.
- Editor text fields keep their own content while focused, and edits are functional (`apply(g => …)`), so renders that lag a keystroke never reset typing. Keep that pattern for new fields (`TextField`, `RichTextField`).
- Exporters take flattened pictures (`ExportInput`); the UI makes them with `prepareExport`. Reader-facing export text is in `core/src/export/labels.ts`. Exported HTML runs no scripts (its only script element is the `application/json` procedure block).
- Everything agents read comes from `toProcedure` (core/src/agent/procedure.ts). Its wording describes the procedure and never addresses the reader.
- Python edit scripts run through the shell lose backslashes (`\n` arrives as a newline): use the Edit tool for code containing backslashes.
- Tests: Vitest files in each package's `test/`; e2e in `e2e/*.spec.ts`. Demo app pages scramble IDs and classes on every load, so selectors must not depend on them. App code that needs a fixed ID marks it `data-stable-id`.
- Desktop e2e tests send real OS input. Only ever into a window the test opened (unique title): use `Desktop.input`/`click`, which the helper refuses unless that window is in front, and close only processes the test started. Never `taskkill /IM`. They take a lock so they never overlap.
- A web screenshot's word positions live beside it as `<picture>.words.json` (see `wordsFileFor`); replaced pictures get new names, so stale word files are never used.
- Commits: `M<n>: <summary>` at the end of each milestone; small commits within.
- Record each new default in `docs/DECISIONS.md` (one line) and each manual check in `docs/MANUAL_TESTS.md`.

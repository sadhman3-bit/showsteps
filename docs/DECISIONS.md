# Decisions

One line per default chosen during the build. Newest at the bottom of each milestone.

## M0

- **OS detected:** Windows 10 Home Single Language 22H2 (build 19045), x64. Everything, including the desktop app, is built and tested locally; CI also runs on `windows-latest` and `ubuntu-latest`.
- **Node:** 22.16 (LTS), already installed in the user-owned `C:\Users\IcyTech\nodejs`. `engines.node >= 22`.
- **pnpm:** 10.34.6 installed with `npm i -g pnpm@10` into the same user-owned folder (no admin). Corepack 0.32 could not run pnpm 12's package layout. Pinned via `packageManager`.
- **TypeScript 6.0, not 7.0:** typescript-eslint 8.71 supports `<6.1`. Revisit when typescript-eslint supports TS 7.
- **`@types/node` 22** to match the Node runtime, not the latest major.
- **Preact 11** (current). Its HTML attribute types are imported from `preact` (e.g. `ButtonHTMLAttributes`), not `JSX.*`.
- **Extension framework:** WXT 0.21 with `@preact/preset-vite`. `minimum_chrome_version` 116 (side panel API maturity).
- **Lint:** ESLint 10 flat config with `typescript-eslint` strict, plus `no-eval`, `no-implied-eval`, `no-new-func`. Prettier: single quotes, 100 columns, LF.
- **Tests:** Vitest 5 per package; Playwright 1.64 for e2e at the repo root.
- **Playwright browsers live in `node_modules`** (`PLAYWRIGHT_BROWSERS_PATH=0`, set by `scripts/playwright.mjs`). On this machine Chromium fails to start from `%LOCALAPPDATA%\ms-playwright` with a Windows side-by-side error, which breaks extension tests; it starts fine from paths under Documents or Temp.
- **Git identity** set repo-locally to `Sadhman <sadhman3@gmail.com>`; change with `git config user.name/user.email`.
- **Demo app** is plain HTML/JS with a dependency-free Node server, so it never changes under the tests. Main origin `http://localhost:5173`, cross-origin widget `http://127.0.0.1:5174` (different host and port). Ports overridable with `DEMO_PORT` / `DEMO_XORIGIN_PORT`; tests can pass port 0.
- **Demo app identity:** a fictional accounts-payable tool called "Ledgerline". The "create invoice" flow is the canonical recording.
- **Planted sensitive values** are fictional but pass their checksums (Luhn card, TFN, ABN mod-89, IBAN mod-97); listed in `fixtures/demo-app/planted-secrets.json`.
- **Visual identity:** teal accent (`#0f6b62` light / `#4fbfb2` dark) on warm neutrals, Segoe UI Variable. Tokens in `packages/ui/src/tokens.css`. Original, not derived from any other product.
- **Strings:** every user-facing string lives in `packages/ui/src/strings.ts`.
- **Desktop app scaffolding moves to M6** rather than an empty package in M0, to avoid stub code; the .NET SDK is also not yet installed.
- **Extension icon** is deferred to M2 with the capture UI; Chrome shows its default icon until then.
- **CI:** one workflow, matrix `windows-latest` + `ubuntu-latest`: lint, build, typecheck, unit tests, e2e.
- **Keep clones at short paths.** Windows' 260-character path limit breaks Vitest when the repo sits deep (pnpm's `.pnpm` folder names are long). The current location is fine; long-path support can be enabled by an admin (`LongPathsEnabled`) if ever needed.

## M1

- **Zod 4** for schemas. Guide schema adds one field beyond the brief: `updatedBy` (who saved last), needed for "show who last edited" in shared libraries (L3).
- **Rich text** is `{ spans: [{ text, bold?, italic?, href? }] }`. Links must be `http(s):` or `mailto:`; rendering to HTML escapes everything.
- **Secrets are enforced by the schema:** a step input marked sensitive, or a sensitive variable, cannot carry a value, so it can never be serialised.
- **Step text** for sensitive fields: "Enter your password" when the field looks like a password/passcode/PIN, otherwise "Enter **<field name>**". Unchecking is "Uncheck **X**"; radios are "Select **X**".
- **Selector formats:** `testid` = attribute value (any of data-testid/-test-id/-test/-qa/-cy); `aria` = `role "name"`; `label`/`text` = plain text; `css` built only from stable attributes and structure (never IDs or classes); `xpath` = positional path from the document or shadow root.
- **Matcher confidence:** testid 0.97, role+name 0.92, label 0.88, text 0.78, CSS 0.62, XPath 0.45, neighbourhood ≤ 0.5; ambiguous or wrong-tag hits are fallbacks only. Closed `<dialog>` and `[hidden]` subtrees count as invisible by default; browser callers can pass a layout-aware visibility check.
- **Matcher tests** run against real Chromium DOM snapshots of the demo app (`pnpm snapshot:demo`), loaded into happy-dom; shadow roots are stored as `<template data-tm-shadow>` because happy-dom lacks declarative shadow DOM. Each page is captured twice so IDs/classes differ between "describe" and "find".
- **Storage:** one `GuideStore` interface; `IndexedDbStore` (takes an `IDBFactory`) and `FolderStore` (takes a small `FileSystem`; Node implementation at `@trailmark/core/node`). Trash = `<root>/.trash/<id>/`; folders in `<root>/folders.json`; versions capped at 50; sidecar file names use a slug of the user name.
- **Windows file locking:** the Node file system retries renames on EPERM/EBUSY/EACCES with backoff (OneDrive/antivirus).

## M2

- **Host access is optional** (`optional_host_permissions: <all_urls>`), requested by the side panel's Start button. The capture content script is registered at runtime for the granted origins only; nothing is injected outside a capture.
- **e2e build** (`wxt build --mode e2e`, output `chrome-mv3-e2e`) adds `host_permissions: <all_urls>` (the state after the user grants access) and a `__trailmark` test hook in the service worker. Release builds contain neither; a test checks the release manifest.
- **Screenshot timing:** the page hides Trailmark's toolbar on pointerdown, asks for the screenshot after the next paint, and sends the event at once (the page may unload right after). The background pairs them by id and waits up to 500 ms for a screenshot that is on its way. Under heavy CPU load a picture can occasionally show the page just after the click.
- **Rate limit:** at most one capture per 520 ms (Chrome allows 2 per second). Skipped captures reuse the previous step's image (`reusedFromStepId`).
- **Images:** full screenshot as WebP (quality 0.9; PNG if WebP encoding is unavailable) plus a 320-px-wide thumbnail, named `<stepId>.webp` / `<stepId>.thumb.webp`. Crop and zoom are stored as metadata, not a second image; maximum auto-zoom 2×. All human-layer rects are in image pixels.
- **Live Blur** blurs elements on the page itself (inline `filter: blur(8px) !important`) while capturing, so secrets never reach a stored pixel. Blurs are removed when the capture ends.
- **Typing** is recorded when committed: change event, Enter, Tab, focus leaving, a click elsewhere, or the user switching tab (the background asks the old tab for pending typing and orders it first). Value changes made by scripts count (frameworks and test tools set values that way); clicks and keys must be trusted user input.
- **Key steps:** Enter, Esc, Tab and modifier shortcuts. Enter in multi-line fields is a new line, not a step; Tab right after typing is implied and skipped.
- **Merges:** click into a field + typing → one Type step; dropdown click + choice → Select; checkbox click + change → one Check; both clicks of a double-click → one Double-click.
- **First step** of a new capture is "Go to <site>" with a screenshot of the starting page. Direct navigations (address bar, back/forward) add "Go to" steps; navigations caused by recorded clicks do not.
- **New guide title** defaults to the page title at capture start; renamed in the library.
- **Library** is a full extension page (`library.html`, hash routes `#/` and `#/guide/<id>`); the side panel shows Start, status, the last 5 guides and a link to the library. Shared Preact components live in `packages/ui` for reuse by the desktop app.
- **While recording, the side panel lists the capture's steps**, newest last, each with its number, text, screenshot (as readers see it: highlight and zoom) and a delete button; the controls stay at the top. The on-page toolbar shows the step just recorded for 3 s.
- **Capture more:** the guide view stores the request (guide, position) in session storage and opens the side panel; Start then records into the active tab and inserts at that position.
- **Controller** uses an open shadow root (tests can reach it; styles stay isolated) and plain DOM rather than Preact, to keep the content script small.
- **Extension icon:** an original design (dotted trail to a map pin on a teal tile), rendered from `apps/extension/assets/icon.svg` by `pnpm make:icons`.
- **e2e workers:** 2 locally, 1 on CI; recording tests take real screenshots, and parallel browsers on small machines skew timing.

## M3

- **Editing operations** live in `core` (`editor/ops.ts`, `editor/image.ts`) as pure functions, shared by both apps; undo/redo is a generic `History` of immutable guide snapshots (100 steps).
- **Opening a guide** goes to the editor (`#/guide/<id>`); the reader is at `#/guide/<id>/view`, and step links are `#/guide/<id>/step/<stepId>`.
- **Image edits are non-destructive:** crop, magnify, highlight box, blurs and annotations are metadata over the stored screenshot. The first edit keeps the captured screenshot in `human.original` (one schema addition) so "Reset to original" works. Exports (M4) burn blurs into the pixels.
- **Blurs** render as a Gaussian-blurred copy of the image clipped to each region (SVG), strength ≈ image width / 90.
- **Magnify** in the image editor always crops to the chosen zoom (1.25×–4×) centred on the highlight, unlike the auto-crop at capture time, which skips large targets.
- **Re-capture** keeps blurs (they protect data) but clears the highlight box and annotations, whose positions belonged to the old picture.
- **Merge** joins titles as "A, then b" and keeps the first step's action, target and screenshot. **Split** cuts the title at a word boundary near the middle; the second part becomes a manual step sharing the screenshot.
- **Autosave** 0.6 s after the last change; a version is kept on the first save of a session, at most every 2 minutes after that, when leaving the editor, and before restoring a version.
- **Text fields own their content while focused** (rich-text and plain), and all edits apply to the latest guide, so fast typing never loses characters or resets the caret.
- **Keyboard and paste** are handled on the document while the editor is open, so shortcuts work wherever focus is.
- **Compact view** hides screenshots and descriptions so long guides can be reordered by dragging; Alt+↑/↓ and Move up/down also reorder.
- **Branding fonts** are system fonts only (Segoe UI, Calibri, Arial, Verdana, Georgia, Cambria): nothing is downloaded. The logo is stored as a guide image.
- **Rich text** pastes as plain text; links are limited to http(s) and mailto; rendered HTML goes through DOMPurify with a strict allow-list.
- **Screenshot timing (revised):** the page hides the toolbar, waits two frames, then asks for the screenshot, sending the input time. `captureVisibleTab` takes 50–80 ms (up to ~350 ms under load), so if the tab committed a new page after the input, the capture is discarded and the step reuses the previous screenshot (same page, moments earlier). Tests check both that the sign-in step shows the sign-in page and that the toolbar is never in a screenshot.
- **Sample guides** are recorded from the demo app by `pnpm make:samples` and committed as `apps/extension/public/samples/*.trailmark`; they are imported on first install, and from the empty library on request. Test profiles skip the automatic import.

## M4

- **Exporters live in `core`** (`src/export/`, entry point `@trailmark/core/export`) and take finished pictures as input, so they run in the browser, Electron and Node tests alike. The extension loads them on demand (a ~0.9 MB chunk with pdf-lib and docx).
- **Pictures are flattened in the UI** (`packages/ui/src/export/flatten.ts`) on a canvas: crop when magnified, blurs, highlight box and annotations are burned into a PNG, at most 1600 px wide. Exported files never contain the unblurred pixels.
- **One format for exported pictures:** PNG. PDF (pdf-lib) and Word accept only PNG/JPEG, and lossy JPEG blurs small screen text.
- **Reader-facing export text** ("Step 3 of 17", "Before you start", tone names, months) lives in `core/src/export/labels.ts`, next to the step-text writer; UI text stays in `ui/strings.ts`.
- **Branding constants** (`BRAND_FONTS`, `textOn`, accent and highlight colours) moved to `core/src/branding.ts` so exporters and the UI share them.
- **No "Made with Trailmark" footer** in exports: the brief rules out watermarks.
- **Dates in exports** are UTC ("9 October 2026"), formatted without `Intl`, so output is identical on every machine (golden files depend on it).
- **PDF:** A4, cover page then steps; built-in Helvetica (or Times for the Georgia and Cambria brand fonts), because pdf-lib cannot embed system fonts without shipping font files. Characters those fonts lack become close ASCII stand-ins (→ becomes ->). Page numbers on every page after the cover.
- **Word:** A4, Title and Heading 1 styles, steps as a real numbered list, the brand font name as the document font, callouts as shaded paragraphs with a coloured left border, "Page X of Y" fields in the footer.
- **Markdown:** steps are "**3.** Title" paragraphs (not a Markdown list, which breaks around images); callouts are quoted "**Tip:** …" lines, which every Markdown viewer shows.
- **HTML page:** no scripts at all and a Content-Security-Policy of `default-src 'none'`; contents sidebar, Previous/Next links, deep links `#step-N` (by step number), `:target` highlight, dark mode by `prefers-color-scheme`, print styles that hide navigation.
- **Embed card:** one step at a time using CSS `:target` and `:has()` (no scripts, so it works where scripts are blocked); headings and callouts show above the step they precede.
- **Copy HTML** writes `text/html` (inline styles, pictures as data URIs 600 px wide) and `text/plain` in one clipboard item, started inside the click so the browser allows it.
- **Save to shared folder** uses the File System Access API; the chosen folder is remembered (IndexedDB) and writes the web page, the embed card and the `.trailmark` file named after the guide title, so saving again overwrites them. Renaming a guide writes new files beside the old ones.
- **Print view** is a library route (`#/guide/<id>/print`) showing the reader with a Print button; the browser's print dialog also offers "Save as PDF".
- **Export file names:** `<title>.pdf`, `.docx`, `<title> (Markdown).zip`, `.html`, `.embed.html`, `.trailmark`; unsafe characters become spaces.

## M5

- **One guidance engine** (`apps/extension/lib/guidance.ts`) runs both Guide Me and Run for me, one session at a time, following the active tab. Its state persists in session storage; after a worker restart Guide Me carries on and Run for me waits, paused.
- **A second runtime content script** (`guide.js`) shows Guide Me, Run for me, notes and pins. It is registered for the sites the user has granted (persisting across restarts) so pins and notes appear on page load; without website access nothing runs. It stays idle until there is something to show.
- **Steps go to the frame they were recorded in** (matched by frame URL). For a step inside an iframe the top frame first scrolls that iframe into view, because a cross-origin frame cannot scroll its parent.
- **Guide Me moves on** when the person acts on the highlighted element (click, committed typing, choice, key, hover), or on "I did this". In Guide Me, secrets and uploads are highlighted like any step; only steps with nothing to point at are "manual".
- **Run for me uses page events** (pointer and mouse events, `click()`, the native value setter plus input/change events, `requestSubmit` for Enter). There is no `debugger` permission and no trusted input, so the few apps that ignore synthetic events need the person, and the step becomes "do it yourself". The page replies before acting, because the action may replace the page.
- **Run for me always stops** for confirm steps, manual and desktop steps, passwords and other secrets (never stored, so never typed by Trailmark), file uploads, missing targets and failed expectations. Speeds: slow 1.4 s, normal 0.7 s, fast 0.25 s between steps; "Pause after each step" gives step-through.
- **Run values** are asked once at the start for inputs set to "ask" or tied to a variable. They live only in the session (memory and session storage), never in the guide.
- **Overlays inside modal dialogs:** a modal `<dialog>` makes everything outside it inert, so Trailmark's on-page card and the capture toolbar move inside the topmost open modal dialog while one is open.
- **Card placement** tries below, above, right and left of the target. In a frame too small to fit it without covering the target, the card is hidden (the side panel still shows the step).
- **Notes and pins** are "page marks" kept in extension storage (`marks`), tied to a page (origin + path) and optionally to an element (a recorded target) or an iframe. Note text accepts **bold**, _italic_ and links written Markdown-style. A note may also hold a guide; a pin is a mark whose job is to open a guide.
- **Guidance switch** (side panel and Settings) hides notes, pins and Discover suggestions on pages. Guide Me and Run for me still run when someone starts them.
- **Discover** lists guides whose recorded sites include the active tab's origin, newest first.
- **Comments and reactions** live in per-user sidecars (`comments.<user>`), merged for reading. People can delete only their own. Reactions: 👍 🎉 ❤️ 👀 ❓.
- **Analytics** live in per-user sidecars (`analytics.<user>`): a view count and the last 500 runs (mode, furthest step, completed). Insights shows views, runs by mode, completions, people, and a funnel of how many runs reached each step. Nothing leaves the machine.
- **User name** (Settings, default "Me") labels comments and names the per-user files.
- **On-device AI** uses Chrome's Prompt API (`LanguageModel`), `Summarizer` and `Translator` when present. It is off by default in Settings, and each tool is hidden when its API is unavailable. Suggested step text is reviewed before it is applied; a summary replaces the description only on "Use"; translation makes a copy tagged with the language code and assumes English source text.
- **Settings so far:** your name, Guidance on/off, on-device AI on/off. The rest of section 8 comes with M6 and M9.

## M6

- **No .NET SDK needed:** the two Windows helpers (`apps/desktop/native/*.cs`) are C# 5 compiled by the `csc.exe` that ships with Windows (.NET Framework 4.x); UI Automation comes from the framework's WPF assemblies.
- **uia-helper.exe** speaks line-delimited JSON on stdio. Its capture hooks: a low-level mouse hook that copies the screen before the click is let through, a keyboard hook that reports only named keys and shortcuts (never characters; just "typing happened"), and a foreground-window event. Values are read from the focused control when typing is committed, never from password controls.
- **Desktop screenshots show the clicked window** (plus its owner, so a menu or dialog keeps its app around it), clipped to that monitor; a maximised window fills the monitor. Other apps on the screen stay out of guides.
- **Typing in a desktop app ends** on Enter (single-line), Tab, a click elsewhere, finishing, or switching to another app (foreground event, with a focus check every 400 ms as a backup because Windows does not always send the event).
- **Bridge:** Chrome native messaging to `trailmark-host.exe` (`com.trailmark.host`), which relays to the app over the named pipe `\\.\pipe\trailmark-<user>`. Messages over 700 000 characters are split into parts (Chrome's limit towards the extension is 1 MB). Registered per user in HKCU for Chrome, Chromium and Edge; the extension ID is fixed by the manifest `key` (`apps/extension/extension-key.json`).
- **Shared capture:** when the extension is recording, desktop steps are sent to it and its recorder stays the guide's only writer; browser windows are skipped by the desktop hooks then (the extension records them with far better detail). With no extension capture, the desktop app records into its own library.
- **Mixed guides in Guide Me:** the extension conducts; a desktop step is shown by the desktop app's overlay (G8) and the side panel says to do it in the desktop app. A desktop-only guide runs from the desktop app.
- **Desktop overlay (G8):** a transparent, click-through, always-on-top window excluded from screen capture; only the step card takes the mouse. It moves on when the person clicks inside the ring, or types there and then presses Tab or Enter or clicks elsewhere.
- **Libraries in the desktop app:** "My library" (default `Documents\Trailmark\Library`) and an optional "Team library" folder, such as a synced OneDrive or SharePoint folder. Guides record who saved them last ("Edited by …").
- **Read-only guides (L6):** a flag on the guide, set by its author in the team library. Others see the reader with "Edit a personal copy", which copies it into their own library without the flag. Anyone with access to the shared folder can still change its files; the flag is a convention, not a lock.
- **Guides in the desktop library from the browser:** with the desktop app installed, the extension can keep its guides in the desktop library (asked once, changeable in Settings); otherwise it keeps them in the browser.
- **Secure Blur (E11) on web steps** uses the position of every word on screen, saved with each screenshot as `<picture>.words.json` (top frame only; values of ordinary inputs included, secret fields never). Steps without a word file (desktop, uploaded, iframe-only or older steps) are listed as not checked; OCR covers them from M8.
- **What Secure Blur finds:** emails; phone numbers (Australian mobiles and landlines, 13/1300/1800 numbers, international +…); card numbers passing the Luhn check; BSBs written `123-456` (or any 6 digits after the word "BSB"); account numbers (6–10 digits) only next to the word "account"; TFNs and ABNs passing their check digits; IBANs passing mod 97. Dollar amounts and a list of people's names are optional; the names list is remembered in this browser only.
- **Nothing is blurred without review:** the review screen shows each find outlined on the screenshot and masked to its last 4 characters, all ticked, and adds blur regions only for the ticked ones. Running it again skips regions already blurred.
- **Installer:** electron-builder NSIS, per user (no admin rights, `%LOCALAPPDATA%\Programs\Trailmark`), with a choice of folder. It registers the browser bridge by running `Trailmark.exe --register-native-host`; uninstalling runs `--unregister-native-host` and also deletes the registry keys and host manifest itself. Guides and settings are kept. The installer is not code-signed (no certificate), so Windows SmartScreen may warn.
- **Everything the app runs is bundled** by Vite into `dist/`; the installer ships no `node_modules`.
- **Desktop e2e tests drive the real mouse and keyboard**, so they only touch a Notepad window they opened on a uniquely named file. The helper refuses input unless that window is in front and refuses clicks unless the pointer is over it; the tests close only the processes they started; a lock file stops two desktop tests from ever running at once. They run only through `pnpm e2e:desktop`, never in `pnpm e2e`.

## M7

- **The procedure** (`core/src/agent/procedure.ts`) is the one agent-readable form of a guide. It holds:
  - steps with their section, the callouts before them, the target (role and name first, then every selector, sorted by score), the input, expectations, failure rule, confirm flag and timeout;
  - variables;
  - no screenshots and no secret values.

  Secrets, and values asked for every run, become variables. A password field gets a sensitive variable named after its label (`{{password}}`).

- **Failure rule:** a step's `onFailure` defaults to "The procedure stops here…". The embedded text describes the procedure and never addresses whoever reads it.
- **Agent Pack** (Share → Agent Pack), a zip with one folder named after the guide:
  - `SKILL.md`: frontmatter `name` and `description`, then sections and numbered steps, with a **CONFIRM** marker where relevant;
  - `references/procedure.json`;
  - `assets/screenshots/step-NN.png`: blurs burned in; can be turned off;
  - `scripts/replay.spec.ts`.

  `name` is the title as lowercase words joined by single hyphens (at most 64 characters). `description` says what the procedure does and "Use when asked to …" (at most 1024 characters). If SKILL.md would reach 500 lines, each step gets one detail line instead. `validateAgentPack` checks the Agent Skills rules in tests; `skills-ref` was not installed on the build machine.

- **Embedded copies (U3):**
  - HTML: a `<script type="application/json" id="trailmark-procedure">` data block. It never runs, and the page's CSP allows no scripts.
  - Markdown: a closed `<details><summary>Agent procedure</summary>` block with fenced JSON at the end.
  - Word: `customXml/item1.xml` (namespace `urn:trailmark:procedure:v1`) with its properties part and relationships.
  - PDF: an attached `procedure.json`.

  Each also shows the line "Agent-readable procedure embedded (Trailmark schema v1)." The embed card and clipboard HTML carry no copy, because they are fragments for other pages.

- **Input modes (U4):** Fixed text, Ask every run, or Ask with this as the default.
  - The default for new guides is in Settings (extension and desktop app); the default for one guide is in its Agent view.
  - "Ask" and "default" make the value a named variable, called after the field ("Invoice no." → `{{invoice_no}}`), keeping the recorded text as its example or default.
  - Back to Fixed drops the variable when no other step uses it.
  - Marking a value sensitive deletes the recorded value from the step, its title and its variable, and cannot be undone.
  - Values that look like numbers, dates, IDs (letters and digits) or emails get the suggestion "Ask every run".
  - Guide Me says "Type the value for this case" or "Suggested value: …".
  - Trailmark refreshes a step title it wrote when the mode changes; a title the author wrote is kept.
- **Confirm flags (U5)** are set at capture on buttons, links, menu items, options and tabs (and the same Windows control types) whose name contains submit, send, delete, remove, approve, post, pay, publish, finalise/finalize or confirm, as a whole word. They can be changed per step in the Agent view.
- **Captured expectations (U6):**
  - For clicks, double clicks, keys, choices and checkboxes in the top frame, the page notes its address, open dialogs, headings, and alert and status messages. It looks again 800 ms later and records up to three changes, in this order: new address; dialog opened or closed; new message (its first line); new heading, unless it repeats a dialog's name.
  - If the page is replaced within 3 s, the new address is recorded from the background.
  - For a step inside an iframe, both the iframe and the top page are observed. Changes inside the iframe (dialogs, messages, headings) are marked "inside the step's iframe" and are checked there; the address is the top page's.
  - Addresses are regular expressions on the path (`/app/$`); Run for me and the replay test them as such, and as plain text if they are not valid expressions.
  - Run for me checks expectations up to 4 times, 750 ms apart.
  - In the Agent view, expectations can be removed, and "text appears" expectations added.
- **Agent view (U1)** is a third editor tab (Edit · Preview · Agent). It lists:
  - warnings: no stable selector (no role and name, and no selector scoring 0.6 or more), visual only, no element details, looks irreversible but not confirmed, fixed value that looks like data;
  - each step's target and the ways to find it, the typed value, expectations, failure rule, wait time and confirm flag.
- **Playwright replay (U10):**
  - Elements are found by role and name, then label, text, test id, placeholder, and CSS or XPath last. iframes are reached with `frameLocator`; open shadow roots are pierced by Playwright itself.
  - Variables come from `TM_<NAME>` environment variables, with the example or default as fallback; sensitive ones are required. A file for an upload step comes from `TM_FILE_STEP_<n>`.
  - Desktop and manual steps are noted as annotations.
  - Confirm steps end the test, with an annotation, unless `TRAILMARK_ALLOW_CONFIRM=1`.
- **Sample guides** are recorded again with these features: "Submit invoice" asks for confirmation, and its expectations (address, dialog closing, "Invoice submitted") come from the capture.

## M8

- **OCR engine:** tesseract.js 7 with the LSTM engine and the compact English model (`4.0.0_best_int`, 2.9 MB). `scripts/copy-ocr.mjs` copies the worker, the three core builds (plain, SIMD, relaxed SIMD; the worker picks the one the machine supports) and the model into each app at build time: `apps/extension/public/ocr/` and `apps/desktop/src/renderer/public/ocr/`. Both folders are gitignored, and together the files add about 15 MB to each app. Paths are always given explicitly, so the library's CDN defaults are never used, and the model is not cached in IndexedDB.
- **WebAssembly needs `'wasm-unsafe-eval'`** in the extension pages' CSP and the desktop renderer's CSP (plus `worker-src 'self'`). It allows compiling WebAssembly only; JavaScript `eval` and `new Function` stay blocked, and lint still forbids them. Content scripts never load OCR.
- **OCR runs only in pages that need it:** the editor and Secure Blur. The engine loads on first use, and pictures narrower than 2000 px are enlarged 2× first, because small screen text reads far better that way. Boxes are scaled back to picture pixels.
- **Text for visual-only steps (U8):** when a guide opens in the editor, each visual-only step with a screenshot and an Action Box, but no `ocrText`, gets the text around its action. It is read from an 840 × 360 px region around the box, keeping the lines that touch the box first, then the nearest ones within 160 px, up to 200 characters. Each step is tried once per editor session, in the background, and the text is saved as one edit. The procedure, the Agent Pack ("near the text …") and the Agent view carry it.
- **Secure Blur on desktop and image steps (E11):** a picture without saved word positions is read with OCR when Secure Blur runs, with progress shown as "Reading the text in screenshot N of M". The result is saved as that picture's `.words.json`, so the next run needs no OCR. The finds and the review screen are the same as for web steps. Only a picture that cannot be read is listed as not checked.

## M9

- **Self-check (U7):** **Check every step** in the Agent view opens the guide's first page in a new tab. For each web step it goes straight to the step's recorded page when the tab is elsewhere, looks for the element for up to 3 s, and rings it; it never clicks or types. Each step is reported as:
  - **found**, with how (role and name, label, CSS…);
  - **found, but similar elements exist** (ambiguous);
  - **not found**;
  - **not checked** (desktop steps, steps done by hand, steps with no element details).

  Elements that only appear after an earlier action, such as a dialog's buttons, are reported as not found, because a dry run cannot open them. The tab stays open on the last page. The check needs website access and runs only in the extension.

- **Guide health (U9):** when Guide Me or Run for me cannot find a step's element, the side panel offers **Re-capture this step**. Guidance stops and a capture starts in that tab, set to replace the step. When the person does the step:
  - the new step takes the old one's place;
  - the old step's pictures are deleted, unless another step still shows them;
  - the capture ends by itself 1.5 s after the last event;
  - guidance carries on from the step after.

  Cancelling the capture leaves the guide as it was.

- **Settings (section 8):**
  - Extension: colours (system, light or dark), Live Blur on at start, zoom on each step's action (none, a little, medium, close; medium = 2× as before), picture quality (high = WebP 0.92, standard = 0.8), a link to Chrome's shortcut page, and **Delete all Trailmark data**. Deleting stops any capture or guide, clears extension storage and deletes the guide database; other open Trailmark pages let go of the database on their own.
  - Desktop app: colours, plus the existing library folders and default input mode. It has no delete-all, because its guides are ordinary folders the person manages in File Explorer.
  - Language: English only for now, so there is no language setting. Every string is in `strings.ts` and `export/labels.ts`, ready for translation.
  - Branding is set per guide, and the export options are in the Share dialog, so neither has a global default.
- **Performance:** pictures are encoded as soon as Chrome returns them, alongside the event's processing rather than after it. Word positions and page-state snapshots are read after the screenshot request has gone out, so they never delay the picture.
  - A 68-step guide with pictures: the editor opens in about 1.4 s, there are no long tasks while scrolling, and the Agent view and reader each render in about 0.4 s (`e2e/performance.spec.ts` enforces limits).
- **Capture toolbar:** each screenshot's hide is matched by one release once that picture is taken. The toolbar comes back only when no picture is pending; a 5 s timer is a safety net.
- **Release:** `pnpm release` builds everything and writes three files to `dist/`: `trailmark-extension-<version>.zip` (the release build, checked to request no website access at install), `trailmark-extension-<version>-chrome-web-store.zip` (the same build for the Chrome Web Store: manifest at the top, no `key`), `Trailmark-Setup-<version>.exe` and `SHA256SUMS.txt`. Version 1.0.0.
- **Chrome Web Store (owner's decision, 12 Oct 2026, replacing the brief's "don't publish"):** the owner publishes it themselves, unlisted at first, so it installs without Developer mode where companies allow store extensions. Listing text, permission reasons, privacy policy and images are in `docs/webstore/` (`pnpm store:images` renders the images). The store assigns its own ID; once known it goes in `extension-key.json` as `webstoreId`, and the desktop app's native host then accepts both IDs.
- **Name (13 Oct 2026):** "Trailmark" is already taken by another Chrome Web Store extension, so the owner chose the placeholder "ABCXYZ" until a final name is picked. `product.json` holds the display name; `pnpm rename "<Name>"` (scripts/rename-product.mjs) replaces it as a whole word. An existing `Documents\Trailmark\Library` keeps being used.

## Polish

- **Design screenshots:** `pnpm design:shots` (Playwright project `design`) saves every main screen in light and dark to `docs/design/after/`; `DESIGN_OUT=before` writes the baseline.
- **Rename to ShowSteps (P1):** kept names so existing data survives: the IndexedDB databases (`trailmark`, `trailmark-ui`) and `localStorage` keys (`trailmark:*`). Compatibility: the import picker accepts `.trailmark`; readers accept `trailmark-procedure`; the desktop app removes the old `com.trailmark.host` keys when it registers, and the uninstaller removes them too. The history above keeps the old names. `pnpm rename` and `product.json` are gone now that the name is final.
- **Library folder move:** on first run, only `Documents\Trailmark\Library` (or `ABCXYZ\Library`) moves to `Documents\ShowSteps\Library`, with `MOVED_TO_SHOWSTEPS.txt` left in the old folder. The rest of the old folder stays (the owner keeps the unpacked extension there). If the move fails, the old library keeps being used. Tests and `SHOWSTEPS_LIBRARY` skip the move.
- **Font over web pages:** the toolbar, step toast and Guide Me use the system interface font (Segoe UI Variable on Windows), not Funnel Sans: content scripts load in every frame of every recorded page, and inlining the font made each one 45% larger and capture measurably slower. Extension pages, the desktop app and exports use Funnel.
- **Guide Me tooltip:** Back and Skip as ghost buttons plus a pink "I did this" button (the plan's separate "Next" did the same as "I did this"). Run for me keeps its speed control and Pause in the side panel; on the page, confirm steps use the alert style with "Confirm and continue".
- **Recording dot:** steady on the page toolbar; it pulses only in the side panel. Any animation in the toolbar kept the recorded page busy and made screenshots and clicks late under load (e2e caught it, even with three pulses).
- **Brand fonts:** Hanken Grotesk ExtraBold comes from the static Fontsource WOFF (opentype.js cannot pick a weight from a variable font); Instrument Serif Italic is static already. Both live in `brand/fonts` with their OFL licences and are used only to draw paths.
- **Favicons:** the library, side panel and desktop windows use the small mark. HTML exports get no favicon: exports stay unbranded (section 6.8 of the plan wins over section 3's favicon list).
- **Side panel empty "Guides for this site":** one muted line, not a pattern band: the band would push Start and the recent guides below the fold in a 400 px panel. The library's empty state has the band.
- **Step title weight:** 500 rather than 600, with bold words at 750: at 600 the whole title already counts as bold, so bold names of buttons and fields would not stand out (and Ctrl+B would remove bold instead of adding it).
- **Editor menu:** Compact view and (desktop) Read-only sit in the ⋯ menu as checkable items, next to Version history, Secure Blur, Branding and Keyboard shortcuts. The guide title moved into the top bar.
- **Image editor size:** stays full-window rather than a 720 px dialog: editing a 1280 px screenshot in 720 px would make the tools imprecise.
- **Export fonts:** `pnpm export-fonts` cuts Funnel to Latin text and one weight each (WOFF2 for HTML, ~11 KB each; TrueType for PDF and Word, ~26 KB each) into `fonts.generated.ts`. Funnel has no italic, so italic runs in PDFs use the upright face. Guides branded with another font keep that font (Times for serif branding in PDFs, Helvetica for other sans).
- **Word fonts:** Funnel Sans and Funnel Display are embedded in the .docx (Word's font embedding), so the document looks the same on machines without them.
- **Agent instructions (owner request):** packs and repo notes are written for two kinds of agent: browser automation (Playwright, Playwright MCP, the GitHub Copilot coding agent) and computer use (screenshots and pointer). Each procedure step carries `screen`, the target's box as fractions of the recorded screen. The rules are worded as descriptions of the procedure, never as orders to the reader.
- **Desktop splash screen:** none. The app opens in about a second, so a splash would only add a delay; the Ripple band and lockup appear in the About dialog.
- **Licences shipped:** `pnpm notices` writes `licenses/NOTICES.txt` (ShowSteps's licence, the fonts' SIL OFL and every bundled package's licence and NOTICE file) into the extension and the desktop app; the About dialog links to it.
- **GitHub (14 Oct 2026):** pushed as a **private** repository with a draft v1.0.0 release, not public: a name search found ScreenSteps, an established product in the same market with a pending US trademark application, and the owner asked to avoid legal risk. Going public is one command once the owner has decided on the name.
- Polish: the desktop app cancels every http(s)/ws(s) request from its own session (`webRequest.onBeforeRequest`), so neither the app nor Chromium's background features (spell-check dictionaries) reach the network; links still open in the default browser. The extension uses only `storage.local`/`storage.session`, never `storage.sync`. Install steps live in docs/INSTALL.md.
- **Licence:** PolyForm Noncommercial 1.0.0 (owner request: free to download and use, not commercially), replacing MIT before any public release. The SPDX id is in every package.json; the About dialog, README and store listing say the same.
- **Promo video:** `docs/promo/motion.html` is a 21-second Web Animations timeline using the real tokens, fonts and logo; `pnpm motion` steps it frame by frame (30 fps) and encodes WebM with Playwright's ffmpeg, and MP4 with Chromium's H.264 recorder fed the same frames on a canvas, rewritten from fragmented to plain MP4 so players show the right length.

## Update 1.1: schedules

- **Milestone gate:** `pnpm e2e` runs with two workers; a test that fails only on timing while the machine is busy is re-run alone (`--workers=1`) and counts as passing if it passes there. Real failures are fixed before the commit.
- **Schedule times** are local wall-clock times in the computer's time zone (via `Intl`). A time skipped when clocks go forward runs the same distance past the change (02:30 on Sydney's October change day runs at 03:30); a time that happens twice when clocks go back runs once, at the first.
- **Skip dates** apply to every repeat type and are also not business days.
- **`{last_business_day}`** is the business day before today (Monday to Friday, minus the schedule's skip dates), so on a Monday it is the previous Friday.
- **Placeholders** are lower-case words in braces; `{ABC}` or other text in braces is typed as written. An unknown lower-case placeholder fails validation when the schedule is saved.
- **Date formats** understand `d`, `dd`, `M`, `MM`, `MMM`, `MMMM`, `yy` and `yyyy`; other characters are kept. Default `dd/MM/yyyy`.
- **Guide version** (for approvals) hashes each step's id, action, page, key, target, input and confirm flag in order. Edits to titles, descriptions, pictures and annotations keep approvals; anything that changes what is clicked or typed drops them.
- **Run log outcome** is absent while a run is going and set when it ends.
- **Sign-in check** compares host names (without ports): a sign-in-looking page on the step's own host is a missing element, not a sign-in stop.
- **Run logs** live in their own IndexedDB database, `showsteps-runlogs` (stores `runlogs` and `shots`), apart from the guide library, so deleting a schedule or all data can drop them without touching guides. Step pictures are JPEG at quality 0.7, at most 1280 px wide.
- **Alarms** are named `schedule:<id>` (the next run), `check:<id>` (an hour before, for Check first), `retry:<id>` (busy, every 2 minutes for up to 30), `wait:<runId>` (how long a stopped run waits) and `pending:<id>` (how long a guide with desktop steps waits to be started).
- **Missed runs:** a run due while Chrome was closed with "Skip" set is logged as `missed` with reason `closed`; a guide with desktop steps nobody started is `missed` with reason `not-started`; a run that couldn't start because the browser stayed busy is `skipped` with reason `busy`; a run going when Chrome closed is `stopped` with reason `interrupted` at the next start.
- **Switching a schedule back on** starts from that moment: runs due while it was off aren't caught up.
- **Run now** from the Schedules page runs like a scheduled run (its own window, unattended rules), except a guide with desktop steps, which runs with the person.
- **Run windows** are 1280 × 900, normal and unfocused. A completed run's window closes (unless Keep window open), and so does one stopped after its wait; a run the person stopped themselves keeps its window.
- **A scheduled run stays in the tab its window opened**, even when the site redirected it (to sign in, say); the first step takes it to the right page. It never follows tabs the person switches to in other windows.
- **Notifications** show only the guide's name and a step number, never typed values. Paused and "due" notifications stay until clicked. A click (or **Open**) brings the run window to the front; with no run going it opens the Schedules page. **Start** on a "due" notification starts the run.
- **The toolbar badge** is `!` in the alert colour after a stopped or failed run, until the Schedules page is opened. Completed, skipped and missed runs don't set it.
- **Sign-in stop:** the page shows "Sign in, then press Continue." across the top with a **Continue** button; the side panel shows the same line with **Continue**. Continue tries the current step again.
- **Demo identity provider** (tests): `http://127.0.0.1:5174/idp/` with an account tile (Alex Demo) and a **Sign in with Demo** button; with `?prompt=login` it shows a password form. The demo app's login page links to it ("Use single sign-on"); `/auth/callback` sets the `demo_session` cookie and `/auth/expire` ends it, after which `/app/` redirects to the provider's password page.

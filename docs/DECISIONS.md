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

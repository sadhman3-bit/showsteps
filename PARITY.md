# Parity and upgrades checklist

Copied from BUILD_PROMPT.md sections 5 and 6. Tick an item only when it is implemented **and** covered by an automated test or a manual test in `docs/MANUAL_TESTS.md`. Note the covering test after the item when ticking it.

## Part A: Tango feature parity

### Capture (extension)

- [x] C1 Toolbar icon opens the side panel with one clear **Start capture** button. Keyboard shortcut Alt+Shift+R starts and stops (`chrome.commands`, user-editable). _Tests: e2e/extension.spec.ts, e2e/library.spec.ts (side panel); MT-M2-1, MT-M2-2._
- [x] C2 On-page capture controller: small draggable toolbar, bottom-right by default, showing live step count, Pause/Resume, Delete last step, Live Blur toggle, Finish, Cancel. It is hidden from screenshots. _Tests: e2e/controller.spec.ts; MT-M2-4 (drag)._
- [x] C3 Click-to-create: clicks, double and right clicks, committed text entry (on blur, Enter or Tab, never per keystroke), selects, checkboxes and radios, file uploads (file name only), key presses (Enter, Tab, Esc, shortcuts), and navigations each become a step with auto-written text. _Tests: e2e/capture.spec.ts, e2e/controller.spec.ts, core test/capture.test.ts._
- [x] C4 One screenshot per step via `chrome.tabs.captureVisibleTab`, taken on `pointerdown` in the capture phase, before the page changes. A queue respects Chrome's limit of 2 calls per second; when a capture is skipped, reuse the previous image and mark `reusedFromStepId`. Store the full image, an auto-crop that magnifies the area around the action, and the Action Box. Handle device pixel ratio, page zoom, scrolling, iframes (content script in all frames, coordinates mapped through frame offsets) and shadow DOM (`composedPath()`). _Tests: e2e/capture.spec.ts (pointerdown timing, reuse, Action Box, iframes, shadow DOM); MT-M2-5, MT-M2-6 (DPR, zoom, scrolling)._
- [x] C5 Live Blur: while capturing, click elements to mark them blurred. Their regions are blurred in that and later screenshots while they stay on screen. _Tests: e2e/controller.spec.ts._
- [x] C6 Multi-tab: capture follows the active tab across tabs and windows in one session. _Tests: e2e/controller.spec.ts; MT-M2-7._
- [x] C7 Capture more: resume capture into an existing guide at a chosen position. _Tests: e2e/controller.spec.ts, e2e/library.spec.ts, extension test/recorder.test.ts._
- [ ] C8 Desktop capture on Windows with the same step model (section 7).
- [x] C9 Secrets: password and payment fields never recorded (section 1). _Tests: e2e/capture.spec.ts, core test/capture.test.ts, core test/schema.test.ts._
- [ ] C10 Cross-app guides: one guide can hold web steps and desktop steps (needs M6 bridge).

### Editor

- [x] E1 Edit guide title and description; step title (bold, italic, link), description and alt text. _Tests: e2e/editor.spec.ts (titles, bold, descriptions), e2e/library.spec.ts; alt text MT-M3-3._
- [x] E2 Step list: drag to reorder, multi-select, delete several, duplicate, insert blank step, insert heading, insert callout (Tip, Note, Warning, Alert), merge two steps, split a step. _Tests: e2e/editor.spec.ts (drag, multi-select, duplicate, delete, insert, merge, split), core test/editor.test.ts._
- [x] E3 Headings act as sections and drag like steps. _Tests: e2e/editor.spec.ts (heading drag), core test/editor.test.ts (sections)._
- [x] E4 Image editor: crop, magnify toggle and zoom level, move and resize the Action Box, blur rectangles, bulk blur (apply a region to several screenshots at once), annotations (arrow, rectangle, ellipse, text, freehand pen, numbered badge), colour picker, undo and redo, replace image (upload, paste or re-capture), reset to original. _Tests: e2e/editor.spec.ts (blur, bulk blur, annotations, colour, magnify, undo, delete, reset); MT-M3-1 (replace, paste, re-capture)._
- [x] E5 Image-only steps from upload or clipboard paste. _Tests: e2e/editor.spec.ts (upload); MT-M3-2 (paste)._
- [x] E6 Keyboard: Tab through steps, Ctrl+Z / Ctrl+Y, Delete, Ctrl+D duplicate, Ctrl+Enter new step, `?` shows a shortcut sheet. _Tests: e2e/editor.spec.ts (Ctrl+Z/Y, Ctrl+Enter, ?), MT-M3-3._
- [x] E7 Preview mode showing exactly what a reader sees, with copy-link-to-step (deep link in the library; anchor in exported HTML). _Tests: e2e/editor.spec.ts (preview, copy link, deep link)._
- [x] E8 Branding: logo, accent colour and font, applied to viewer and exports. _Tests: e2e/editor.spec.ts (accent, font); MT-M3-4 (logo)._
- [x] E9 Autosave and version history: keep the last 50 versions per guide, view and restore any. _Tests: e2e/editor.spec.ts (autosave, view and restore a version), core test/storage.test.ts (50 versions)._
- [x] E10 Two sample guides ship with the app, built from the demo app. _Tests: e2e/library.spec.ts (sample guides)._
- [ ] E11 Secure Blur equivalent: one click finds and blurs sensitive data in all screenshots. Web steps use DOM text positions saved at capture; desktop and image steps use OCR (M8). Detect emails, phone numbers, card numbers (Luhn check), Australian BSB and account numbers, TFN, ABN, IBAN, and optionally dollar amounts and personal names from a user list. Always show a review screen before applying.

### Library (local workspace)

- [x] L1 Library home: grid and list views, nested folders, move, rename, Trash with restore and permanent delete, full-text search across titles and step text, sort, tags, filter by app or site. _Tests: e2e/library.spec.ts, ui test/filter.test.ts._
- [x] L2 Duplicate a guide; import and export a guide as a `.trailmark` file (zip of the guide folder). _Tests: e2e/library.spec.ts, core test/capture.test.ts._
- [ ] L3 Team library, local equivalent: point Trailmark at a synced shared folder (SharedFolderAdapter). Others with Trailmark and the same folder see the guides. Show who last edited.
- [x] L4 Comments and emoji reactions on steps and on the end of a guide, local equivalent: stored in per-user sidecars so a synced folder never conflicts. _Tests: e2e/pages.spec.ts (comment, reaction, per-user sidecar), core test/guidance.test.ts (merge, toggle); MT-M5-4._
- [x] L5 Analytics, local equivalent: views, Guide Me runs, completions and step drop-off per guide, from per-user sidecars, shown on a small dashboard. Nothing leaves the machine. _Tests: e2e/pages.spec.ts (views and Guide Me runs on Insights, funnel), e2e/guidance.spec.ts (completed run recorded), core test/guidance.test.ts; MT-M5-4._
- [ ] L6 Roles, local equivalent: a guide can be marked read-only in a shared folder; editing it makes a personal copy.

### Share and export (all free)

- [x] X1 PDF: cover with title and description, numbered steps with screenshots and Action Box, headings, callouts, page numbers, branding. Build with pdf-lib; in the desktop app, Electron `printToPDF` of the viewer is an acceptable alternative if it looks better. _Tests: core test/export.test.ts (opens with pdf.js: cover, steps, pictures, headings, callouts, page numbers), e2e/export.spec.ts (17-step sample: every title and picture); MT-M4-1._
- [x] X2 Word (.docx) with the `docx` library: real headings, numbered steps, images with alt text, callouts as shaded paragraphs. _Tests: core test/export.test.ts (valid XML, Heading 1, numbered list, alt text, shading; read back with mammoth), e2e/export.spec.ts; MT-M4-1._
- [x] X3 Markdown: `guide.md` plus `img/`, zipped. _Tests: core test/export.test.ts (golden file, zip contents), e2e/export.spec.ts (blur burned into the picture); MT-M4-1._
- [x] X4 HTML: one self-contained file (images inlined), with step navigation, deep links, dark mode and print styles. _Tests: core test/export.test.ts (golden file, no scripts, escaping), e2e/export.spec.ts (deep link, contents navigation, dark mode, print styles)._
- [x] X5 Copy HTML (Tango's "Magic Copy" equivalent): rich clipboard (`text/html` and `text/plain`) that pastes with images into Word, Outlook, OneNote, Teams, Confluence and Notion. Document any target that strips inline images. _Tests: e2e/export.spec.ts (text/html and text/plain on the clipboard with 17 pictures), core golden file; MT-M4-2 records which apps keep pictures._
- [x] X6 Embed, local equivalent: a compact "embed card" HTML export suitable for an iframe on a SharePoint page. Re-exporting to the same path updates the embed. _Tests: core test/export.test.ts (golden file), e2e/export.spec.ts (one step at a time, Next; saving again updates the same file); MT-M4-3._
- [x] X7 Print view. _Tests: e2e/export.spec.ts (print view, toolbar hidden in print); MT-M4-4._
- [x] X8 Share, local equivalent: "Share" offers file exports, Copy HTML, and "Save to shared folder". No hosted links. _Tests: e2e/export.spec.ts (Share dialog: downloads, Copy HTML, Save to shared folder twice), ui test/share.test.ts; MT-M4-3, MT-M4-5._

### Guidance

- [x] G1 Guide Me: from the library or viewer, open the first step's URL in a new tab (or stay if already there) and open the side panel with the step list. Spotlight the target with a tooltip; advance automatically when the user clicks it (or commits the input); Back, Next, Skip, "I did this manually"; resume across navigations and new tabs; works across apps and tabs; a switch turns Guidance off. _Tests: e2e/guidance.spec.ts (completes the 17-step demo flow by acting on each highlighted target, across pages, iframes, shadow DOM and a modal dialog), e2e/pages.spec.ts (start from a pin and from the reader; side panel step list), extension test/guidance.test.ts; MT-M5-1._
- [x] G2 Element-matching engine in `core`, shared by Guide Me, automation and replay: ranked strategies (test id, ARIA role and name, label, text, CSS, XPath, then bounding-box neighbourhood with nearby-text similarity), confidence score, `MutationObserver` waiting up to the step timeout, frames and shadow DOM. Unit tests against the demo app. _Tests: core test/matcher.test.ts (demo-app snapshots), e2e/guidance.spec.ts (live matching in every frame)._
- [x] G3 Discover: the side panel lists guides relevant to the current site (matched by step URLs) with one-click Guide Me. _Tests: e2e/pages.spec.ts (side panel lists the site's guides with Guide Me), core test/guidance.test.ts._
- [x] G4 Pins: pin a guide to a page or element; a small badge appears there; clicking it opens the guide or starts Guide Me. _Tests: e2e/pages.spec.ts (pin a guide to a page, badge, Open guide and Guide Me); MT-M5-3._
- [x] G5 Notes (Tango's "Nuggets" equivalent): sticky notes on an element or page (tip, warning or link, rich text), shown as a badge, read on hover or click, managed from a list, optionally holding a pinned guide. _Tests: e2e/pages.spec.ts (note on an element, tone, rich text, hover, list, delete), core test/guidance.test.ts; MT-M5-3._
- [x] G6 Run for me (Tango's browser-agent equivalent): execute a guide's web steps with a visible cursor; speed control; Pause and step-through; fills variables; always stops for `confirm` steps, `manual` steps and failed expectations. No LLM needed. _Tests: e2e/guidance.spec.ts (runs the demo flow, waits for the password, stops at the confirm step), extension test/guidance.test.ts (confirm, secrets, step-through, missing target), core test/guidance.test.ts (actions, values, expectations); MT-M5-2._
- [x] G7 On-device AI (optional, off by default): improve step titles and descriptions, write a guide summary, translate a whole guide into another language as a copy. Feature-detect each API; hide the controls when unavailable. _Tests: e2e/pages.spec.ts (hidden by default; improve, summarise and translate with stand-in APIs), core test/guidance.test.ts (prompts and copies); MT-M5-5 with real Chrome AI._
- [ ] G8 Desktop Guide Me: a transparent, click-through, always-on-top overlay highlights the target's bounding rectangle from UI Automation and advances when the user clicks inside it.

## Part B: Upgrades

- [ ] U1 **Agent view in the editor:** a tab showing per step what an agent reads (target strategies, expectations, failure rule, confirm flag) with warnings, e.g. "Step 5 has no stable selector" or "Step 9 is visual only".
- [ ] U2 **Agent Pack export** in the open Agent Skills format:
  ```
  <guide-slug>/
    SKILL.md                     # frontmatter: name, description; then steps
    references/procedure.json    # full structured steps, no screenshots or secrets
    assets/screenshots/          # optional
    scripts/replay.spec.ts       # Playwright replay of web steps
  ```
  `name`: lowercase letters, digits and single hyphens, at most 64 characters, matching the folder name. `description`: at most 1024 characters, saying what the procedure does and when to use it. Keep SKILL.md under 500 lines. Each step in SKILL.md: number, plain-language instruction, target (role and name first, then other selectors), input or variable, expected result, failure rule, and a CONFIRM marker where relevant. A "Variables" section lists every variable with description and whether it is sensitive. Validate the output with a test (and with `skills-ref validate` if it is installed).
- [ ] U3 **Embedded agent copy in every human export,** invisible to readers but clearly labelled:
  - HTML: `<script type="application/json" id="trailmark-procedure">`.
  - Markdown: a collapsed `<details><summary>Agent procedure</summary>` block at the end containing fenced JSON.
  - Word: a custom XML part (`customXml/item1.xml` plus properties and relationship) holding the procedure.
  - PDF: `procedure.json` attached inside the PDF (pdf-lib `attach`).
  - Every export gets a one-line visible footer: "Agent-readable procedure embedded (Trailmark schema v1)."
  - The embedded text describes the procedure. It never addresses an AI or gives it orders ("ignore", "you must"), so agents don't mistake it for prompt injection.
- [ ] U4 **Input modes:** each typed value can be Fixed text, Ask every run, or Ask with a default; plus a sensitive flag. A global default lives in Settings and per guide. Detect likely variables (numbers, dates, IDs, emails) and suggest "Ask every run". Guide Me shows what to type; Run for me prompts for values once at the start.
- [ ] U5 **Confirm flags:** auto-set `confirm` on buttons whose name means an irreversible action (submit, send, delete, remove, approve, post, pay, publish, finalise, confirm). Editable per step.
- [ ] U6 **Captured expectations:** about 800 ms after each action, diff URL, dialogs and the accessibility tree around the target to record what changed (URL, dialog appeared, element appeared or disappeared, text appeared). Editable.
- [ ] U7 **Agent self-check:** dry-run a guide in a new tab, resolving every target and expectation without clicking (highlight only), then report per step: found, ambiguous or missing.
- [ ] U8 **OCR for visual-only steps** with tesseract.js, bundled offline (worker, core and English data inside the bundle, no CDN). Fills `target.ocrText` with text around the click so agents and the matcher have anchors. Also powers E11 on desktop and image steps.
- [ ] U9 **Guide health:** when Guide Me or Run for me can't find a target, offer "Re-capture this step" in place, keeping the rest of the guide.
- [ ] U10 **Playwright replay** (`scripts/replay.spec.ts`) uses `getByRole` / `getByLabel` / `getByText` first, CSS last, reads variables from environment variables, and stops before confirm steps unless `TRAILMARK_ALLOW_CONFIRM=1` is set.

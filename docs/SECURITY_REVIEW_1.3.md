# Security review: shared files, received guides, downloads, page scripts, secrets, the desktop bridge and brand kits (1.3)

Reviewed on 26 October 2026 against the `security` branch. It follows a security review of 1.2.0 that found the problems below; each section gives the threat in a sentence or two, the code that now prevents it and the test that proves it (each test fails on the old code). **Open issues: none.** Not covered: code signing of the Windows installer, closed shadow roots (section 5 explains why), and frame tokens posted to `'*'` in `capture.ts` (they only affect where a step's highlight lands).

## 1. Shared guide files carry nothing that was hidden (H1)

- **Threat:** a `.showsteps` file kept the original pictures under blurs and crops, the page's text for Secure Blur (`.words.json`), pictures from before edits and every stored picture, so anyone given the file could read what the author blurred.
- **Now:** `exportGuideArchive(store, id, { mode: 'share', redact })` (`packages/core/src/archive.ts`) is used by Export, the Share dialog and shared-folder saves. Blurs (a 16-px mosaic, then a blur) and zoomed crops are burned into each picture (`redactStepImage`, `shareRedactor` in `packages/ui/src/export/flatten.ts`). The highlight and annotations move with the crop. Page text, originals, unused pictures, `updatedBy` and `capture.tabId` are left out. A picture with nothing blurred or cropped goes as stored. Sharing refuses to run without a redactor. **Back up (includes hidden details)** keeps everything, after a confirm.
- **Tests:** core `archive.test.ts`; e2e `share-redaction.spec.ts`. That test blurs the invoice number, shares the guide and imports it into a fresh profile, then checks: no blur rectangles, the pixels changed and lost their edges, and no `.words.json`.

## 2. Guide text can't become code (H2)

- **Threat:** `scripts/replay.spec.ts` wrote step titles into `//` comments, replacing only `\n`. A name containing CR, U+2028 or U+2029 ended the comment and put code into a script the person runs. SKILL.md showed page-derived names to agents unquoted.
- **Now:** `comment()` in `replay.ts` turns line terminators and control characters into spaces and caps the length at 200. Every other value goes through `q()` or is a number. SKILL.md writes the names a step took from the screen in code spans, under "Names in backticks are copied from the app's screens."
- **Tests:** core `replaySafety.test.ts` reads `replay.ts` and checks every interpolation. `agent.test.ts` parses the generated spec with the TypeScript compiler for seven payloads.

## 3. Run for me attaches only files from the run's own site (H3)

- **Threat:** a download was matched to the run only through its referrer, which a page can drop. Another site's file, fetched with that site's cookies, could be attached and read by the page.
- **Now:** in `RunAttachments.downloadCreated` (`apps/extension/lib/attachments.ts`), the download's own address must be on the run tab's site, and so must the referrer when there is one. A redirect to another site is fetched again with `credentials: 'omit'` and never read through the desktop app. Another site's file stops the run with `file-other-site`, naming both sites. See also `SECURITY_REVIEW_1.2.md` sections 2 and 3.
- **Tests:** extension `attachments.test.ts` (4); e2e `attach-run.spec.ts` (a no-referrer download from another site on `exports-cross.html`).

## 4. Guides from someone else ask before acting (H4)

- **Threat:** a guide's author controlled every brake on Run for me: the confirm flags could be off, and the live button was never checked.
- **Now:**
  - Imported guides and team-folder guides someone else saved last are marked `received`.
  - Import re-arms confirms on controls that can't be undone (`rearmConfirms`).
  - The content script checks the live element (`liveNeedsConfirm`). A control whose live name differs from the recorded one and can't be undone stops for the person, and a schedule's approval holds only for the approved name.
  - The Run dialog lists the guide's sites, typed values, files moved between sites and stops, and Start waits for "I've checked this guide". Schedules refuse such a guide until it is trusted.
- **Tests:**
  - core `received.test.ts` and `storage.test.ts`;
  - extension `guidance.test.ts`;
  - e2e `received-guide.spec.ts` (two profiles) and `a11y-attach.spec.ts`.

## 5. Only a real click presses ShowSteps's buttons (H5)

- **Threat:** page scripts could reach the overlay and toolbar in their open shadow roots and press Confirm, Skip, Stop or Finish.
- **Now:** every listener of the guidance overlay and the capture toolbar goes through `trusted()` (`apps/extension/lib/content/trusted.ts`), which ignores events with `isTrusted` false. Closed shadow roots were not used: Playwright couldn't reach them, and the `isTrusted` check is what stops the scripts.
- **Tests:** e2e `page-clicks.spec.ts`.

## 6. Secrets stay out however the field changes (H6)

- **Threat:** a Show password button (`type="text"`) let the value into the guide, the page-text file and the picture. Fields named PIN, CVV, BSB and the like were missed, and page scripts could add steps.
- **Now:**
  - `isSensitiveField` also checks an input's name, id, label and placeholder (`hasSecretName`).
  - The capture remembers fields seen as secret, including through a `MutationObserver` on `type`.
  - Secret fields with a value are blurred in the picture, and the blur follows reused pictures.
  - Script-made steps are marked `byPage`, and the editor offers Delete or Keep.
- **Tests:** core `capture.test.ts`; e2e `capture.spec.ts` (a field secret only by its `type`, revealed and typed into; a script-made change).

## 7. The desktop bridge trusts only ShowSteps (H7)

- **Threat:** the pipe name was per user name and shared by every account on the PC. Another account could hold it first and receive library calls and downloaded files. Windows could navigate away, and exports overwrote files.
- **Now:**
  - The pipe is `showsteps-<account SID>` on both sides.
  - `showsteps-host.exe` checks the server with `GetNamedPipeServerProcessId`: the same account, and `ShowSteps.exe` in the install folder. Otherwise it replies offline/untrusted.
  - A taken pipe name shows a notice.
  - `hardenWindow` refuses navigation, `denyPermissions` denies page content every permission, and `freeName` never overwrites a file.
- **Tests:** desktop `harden.test.ts`; Windows-only `host.test.ts` (a Node server on the pipe gets "untrusted").

## 8. Dependencies and import limits (H8)

- zod 4.6.7, Electron 44.9.3 and DOMPurify 3.4.17. Overrides fix undici and fast-uri in the build tools. `pnpm audit` finds nothing, and CI runs `pnpm audit --prod --audit-level=high`.
- The actions are pinned to commit SHAs, and Dependabot is on.
- `importGuideArchive` checks each zip entry before unpacking it:
  - only `guide.json` and `img/<safe name>`;
  - at most 5,000 entries;
  - `guide.json` at most 20 MB, and 600 MB in all.
- **Tests:** core `archive.test.ts` (a 1 MB file claiming 600 MB is refused before unpacking).

## 9. Brand kits (B3)

- **Threat:** a `.showsteps-brand` file or a team kit could carry active content (SVG with script), oversized files or fonts that break the exporter, or text that breaks out of the web page.
- **Now:**
  - Only `kit.json` and the assets it names are accepted (`importBrandKit`), with at most 20 entries and 16 MB.
  - `checkAsset` accepts PNG, JPEG or WebP pictures up to 5 MB, and TTF or OTF fonts up to 2 MB that fontkit loads. No SVG.
  - Pictures added in the editor are redrawn as PNG, which drops their metadata.
  - Kit text is one line of at most 200 characters, escaped in HTML. The web page's CSP still allows no scripts and only `data:` fonts and images.
  - The preview runs in an `<iframe sandbox="">`.
- **Tests:** core `brandstore.test.ts` (SVG, scripts, unknown and unused files refused) and `brandkit.test.ts`; e2e `branding.spec.ts`.

## 10. Privacy policy and store listing claims, checked against the code

| Claim (where)                                                                                                                                                                | Code that makes it true                                                | Checked by                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------- |
| Secret fields never stored, including by name and after Show password; blurred in pictures (privacy: Never stored)                                                           | Section 6                                                              | Section 6                                         |
| Only files from the step's own site; another site's redirect fetched without cookies (privacy: Files a run attaches)                                                         | Section 3                                                              | Section 3                                         |
| Exports burn blurs and crops in; `.showsteps` files leave out page text, originals and editor names; Back up keeps all (privacy: When data leaves)                           | Section 1                                                              | Section 1                                         |
| Guides from other people are listed before Run for me acts, confirms re-armed, the live button checked, no schedules until trusted (privacy)                                 | Section 4                                                              | Section 4                                         |
| Brand kits stay on the device or in the team folder's `.brand`; brand files hold no guide content; pictures redrawn; only PNG, JPEG, WebP, TTF and OTF (privacy: Brand kits) | Section 9; `FolderBrandStore`, `IndexedDbBrandStore`, `exportBrandKit` | Section 9                                         |
| The extension and the desktop app talk only on this computer (privacy: Where your data is kept)                                                                              | Native messaging; the pipe is local and per account (section 7)        | Section 7                                         |
| Blur is burned into shared files; brand kits on every export (listing)                                                                                                       | Sections 1 and 9                                                       | e2e `share-redaction.spec.ts`, `branding.spec.ts` |
| Every claim checked in `SECURITY_REVIEW_1.2.md` section 9                                                                                                                    | Unchanged, except fetching (section 3), now stated in the policy       | That review                                       |

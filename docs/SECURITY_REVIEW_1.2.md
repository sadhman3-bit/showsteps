# Security review: attaching downloads, entry points and start links (1.2)

Reviewed on 24 October 2026 against the `update-1.2` branch. Each point names the code that enforces it and the test that checks it. **Open issues: none.** One behaviour is recorded under PROGRESS "Deferred (1.2)": a start link opened in the first moments after ShowSteps starts in a brand-new profile sometimes opens no window (it fails safe: nothing starts).

## 1. Files a run attaches

- **Only while it matters.** A run keeps files only in Run for me mode and only when the guide has an attach step (`Guidance.start` → `attachAhead`); Guide Me never keeps files. A click is a source only while an attach step is still ahead (`Guidance.act`).
- **Where they live.** IndexedDB `showsteps-run-files` (`apps/extension/lib/runfiles.ts`), keyed by run ID and step ID. Only the file's name, type, size and host are in `PersistedGuidance` (session storage) so a worker restart can carry on. Nothing is written anywhere else.
- **Caps.** At most 25 MB a file and 50 MB a run (`MAX_FILE_BYTES`, `MAX_RUN_BYTES`), checked on the page's own read, on Chrome's reported size, on the re-fetched body and before keeping.
- **When deleted.** When the run finishes, is stopped or replaced (`Guidance.finish` → `RunAttachments.dispose`); at start-up, every file not belonging to the run still going (`runFiles.deleteExcept`); and by Settings → Delete all ShowSteps data (the database is deleted).
- **Never logged.** Run logs keep only `file: { name, size, from, step }` (`RunStepLogSchema`); notifications say only "step N needs the downloaded file"; analytics records nothing about files; the bytes travel only between the background and the content script of the run's own tab.
- Tests: extension `test/attachments.test.ts` (caps, deletion, start-up clean-up), e2e `attach-run.spec.ts` (files gone after each run, over-cap refused, kept across a worker restart), `schedules.spec.ts` (run log entry).

## 2. Which downloads belong to the run

- Only with download access, decided when the run starts (`hasDownloadAccess`). Listeners exist only once `downloads` is granted (`watchDownloads`).
- A download counts only if it starts within 10 seconds of a Run for me click (`DOWNLOAD_WINDOW_MS`), wasn't started by an extension (`byExtensionId`), and **its own address is on the run tab's site** (`sameSite(downloadHost(item.url), site)`), with or without a referrer; a `blob:` address counts by the page that made it, a `data:` file is the page's own. When Chrome gives a referrer, it must be on that site too. (Updated in 1.2.1: before, only the referrer was checked, and a page could drop it with `referrerpolicy="no-referrer"` to have another site's file, fetched with that site's cookies, attached.)
- Another site's download after the click is refused and the run stops at the attach step for the person, with reason `file-other-site`: "The file came from another site (bank.example) than this step (shop.example), so ShowSteps didn't attach it." The scheduled-run notice says the same.
- Two downloads from one click: neither is attached and the run stops for the person (`ambiguous`).
- A file the page already handed over for that click (a `blob:` link) wins; the download isn't fetched again.
- Tests: extension `test/attachments.test.ts` ("ignores downloads that are late, from an extension, or from another site", "attaches neither of two downloads from one click", and "only the run's own site's files (H3)": no referrer and another site, no referrer and the same site, a redirect to another site), e2e `attach-run.spec.ts` ("a file from another site isn't attached, even without a referrer", on `exports-cross.html`).

## 3. Fetching a file

- **In the page** (`grabLinkFile` in `apps/extension/lib/content/guide.ts`): only the element Run for me is about to click, only if it is or is inside a link, and only a `blob:`/`data:` address or (without download access) a same-origin link with a `download` attribute, fetched with the page's own cookies. An HTML response for a non-HTML name is refused (a sign-in page is not the file).
- **From the background** (`refetch` in `entrypoints/background.ts`): only the finished download's own `finalUrl` (or `url`), only `http(s)`, only when ShowSteps has site access to that origin; with cookies only when that address is on the run's site, and **without cookies (`credentials: 'omit'`) when Chrome was redirected to another site** (a signed storage link needs none), and then never through the desktop app's `readDownload`; the response must be OK, match `fileSize` when Chrome knows it, stay under the cap, and not be HTML unless the download was HTML.
- Tests: extension `test/attachments.test.ts` (refused fetch), e2e `attach-run.spec.ts` (plain link with and without download access, `blob:` link, form POST stopping for the person).

## 4. The desktop app's `readDownload`

- Offered only as capability `read-download`; the extension asks only an app that lists it (`readDownloadVia`), with the path and size from a download matched in section 2. Websites can't reach the bridge: native messaging is open only to the extension.
- The app reads only an absolute path to a regular file (not a folder, symbolic link or junction: `lstat`), whose size equals the size Chrome reported and is at most 25 MB, written within the last 15 minutes; the size is checked again after reading (`apps/desktop/src/main/downloads.ts`). Anything else is refused with a reason.
- Replies use the existing chunking (`splitMessage`).
- Tests: desktop `test/downloads.test.ts` (each refusal), extension `test/bridge.test.ts` (1.1 never asked; 1.2 reads), e2e `desktop-attach.spec.ts` (owner's machine).

## 5. Putting the file in the field

- Only on an attach step, only into a file input found from the step's own target (the target, its label's control, the one inside it, or the only one in its form, dialog or page: `fileInputFor`); none or several: Run for me stops.
- A disabled field, or one whose `accept` list doesn't take the file, is refused (`attachProblem`), so the wrong file is never attached.
- Tests: core `test/attach.test.ts` (field finding, accept list, events), e2e `attach-run.spec.ts` (accept mismatch stops).

## 6. Start links in exported files

- **Fragment only.** The marker is `#showsteps=1&guide=<id>&mode=guide|run&v=<version>` (`buildStartLink`); browsers never send the fragment to the website.
- **Strict parsing.** Exactly the four known keys, `showsteps=1`, mode `guide` or `run`, an ID of at most 200 characters with no control characters, a short version (`parseStartLink`).
- **Start-page match.** For a guide in the library, a marker on any page other than the guide's first page is ignored (`onLinkNavigation`, `pageKey`).
- **Rate limit.** At most one window per tab every 10 seconds.
- **No auto-start.** The window is an extension page (`windows.create`, type `popup`) that the website can't cover or click; guidance starts only from its Start button. A link start passes no schedule approvals, so confirm steps still stop (`StartOptions.fromLink` carries no `approved`).
- **Clean start.** With `fromLink`, the tab goes to the exact start page first, which drops the marker.
- **Not now** only runs `history.replaceState` in the tab, only when ShowSteps already has access to that site, and only when the address still carries the marker.
- **Messages.** `start-link-dismiss` and `guide-start` are page messages, accepted only from ShowSteps's own pages (`fromExtensionPage`).
- Tests: core `test/attach.test.ts` (round trip, junk, other keys), `test/links.test.ts`, e2e `start-links.spec.ts` (Start in both modes, Not now, not in the library, guide changed, busy, other page ignored), `a11y-attach.spec.ts`.

## 7. Permissions and content security policy

- New in 1.2: only the optional `downloads` permission, asked inside the editor's Allow download access click (`downloadAccess.request`). Nothing new is required, so updating asks nothing.
- `extension_pages` CSP is unchanged: `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`. No remote code, no `eval`.
- Tests: `e2e/extension.spec.ts` (release manifest: 1.1's permissions plus optional `downloads`; CSP), `e2e/attach-editor.spec.ts` (request runs inside the click).

## 8. Other points checked

| Point                                         | Where                                                                                   | Result                                          |
| --------------------------------------------- | --------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Entry points start inside the click           | `startGuide` requests site access first; the side panel opens first in the same handler | e2e `entry-points.spec.ts`                      |
| The editor runs what's on screen              | `GuideEditor` flushes the autosave; `startGuide` waits for it after the permission      | e2e `entry-points.spec.ts` (renamed title used) |
| A scheduled run can't be taken over by a link | `startGuidance` refuses while a scheduled run goes (`busy`)                             | e2e `start-links.spec.ts`                       |
| 1.1 opening a guide saved by 1.2              | `input.from` is optional; 1.1 drops it and the step is a plain upload                   | DECISIONS; release notes                        |
| A broken file source                          | `planGuideStep` treats it as a plain upload everywhere                                  | core `test/attach.test.ts`, ui `fileControls`   |
| Demo download pages                           | Test fixture only; a signed-out session gets the sign-in page with status 200           | `fixtures/demo-app/test/server.test.mjs`        |

## 9. Privacy policy and store listing claims, checked against the code

| Claim (where)                                                                                                    | Code that makes it true                                                                        | Checked by                                      |
| ---------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Only files the run's own clicks downloaded, ≤ 25 MB each and 50 MB a run (privacy: Files a run attaches)         | Sections 1 and 2                                                                               | Sections 1 and 2                                |
| Kept in the extension's storage, deleted when the run ends or at the next start; never elsewhere                 | `RunFileStore`, `dispose`, `deleteExcept`, Delete all                                          | Section 1                                       |
| Never in guides, exports, notifications or usage counts; the run log keeps name, size, site and step only        | `RunStepLogSchema.file`; `noticeText`; `recordRun` unchanged                                   | Section 1                                       |
| Read in the page, or the download's own address fetched again with that site's cookies; size and HTML checks     | `grabLinkFile`, `refetch`                                                                      | Section 3                                       |
| With download access, sees downloads during such a run; ignores other extensions' and other sites' downloads     | `downloadCreated`                                                                              | Section 2                                       |
| Desktop app 1.2 reads only a file Chrome just saved, of the reported size, ≤ 25 MB                               | `readDownload`                                                                                 | Section 4                                       |
| Links carry the ID and version after `#`; nothing starts until Start (privacy: Links in exported files)          | Section 6                                                                                      | Section 6                                       |
| Download access asked only when choosing a downloaded file, optional; links can be turned off (privacy: control) | `FileControls` Allow button; Share dialog toggle (`share.startLinks`)                          | e2e `attach-editor.spec.ts`, `export.spec.ts`   |
| Delete all also deletes files a run was keeping                                                                  | background `delete-all` deletes `showsteps-run-files`                                          | review of `background.ts`                       |
| `downloads` justification (listing)                                                                              | Used only by `watchDownloads` → `Guidance.downloadCreated/Ended` while an attach step is ahead | Section 2                                       |
| `webNavigation` also spots links from exported guides (listing)                                                  | `onLinkNavigation`                                                                             | e2e `start-links.spec.ts`                       |
| Description: attaches a downloaded file; Guide Me and Run for me from cards, editor, side panel and exports      | Sections 1–6; `Library`, `GuideEditor`, `StartGuide`                                           | e2e `attach-run`, `entry-points`, `start-links` |

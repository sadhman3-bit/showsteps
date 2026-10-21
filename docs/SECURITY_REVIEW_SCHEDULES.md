# Security review: scheduled runs (1.1)

Reviewed on 21 October 2026 against the `schedules` branch. Each point names the code that enforces it and the test that checks it. **Open issues: none.**

## 1. Approvals are tied to the guide version

- A schedule stores pre-approved confirm steps together with `guideVersion`, a hash of each step's id, action, page, key, target, input and confirm flag (`packages/core/src/schedule/version.ts`, `guideVersion`).
- At run time only `activeApprovals(schedule, guide)` counts, and it returns nothing when the guide's version differs. It also keeps only steps that are still marked confirm.
- Run for me skips the confirm stop only for those step ids (`apps/extension/lib/guidance.ts`, `needsConfirm`).
- Edits to titles, descriptions and pictures keep approvals; anything that changes what is clicked or typed drops them.
- Tests: `packages/core/test/schedule.test.ts` ("changes when what Run for me does changes…", "applies approvals only while the guide is unchanged"); `apps/extension/test/schedules.test.ts` ("drops approvals after the guide is edited"); `apps/extension/test/guidance.test.ts` ("runs pre-approved confirm steps for a schedule…"); e2e `schedules.spec.ts` ("…after a guide edit it pauses again").

## 2. Schedules can't arrive inside imported files or team folders

- Schedules live only in `browser.storage.local` (`schedules`, `scheduleState`) and run logs only in the IndexedDB database `showsteps-runlogs` (`apps/extension/lib/runlogs.ts`). Nothing writes them anywhere else.
- `GuideSchema` has no schedule field, and parsing drops unknown fields. Importing a `.showsteps` file reads only `guide.json` (through `parseGuide`) and `img/*` (`packages/core/src/archive.ts`).
- The desktop bridge exposes only the guide-store methods in `BRIDGE_STORE_METHODS`, none of which touch schedules. Team folders hold guides and their sidecars only.
- Schedules change only through the background script's `schedule-*` messages. These are validated with Zod and accepted only from ShowSteps's own pages, never from websites or content scripts (`background.ts`, `fromExtensionPage`).
- Tests: `packages/core/test/schedule.test.ts` ("never travels inside a guide file", "never arrives inside an imported .showsteps file").

## 3. Unattended runs never type secrets and never click anything unrecorded

- Values come only from `resolveValues`, which fills the guide's current `runFields`. Those never include sensitive inputs or sensitive variables, so a value saved for a step that later became sensitive is dropped (`packages/core/src/schedule/create.ts`).
- Run for me's `valueFor` returns nothing for a sensitive input, and `planStep` makes those steps manual. An unattended run stops there and notifies; it never types (`packages/core/src/guidance/plan.ts`).
- Run for me acts only on each step's recorded target. The sign-in stop clicks nothing, and **Continue** only retries the recorded step (`guidance.ts`, `signInStop`).
- Tests: `packages/core/test/schedule.test.ts` ("resolves values for a run, never giving sensitive inputs a value"); `apps/extension/test/guidance.test.ts` (sign-in stop, own-host and IdP cases); e2e `schedules.spec.ts` (expired session: the person types the password, Run for me doesn't).

## 4. Notifications show no typed values

- A notice carries only the schedule's name, a step number and an outcome or reason. `noticeText` builds the words from those and fixed text in `strings.ts` (`apps/extension/lib/notices.ts`).
- Notifications are shown only when the person allowed the optional `notifications` permission; otherwise only a `!` badge appears.
- Test: `apps/extension/test/schedules.test.ts` ("never show a typed value": a value containing `SECRET` never appears in any notice).

## 5. Run logs hold no sensitive values

- A log's `values` is exactly the output of `resolveValues` (non-sensitive fields only). Step entries hold ids, numbers, statuses, times and picture names.
- Step pictures are screenshots of the run's own window. They show what the page showed, like any ShowSteps screenshot; they stay in this browser profile, are capped at the newest 20 runs per schedule, and are deleted with the schedule or with **Delete all ShowSteps data**.
- Tests: `apps/extension/test/schedules.test.ts` (log values, 20-run cap in core, deleting removes logs); e2e `schedules.spec.ts` (`log.values` equals the resolved supplier value only).

## 6. The desktop app launches only Chrome, with no arguments

- `ScheduleWake` starts a program only at the due time, and only when `tasklist` shows no `chrome.exe` for this Windows user. If it can't tell, it starts nothing (`apps/desktop/src/main/wake.ts`).
- The program is the path in `App Paths\chrome.exe` (per user, then for all users), started with an empty argument list: no URL, no flags.
- The extension sends only `schedule-next { at }` (a time). The app never takes a path, URL or command from the extension.
- The test-only stand-in (`SHOWSTEPS_TEST_CHROME`) is honoured only when the app runs in its e2e mode (`SHOWSTEPS_E2E=1`), never in the installed app.
- The saved `schedule-next.json` holds a timestamp only.
- Tests: `apps/desktop/test/wake.test.ts` (starts only when Chrome isn't running, once, follows the latest time, does nothing when unsure); `e2e/desktop-schedule.spec.ts` (the started program received no arguments; runs with `pnpm e2e:desktop`).

## 7. The content security policy is unchanged

- `extension_pages` is `script-src 'self' 'wasm-unsafe-eval'; object-src 'self'`, as in 1.0. No remote code, no `eval`; the new screens are bundled Preact.
- Test: `e2e/extension.spec.ts` checks the release manifest's CSP equals 1.0's.

## 8. Other points checked

| Point                                               | Where                                                                                                                   | Result                                                                                                                                        |
| --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| New permissions show no install warning             | `wxt.config.ts`: `alarms` required (no warning); `notifications` optional                                               | `e2e/extension.spec.ts` checks exactly 1.0's permissions plus `alarms`, optional `nativeMessaging` and `notifications`, no `host_permissions` |
| Permission prompts only from a click                | `scheduleClient.ts` `saveSchedule` runs in the Save click                                                               | Chrome refuses requests without a gesture; e2e saves through the dialog                                                                       |
| A scheduled run can't be hijacked by other activity | Recording, Guide Me and other Run for me sessions are refused while it goes; it ignores tabs in other windows           | `apps/extension/test/guidance.test.ts` (own window), background `scheduledRunGoing`                                                           |
| The run window doesn't steal focus                  | `windows.create({ focused: false, state: 'normal' })`                                                                   | MT-S-4                                                                                                                                        |
| Run state can't be corrupted by overlapping events  | Every scheduler change is queued (`serial`)                                                                             | `schedules.test.ts` ("keeps a completed run completed when the Schedules page clears the badge meanwhile")                                    |
| Desktop app 1.0 with extension 1.1                  | The extension uses `schedule-next` only when the hello reply lists `schedule-wake`; 1.0 lists none                      | `apps/extension/test/bridge.test.ts` ("desktop app 1.0 … never gets schedule features")                                                       |
| Desktop app 1.1 with extension 1.0                  | `BRIDGE_VERSION` stays 1; the extra hello fields are ignored by 1.0; without `schedule-next` the app never sets a timer | `bridge.test.ts` (1.1 reply), `wake.test.ts` (no time, no launch)                                                                             |
| Delete all ShowSteps data                           | Clears storage (schedules), all alarms, the run-log database and the badge                                              | `background.ts` `delete-all`; MT-M9-4                                                                                                         |
| Demo identity provider                              | Test fixture only (`fixtures/demo-app`), returns only to `localhost`/`127.0.0.1` callbacks                              | `fixtures/demo-app/test/server.test.mjs`                                                                                                      |

## 9. Privacy policy and store listing claims, checked against the code (S6)

| Claim (where)                                                                                                                                                     | Code that makes it true                                                                                                              | Checked by                                                                                                    |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------- |
| A scheduled run reads and acts on pages in its own Chrome window at the set times (privacy: While a guide runs)                                                   | `Scheduler.begin` opens `backgroundWindow` (`windows.create`, unfocused) and starts Run for me there                                 | e2e `schedules.spec.ts` (window count +1)                                                                     |
| A screenshot of the run's window after each step (privacy: Scheduled runs; listing)                                                                               | `Scheduler.logSteps` → `capture(windowId)` → `encodeLogShot` (JPEG 0.7, ≤ 1280 px) → `RunLogStore.putShot`                           | e2e `schedules.spec.ts` (a picture per step)                                                                  |
| The schedule holds times, values (with placeholders), pre-approved steps and stop settings                                                                        | `ScheduleSchema` (`packages/core/src/schedule/schema.ts`)                                                                            | core `schedule.test.ts`                                                                                       |
| Run logs hold when, outcome, reason, values typed (never passwords, codes or card numbers)                                                                        | `RunLogSchema`; values from `resolveValues` (run fields only)                                                                        | core and extension tests (sections 3 and 5)                                                                   |
| The newest 20 runs per schedule are kept                                                                                                                          | `MAX_RUN_LOGS = 20`, `RunLogStore.trim` after every run                                                                              | core `schedule.test.ts` ("keeps the newest 20")                                                               |
| Kept on this device in the extension's own storage; never synced or sent                                                                                          | `storage.local` (never `storage.sync`) and IndexedDB `showsteps-runlogs`; no network code; the e2e build's offline test still passes | `e2e/offline.spec.ts`; review of `schedules.ts`, `runlogs.ts`                                                 |
| Never put into guides, exports, `.showsteps` files or team folders                                                                                                | Section 2                                                                                                                            | core tests (section 2)                                                                                        |
| Notifications only if allowed; shown by Chrome; guide name and step number only; for finished, stopped, sign-in, due and failed checks                            | `notifications` is optional and checked before each notice; `noticeText`; notice kinds `paused`, `due`, `finished`, `check-failed`   | extension `schedules.test.ts` ("never show a typed value")                                                    |
| Without notifications, a toolbar mark shows when a run stopped or failed                                                                                          | `attention(true)` only for `stopped`/`failed`; cleared by the Schedules page                                                         | extension `schedules.test.ts`; e2e `schedules.spec.ts` (badge)                                                |
| The desktop app learns only when the next run is due, and starts Chrome without a web address                                                                     | `sendNextDue` sends `{ at }`; `ScheduleWake` launches with `[]`                                                                      | `bridge.test.ts`, `wake.test.ts`, `desktop-schedule.spec.ts`                                                  |
| Start with Windows starts the app in the tray when you sign in                                                                                                    | `app.setLoginItemSettings({ openAtLogin, args: ['--hidden'] })`; `--hidden` opens no window                                          | MT-S-7                                                                                                        |
| Website access asked when you save a schedule; notifications only when you save one                                                                               | `saveSchedule` (in the Save click)                                                                                                   | e2e `schedule-screens.spec.ts`                                                                                |
| Switching off or deleting a schedule; deleting removes its logs and pictures; Delete all removes schedules, logs and pictures                                     | `Scheduler.setEnabled`, `Scheduler.remove` → `logs.removeSchedule`; background `delete-all`                                          | extension `schedules.test.ts` ("removes a schedule with its alarms and logs"), e2e `schedule-screens.spec.ts` |
| Use and transfer of data complies with the Limited Use requirements                                                                                               | Nothing is transferred to the developer or third parties; data is used only to make, follow and run guides                           | Sections 2–6                                                                                                  |
| `alarms`: starts Run for me at the set times (listing)                                                                                                            | `browser.alarms` used only for `schedule:`, `check:`, `retry:`, `wait:` and `pending:` alarms                                        | `schedules.test.ts`                                                                                           |
| `notifications` (optional): finishes, needs a confirmation or a sign-in; asked when creating a schedule (listing)                                                 | As above                                                                                                                             | As above                                                                                                      |
| `storage` now also holds schedules; `unlimitedStorage` covers run-log pictures; host access also asked when saving a schedule (listing)                           | `SCHEDULES_KEY` in `storage.local`; `RunLogStore`; `saveSchedule`                                                                    | As above                                                                                                      |
| Description: runs daily, weekdays, chosen days or a day of the month, in its own window, pauses and tells you, logs each run with a screenshot per step (listing) | `RecurrenceSchema`, `Scheduler`, `RunLogStore`                                                                                       | Sections above                                                                                                |

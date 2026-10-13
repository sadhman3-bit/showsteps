# ShowSteps polish report

The build that was called Trailmark, then ABCXYZ, is now **ShowSteps**, in the "Pink and Ink" design: signal pink on deep navy, Funnel Sans and Funnel Display type, the ringed "1" logo with a pink highlighter, and the Ripple and Trail patterns.

Screenshots: `docs/design/before/` (before) and `docs/design/after/` (after), light and dark. Regenerate the after set with `pnpm design:shots`.

## Before and after

| Screen                         | Before                                    | After                                    |
| ------------------------------ | ----------------------------------------- | ---------------------------------------- |
| Side panel, idle               | ![](before/sidepanel-idle-light.png)      | ![](after/sidepanel-idle-light.png)      |
| Side panel, recording          | ![](before/sidepanel-recording-light.png) | ![](after/sidepanel-recording-light.png) |
| Side panel, recording (dark)   | ![](before/sidepanel-recording-dark.png)  | ![](after/sidepanel-recording-dark.png)  |
| On-page toolbar and step toast | ![](before/toolbar-light.png)             | ![](after/toolbar-light.png)             |
| Guide Me                       | ![](before/guide-me-light.png)            | ![](after/guide-me-light.png)            |
| Editor                         | ![](before/editor-light.png)              | ![](after/editor-light.png)              |
| Reader                         | ![](before/reader-light.png)              | ![](after/reader-light.png)              |
| Reader (dark)                  | ![](before/reader-dark.png)               | ![](after/reader-dark.png)               |
| Agent view                     | ![](before/agent-light.png)               | ![](after/agent-light.png)               |
| Library                        | ![](before/library-light.png)             | ![](after/library-light.png)             |
| Library, empty                 | ![](before/library-empty-light.png)       | ![](after/library-empty-light.png)       |
| Library, empty (dark)          | ![](before/library-empty-dark.png)        | ![](after/library-empty-dark.png)        |

New in the after set: the side panel while guiding (`after/sidepanel-guiding-*.png`).

Store images (`docs/webstore/images/`): three 1280×800 screenshots, the 440×280 promo tile and the 1400×560 marquee.

## What changed, by phase

- **P0:** finish notification (local tooling), the `polish` branch and the "before" screenshots.
- **P1:** renamed to ShowSteps everywhere: packages `@showsteps/*`, CSS `--ss-`, files `.showsteps`, native host `com.showsteps.host`, app id `app.showsteps.desktop`. Old `.trailmark` files still import, old procedures still read, the old desktop library moves on first run, and the old native host keys are removed.
- **P2:** design tokens (light, dark and the navy controls over other apps) in `tokens.css`, mirrored in `packages/core/src/tokens.ts`; bundled Funnel fonts; the component set (buttons in five variants and three sizes, icon buttons with tooltips, form controls, checkbox and toggle, segmented control, badges, cards, callouts with icons, dialogs, menus, toasts, empty states, chips, key caps); a 24-px icon set; the Ripple and Trail patterns. Tests check every text pair for WCAG AA contrast and fail on any hard-coded colour.
- **P3:** the logo, wordmark, lockup and app tile in `brand/` (text turned into paths); `pnpm brand` renders every icon: extension, desktop, installer, tray (with a dark-taskbar version) and favicons.
- **P4:** side panel (Ripple band and lockup, a large Start capture with its shortcut; while recording a pulsing dot, icon buttons, a ⋯ menu with a confirmed Cancel, the pink Finish, the site chip and step cards whose thumbnails are framed on the click); the navy on-page toolbar with Undo step; the 1.5-second step toast.
- **P5:** Guide Me and Run for me: dimmed page, pink ring with a halo, navy tooltip with the step count in pink, Back and Skip, a pink "I did this", a progress bar, and an alert-style confirm ("Confirm and continue"); the same look in the side panel and the desktop overlay.
- **P6:** editor (a three-part top bar, an 820-px column, highlighter headings, a Copy link icon on hover, sharp screenshots that are never enlarged, crops of about 2.2× the action, and a navy ring automatically on pink or red screens, which the author can override); Agent view (warning callout, aligned fields, mono chips); image editor (icon toolbar, pink, navy, white and yellow); library (lockup, large search, cards with the site and "Edited …", Ripple empty state).
- **P7:** exports: HTML and the embed card with a Trail cover band and embedded fonts; PDF with the same cover and embedded fonts; Word with Funnel embedded and the token colours; Copy HTML callouts without side stripes. A PDF bug that printed a line break inside a callout as "?" is fixed.
- **P7b (your request):** agent instructions for both kinds of agent. Each Agent Pack's SKILL.md now explains how it runs with browser automation (Playwright, Playwright MCP, the GitHub Copilot coding agent) and with computer use (screenshots and the pointer); every step gives where its target was on screen and points at its screenshot; packs include AGENTS.md. This repository now has AGENTS.md, `.github/copilot-instructions.md` and a `copilot-setup-steps` workflow for the Copilot coding agent.
- **P8:** desktop app: navy capture pill, Guide Me overlay, lockup in the window bar, an About dialog (also in the extension library), new tray and installer icons. Both apps now ship `licenses/NOTICES.txt` with every bundled licence.
- **P9:** store images, README, this report, an accessibility test (named controls, 24-px targets, visible focus, reduced motion) and an offline test (nothing loads from the internet, fonts included).

## How to update your installs

1. **Extension:** unzip `dist/showsteps-extension-1.0.0.zip` over your extension folder (or keep using the folder you loaded), open `chrome://extensions` and click **↻** on ShowSteps. Your guides stay.
2. **Desktop app:** uninstall the old **Trailmark** or **ABCXYZ** app first (Windows **Settings → Apps**), then run `dist/ShowSteps-Setup-1.0.0.exe`. Your library moves to `Documents\ShowSteps\Library` on first start.

## Not done, and why

- **Run for me speed and Pause on the page:** they stay in the side panel; the page tooltip shows the confirm step in the alert style (logged in `docs/DECISIONS.md`).
- **Funnel font on web pages you record:** the toolbar, toast and Guide Me use the system font there, to keep the scripts that run in every page small and fast (logged).
- **Image editor as a 720-px dialog:** it stays full-window so the tools stay precise on full-size screenshots (logged).
- **Desktop splash screen:** none; the app opens in about a second (logged).
- **Code signing:** the installer is not signed, so Windows SmartScreen asks once. Signing needs a certificate in your name.
- **Chrome Web Store submission:** needs you at the developer dashboard (Google blocks automation there). Everything to paste is in `docs/webstore/`.
- **Manual checks:** `docs/MANUAL_TESTS.md`, section "Polish" (reload, old-app uninstall and library move, tray icon on a dark taskbar, Word and PDF fonts, pink-screen highlight, a screen-reader spot check).
- **Known flaky test:** `e2e/performance.spec.ts` can miss its time limits when it runs beside another test worker; it passes on its own (`PROGRESS.md`, open issues).

# Manual tests

Checks that need a person (Chrome UI, Windows prompts, real apps). Each one says which build to use and what you should see. Automated tests cover everything else.

## Setup used by several tests

Build everything once from the repo folder:

```bash
pnpm install
pnpm build
```

### Load the extension in Chrome (Load unpacked)

1. Open `chrome://extensions` in Chrome.
2. Turn on **Developer mode** (top right).
3. Click **Load unpacked** and choose `apps\extension\.output\chrome-mv3` inside the ShowSteps folder.
4. Pin ShowSteps: click the puzzle-piece icon in the toolbar, then the pin next to ShowSteps.

After a rebuild, click the circular reload arrow on ShowSteps's card in `chrome://extensions`.

### Start the demo app

```bash
pnpm demo
```

Then open <http://localhost:5173>. Any username and password work; nothing is stored.

---

## M0

### MT-M0-1 Side panel opens from the toolbar icon

1. Load the extension (above).
2. Click the ShowSteps toolbar icon.

**Expected:** a side panel opens on the right showing "ShowSteps", the tagline and "Everything stays on this computer. Nothing is uploaded." No errors appear on the extension's card in `chrome://extensions`.

---

## M2

Use the normal build (`apps\extension\.output\chrome-mv3`), not the `-e2e` one. Start the demo app with `pnpm demo` for the steps that use it.

### MT-M2-1 First capture asks for website access

1. Remove and re-add the extension (Load unpacked) so it starts with no access.
2. Open <http://localhost:5173>, click the ShowSteps icon, then **Start capture**.

**Expected:** Chrome asks to let ShowSteps read and change data on all websites. Choose **Allow**: a dark toolbar appears at the bottom right of the page saying "Recording · 1 step". Choosing **Deny** instead shows "ShowSteps needs website access to record…" in the side panel.

### MT-M2-2 Keyboard shortcut

1. On the demo page, press **Alt+Shift+R**.
2. Click a couple of things, then press **Alt+Shift+R** again.
3. Open `chrome://extensions/shortcuts` and check that ShowSteps's "Start or finish a capture" can be changed.

**Expected:** the first press starts recording (the toolbar appears); the second finishes it, and the side panel shows "Guide saved." If access was never granted, the first press opens the side panel instead.

### MT-M2-3 Library page

Open the side panel and click **Open library**. **Expected:** a tab with the library opens, and the guide you recorded is there with a picture of its first step.

### MT-M2-4 Move the capture toolbar

While recording, drag the toolbar by its ⋮⋮ handle. **Expected:** it moves and stays inside the window; clicks on it are never recorded as steps.

### MT-M2-4b Steps in the side panel while recording

Open the side panel, start a capture and click through a few things on the page. **Expected:** each step appears in the side panel straight away with its text and screenshot, the newest scrolls into view, and the toolbar on the page briefly shows the step just recorded. Delete a step in the middle with its bin icon: it disappears from the list and from the finished guide.

### MT-M2-5 Display scaling and browser zoom

1. Windows Settings → Display → Scale: set 125% or 150%.
2. In Chrome, zoom the demo page to 125% (Ctrl and +).
3. Record a few clicks and open the guide.

**Expected:** each orange Action Box sits exactly on the element you clicked. Repeat at 100% zoom.

### MT-M2-6 Scrolled pages

On the demo "New invoice" form, scroll down and click **Review invoice**. **Expected:** the screenshot shows the scrolled view with the box on the button.

### MT-M2-7 Several tabs and windows

1. Start a capture on the demo dashboard.
2. Type into a field, then switch to another tab (Ctrl+Tab) showing a website and click something there.
3. Drag that tab into its own window and click something again.

**Expected:** the typing, then the clicks in the other tab and window, all appear in one guide, in order.

### MT-M2-8 Real apps

Record a short, safe process in SharePoint, Redmap and Pronto Xi (for example: open a list, search, open an item). **Expected:** the steps read sensibly. Note anything that looks wrong for M3. Passwords are never stored, but they are visible on screen while you type, so take care on a shared screen.

### MT-M2-9 Recording survives Chrome pausing the extension

1. Start a capture and record one click.
2. Open `chrome://serviceworker-internals`, find ShowSteps and click **Stop**.
3. Back on the page, click two more things, then **Finish**.

**Expected:** the guide has all the steps.

---

## M3

Open a guide from the library (it opens in the editor).

### MT-M3-1 Replace, paste and re-capture a screenshot

1. Click a step's screenshot to open the image editor. Click **Replace image…** and choose any picture: it replaces the screenshot.
2. Copy part of your screen (Win+Shift+S), then click **Paste image**: the clipboard picture replaces it.
3. Click **Re-capture**. The side panel opens with "Re-capture step N…". Switch to a website tab and click **Capture screen**: the step's picture becomes that tab.
4. Open the image editor again and click **Reset to original**: the captured screenshot comes back.

### MT-M3-2 Paste a screenshot as a new step

Copy a screenshot (Win+Shift+S), click an empty part of the editor and press **Ctrl+V**. **Expected:** a new step with that picture appears after the step you last clicked in.

### MT-M3-3 Keyboard only

Without the mouse: Tab through the page; in a step title press **Ctrl+B**; press **Ctrl+Enter** for a new step; Tab to a step card and press **Delete**; press **Ctrl+Z** to bring it back; press **?** for the shortcut list; open **Alt text** on a step and type a description. **Expected:** everything works and the focused element always has a visible orange outline.

### MT-M3-4 Branding with a logo

Click **Branding**, choose a logo image, an accent colour and a font, then click **Preview**. **Expected:** the logo shows above the title; step numbers and the highlight use the accent colour; text uses the font.

### MT-M3-5 Versions over time

Edit a guide for a few minutes (a version is kept at most every 2 minutes and when you leave the editor), then open **Version history**. **Expected:** several versions with times; **View** shows the old guide; **Restore** brings it back and keeps your current guide as a version.

### MT-M3-6 Sample guides on first install

Remove ShowSteps from `chrome://extensions`, then Load unpacked again and open the library. **Expected:** two sample guides are there ("Create a supplier invoice in Ledgerline" and "Run a monthly report in Ledgerline").

---

## M4

Open a guide (a sample guide is fine), then click **Share**.

### MT-M4-1 Files open in their apps

Download **PDF**, **Word**, **Markdown** and **Web page**.

**Expected:**

- The PDF opens in Edge or Acrobat with a cover page, numbered steps, pictures with the orange highlight, and "Page N of M" at the bottom.
- The Word file opens in Word without a repair prompt. Steps are a numbered list; Heading 1 sections appear in the Navigation pane; right-click a picture → **View Alt Text** shows the step's description.
- The Markdown zip contains `guide.md` and an `img` folder; `guide.md` previews with pictures in VS Code.
- The web page works offline, and switches to dark colours when Windows is in dark mode.

### MT-M4-2 Copy HTML into each app (X5)

Click **Copy HTML**, then paste into each app below. Record what happens in the table: do the pictures, numbering, bold and callout colours survive?

| Target                | Pictures | Formatting | Notes |
| --------------------- | -------- | ---------- | ----- |
| Word (desktop)        |          |            |       |
| Outlook (new message) |          |            |       |
| OneNote               |          |            |       |
| Teams (chat message)  |          |            |       |
| Confluence            |          |            |       |
| Notion                |          |            |       |

Some apps refuse pictures stored inside pasted HTML. If one does, note it here; the workaround is to download the Word or PDF file and attach or insert it.

### MT-M4-3 Embed card on SharePoint (X6)

1. **Share → Save to shared folder → Choose folder…** and pick a folder in a SharePoint document library synced by OneDrive. Click **Save to folder**.
2. On a SharePoint page, add an **Embed** web part that points to the `.embed.html` file.
3. Edit the guide, then **Save to folder** again.

**Expected:** the embed shows one step at a time with Previous and Next. After step 3 and a page refresh, it shows the change. If SharePoint downloads the file instead of showing it, note it: many tenants block HTML files from rendering. A fallback is to rename the file to `.aspx` in the library.

### MT-M4-4 Print

**Share → Print… → Print**. **Expected:** the print preview hides the toolbar, keeps each step and its picture together, and "Save as PDF" works.

### MT-M4-5 Folder permission after a restart

Save to a folder, restart Chrome, open Share again and click **Save to folder**. **Expected:** Chrome asks once to allow editing files in that folder; after **Allow**, the files are updated.

---

## M5

Use the normal build. Start the demo app (`pnpm demo`) and make sure the two sample guides are in the library (in an empty library, click **Add the sample guides**).

### MT-M5-1 Guide Me from the library

1. Open the sample "Create a supplier invoice in Ledgerline" in the reader and click **Guide Me**.
2. Allow website access if Chrome asks.

**Expected:** the demo sign-in page opens in a new tab and the side panel lists the steps. Each step's element has an orange ring and a dark card with the step text. Doing the step (typing then Tab, clicking, choosing) moves on by itself, including inside the cost-centre box (a different site in a frame), the approver picker and the review dialog. **Back**, **Skip** and **I did this** work from the card and from the side panel.

### MT-M5-2 Run for me

In the reader click **Run for me**, choose speed **Slow**, and click **Start**.

**Expected:** a white pointer moves to each element and the steps happen. Run for me stops at **Enter your password** ("type this yourself"): type any password and press Tab, and it carries on. It stops before **Submit invoice** only if that step is marked to confirm (from M7 such steps are marked automatically); otherwise it submits. Try **Pause**, **Resume**, and "Pause after each step" with **Do next step**.

### MT-M5-3 Notes and pins on a real site

On a SharePoint page you use, open the side panel, click **Add a note**, click an element, write a note with some **bold** text and save. Then use **Pin a guide** on the whole page. Reload.

**Expected:** a coloured dot sits on the element and a teal arrow sits at the right edge. Hovering shows the note; the pin offers **Open guide** and **Guide Me**. The side panel switch hides them.

### MT-M5-4 Comments, reactions and Insights

Set **Settings → Your name**. Open a guide's reader, comment on a step and react at the end. Run Guide Me for a couple of steps, then stop.

**Expected:** the comment shows "(you)". **Insights** (library sidebar) shows a view and a Guide Me run, and the guide's funnel shows the run reaching steps 1 and 2.

### MT-M5-5 On-device AI (Chrome with built-in AI)

This needs Chrome where `chrome://on-device-internals` shows the model as available (Chrome 138 or later on a supported PC). Turn on **Settings → Use on-device AI**, open a guide in the editor and try **AI → Improve step text**, **Write a summary** and **Translate…**.

**Expected:** suggestions appear for review before anything changes, and the translation is saved as a separate copy. In a browser without these APIs, the AI option is not offered.

---

## M6

Build the installer with `pnpm --filter @showsteps/desktop dist` (output in `apps/desktop/release`), or run the app from source with `pnpm --filter @showsteps/desktop start` after `pnpm build`.

### MT-M6-1 Install and uninstall for one user

Run `ShowSteps-Setup-<version>.exe` without admin rights and keep the default folder.

**Expected:** no UAC prompt. ShowSteps is in the Start menu and on the desktop. `HKCU\Software\Google\Chrome\NativeMessagingHosts\com.showsteps.host` points at `%APPDATA%\ShowSteps\com.showsteps.host.json`. Uninstall from Settings → Apps: that key (and the Chromium and Edge ones) and the manifest are gone, and `Documents\ShowSteps\Library` is still there.

### MT-M6-2 Record Excel

Open Excel, then press **Ctrl+Alt+R**. Click a cell, type a number, press Enter, click **Home → Bold**, then press **Ctrl+Alt+R** again.

**Expected:** a guide opens with steps such as "Type 42 into A1" and "Click Bold", each with a picture of Excel only (no other windows) and the highlight on the cell or button. The small capture toolbar is in no picture.

### MT-M6-3 One guide across Chrome and a desktop app

Install the extension and the desktop app. In the extension's **Settings**, turn on **Work with the desktop app**. Start a capture on the demo app, fill in a field, switch to Notepad and type a line, switch back and click **Sign in**, then finish.

**Expected:** the desktop app shows it is recording with the browser. One guide has the web steps and "Type … into Text Editor" in the order they happened, each with its own picture.

### MT-M6-4 Guide Me across both

Open that guide in the reader and click **Guide Me**.

**Expected:** web steps are highlighted in the page. At the Notepad step the side panel says to do it in the desktop app, an orange ring surrounds Notepad's text area and a dark card sits below it. Typing there and pressing Tab moves the guide back to the browser. **I did this** on the card also moves on.

### MT-M6-5 Team library and read-only

In the desktop app's **Settings**, choose a OneDrive folder as the team library on two PCs (or two Windows users). On one, open a guide in **Team library** and tick **Read-only for others**.

**Expected:** on the other PC the guide shows "Edited by <name>", opens in the reader with **Edit a personal copy**, and the copy opens in the editor in **My library**.

### MT-M6-6 Secure Blur

Sign in to the demo app and record a click on the dashboard's **Supplier contact** heading. In the editor click **Secure Blur**.

**Expected:** eight items are listed and outlined on the picture: email, phone, card, BSB, account, TFN, ABN and IBAN, each masked to its last characters. Untick one and click **Blur 7 items**: the picture has seven blurred regions, and running Secure Blur again lists only the one left.

---

## M7

Use the normal build with the sample guides installed.

### MT-M7-1 Agent view

Open "Create a supplier invoice in Ledgerline" in the editor and click **Agent**.

**Expected:**

- "Things to check" lists steps 7, 8 and 10 as fixed values that look like they change.
- Step 17 has **Confirm first**.
- Step 16 expects the "Review invoice" dialog to appear.
- Step 12's target names the cost-centre iframe.

Untick the confirm box on step 17; a new warning says it looks irreversible.

### MT-M7-2 Ask every run

In **Edit**, on step 7 click **Ask every run**, then start **Run for me** from the reader.

**Expected:** the step title becomes "Type {{invoice_no}} into Invoice no." Run for me asks for "Invoice no." before it starts and types what you enter. In Guide Me the card says "Type the value for this case."

### MT-M7-3 Agent Pack with a real agent

Download **Share → Agent Pack** and unzip it. Give the folder to an AI agent that can drive a browser, such as an AI coding agent with a Playwright MCP server or a browser tool, and ask it to follow `SKILL.md` against the demo app.

**Expected:** it completes the flow and pauses for approval at "Submit invoice". See `docs/agent-run-transcript.md` for a recorded run.

### MT-M7-4 Replay script

In the unzipped pack, run `npx playwright test scripts/replay.spec.ts` with `TM_PASSWORD` set and the demo app running. Run it again with `SHOWSTEPS_ALLOW_CONFIRM=1`.

**Expected:** the first run passes and stops before "Submit invoice" with an annotation; the second submits the invoice.

### MT-M7-5 Embedded copies

Export the guide as PDF, Word, Markdown and a web page.

**Expected:** each ends with "Agent-readable procedure embedded (ShowSteps schema v1)." In detail:

- the PDF has an attachment, `procedure.json` (in Acrobat or Edge, the attachments pane);
- the Word file opens normally;
- the Markdown file ends with a collapsed "Agent procedure" block;
- the web page's source has a `showsteps-procedure` JSON block and the page still runs no scripts.

---

## M8

### MT-M8-1 Secure Blur on a pasted picture

In the editor, add an image step by pasting a screenshot of a page that shows an email address and a phone number, for example from Outlook. Click **Secure Blur**.

**Expected:** "Reading the text in screenshot 1 of 1 on this computer…" appears briefly. Then the email and the phone number are listed and outlined on the picture. Running Secure Blur again is instant.

### MT-M8-2 Works offline

Turn off Wi-Fi and repeat MT-M8-1 in both the extension and the desktop app.

**Expected:** it works the same. Nothing is downloaded: the engine ships with the app.

### MT-M8-3 Remote desktop steps

Record a click in a Remote Desktop (mstsc) window with the desktop app, then open the guide in the editor and look at the **Agent** tab.

**Expected:** the step shows the "visual only" warning. Shortly after the guide opens, its target shows the words near the click, and the Agent Pack lists them as "near the text …".

---

## M9

### MT-M9-1 Check every step

Sign in to the demo app, then open the sample "Create a supplier invoice in Ledgerline" in the editor, choose **Agent**, and click **Check every step**.

**Expected:** a new tab opens and shows each element ringed in turn; nothing is clicked or typed. The Agent view then shows "Found by aria" and similar on each step, and "Not found" on **Submit invoice** (it is inside a dialog that only opens after **Review invoice**). No invoice was submitted.

### MT-M9-2 Re-capture a step that changed

In a real web app you use, record a short guide. Then change something the guide clicks, for example rename a button, or use an app update that did. Start **Guide Me**.

**Expected:** at that step the side panel says it could not be found and offers **Re-capture this step**. Click it, do the step on the page and wait a moment. The guide carries on to the next step, and the editor shows the new step in place of the old one, with the rest unchanged.

### MT-M9-3 Settings

In **Settings**:

- choose **Dark** colours;
- turn on **Start captures with Live Blur on**;
- set zoom to **No zoom**;
- set quality to **Standard**.

Record two steps.

**Expected:** the library and side panel turn dark straight away. The capture toolbar starts with Live Blur pressed. The new steps show the whole screen, not a zoomed area. **Change keyboard shortcuts…** opens Chrome's shortcuts page.

### MT-M9-4 Delete all data

Export a guide you want to keep, then click **Settings → Delete all ShowSteps data… → Delete everything**.

**Expected:** the library reloads empty (the sample guides can be added again), and settings, notes and pins are back to their defaults.

### MT-M9-5 Install from the release files

Run `pnpm release`. On a clean Windows user account, follow the README's **Install** section using only the files in `dist/`.

**Expected:** the extension loads with Load unpacked, the desktop app installs without admin rights, and turning on **Use the ShowSteps desktop app** connects the two (the desktop app shows "Connected to the ShowSteps browser extension").

## Polish (ShowSteps rebrand)

- **MT-P-1 Extension reload:** in `chrome://extensions`, click ↻ on ShowSteps. The toolbar icon shows the ringed "1" with the pink highlighter; the side panel opens on the pink Ripple band with the SHOWSTEPS lockup; existing guides are still in the library.
- **MT-P-2 Old desktop app:** uninstall Trailmark (or ABCXYZ) in Settings → Apps, then run `ShowSteps-Setup-1.0.0.exe`. The installer and Start-menu icons show the new tile; on first start `Documents\Trailmark\Library` has moved to `Documents\ShowSteps\Library` and `Documents\Trailmark\MOVED_TO_SHOWSTEPS.txt` says so; the unpacked extension folder in `Documents\Trailmark` is untouched.
- **MT-P-3 Tray icon:** with a light and then a dark taskbar (Settings → Personalisation → Colours), the tray icon stays readable and switches to the light-ink mark on dark.
- **MT-P-4 Word export:** open an exported .docx in Word on a computer without Funnel installed: headings show in Funnel Display and text in Funnel Sans (embedded), callouts are tinted boxes with no side stripe.
- **MT-P-5 PDF export:** open an exported PDF in Acrobat or Edge: navy cover band with the pink Trail and the white title; File → Properties → Fonts lists FunnelSans and FunnelDisplay as embedded subsets.
- **MT-P-6 Pink interface:** record a step on a pink or red page (for example a red "Delete" banner): the highlight ring in the editor and in exports is navy; the image editor's Highlight colour menu can switch it back to pink.
- **MT-P-7 Screen reader spot check:** with Narrator, tab through the side panel and the editor top bar: every icon button announces its name (Pause, Live Blur, More actions, Undo, Redo, Share).

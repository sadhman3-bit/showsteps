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
3. Click **Load unpacked** and choose `apps\extension\.output\chrome-mv3` inside the Trailmark folder.
4. Pin Trailmark: click the puzzle-piece icon in the toolbar, then the pin next to Trailmark.

After a rebuild, click the circular reload arrow on Trailmark's card in `chrome://extensions`.

### Start the demo app

```bash
pnpm demo
```

Then open <http://localhost:5173>. Any username and password work; nothing is stored.

---

## M0

### MT-M0-1 Side panel opens from the toolbar icon

1. Load the extension (above).
2. Click the Trailmark toolbar icon.

**Expected:** a side panel opens on the right showing "Trailmark", the tagline and "Everything stays on this computer. Nothing is uploaded." No errors appear on the extension's card in `chrome://extensions`.

---

## M2

Use the normal build (`apps\extension\.output\chrome-mv3`), not the `-e2e` one. Start the demo app with `pnpm demo` for the steps that use it.

### MT-M2-1 First capture asks for website access

1. Remove and re-add the extension (Load unpacked) so it starts with no access.
2. Open <http://localhost:5173>, click the Trailmark icon, then **Start capture**.

**Expected:** Chrome asks to let Trailmark read and change data on all websites. Choose **Allow**: a dark toolbar appears at the bottom right of the page saying "Recording · 1 step". Choosing **Deny** instead shows "Trailmark needs website access to record…" in the side panel.

### MT-M2-2 Keyboard shortcut

1. On the demo page, press **Alt+Shift+R**.
2. Click a couple of things, then press **Alt+Shift+R** again.
3. Open `chrome://extensions/shortcuts` and check that Trailmark's "Start or finish a capture" can be changed.

**Expected:** the first press starts recording (the toolbar appears); the second finishes it, and the side panel shows "Guide saved." If access was never granted, the first press opens the side panel instead.

### MT-M2-3 Library page

Open the side panel and click **Open library**. **Expected:** a tab with the library opens, and the guide you recorded is there with a picture of its first step.

### MT-M2-4 Move the capture toolbar

While recording, drag the toolbar by its ⋮⋮ handle. **Expected:** it moves and stays inside the window; clicks on it are never recorded as steps.

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
2. Open `chrome://serviceworker-internals`, find Trailmark and click **Stop**.
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

Remove Trailmark from `chrome://extensions`, then Load unpacked again and open the library. **Expected:** two sample guides are there ("Create a supplier invoice in Ledgerline" and "Run a monthly report in Ledgerline").

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

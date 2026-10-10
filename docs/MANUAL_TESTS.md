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

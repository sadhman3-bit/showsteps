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

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

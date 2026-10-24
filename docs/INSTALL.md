# Installing ShowSteps

A complete, step-by-step guide to installing, connecting, updating and removing ShowSteps on Windows.

ShowSteps has two parts:

| Part                  | What it does                                                    | Needed?                                      |
| --------------------- | --------------------------------------------------------------- | -------------------------------------------- |
| **Browser extension** | Records web pages, plays guides back, edits and exports guides. | Yes                                          |
| **Desktop app**       | Records Windows apps (Notepad, Excel, SAP GUI and so on).       | Only if you want to record Windows programs. |

Everything stays on your computer. ShowSteps has no accounts, no servers and no cloud storage. See [Staying on your computer](#12-staying-on-your-computer).

## Contents

1. [Before you start](#1-before-you-start)
2. [Download the files](#2-download-the-files)
3. [Check the downloads (optional)](#3-check-the-downloads-optional)
4. [Install the browser extension](#4-install-the-browser-extension)
5. [Install the desktop app](#5-install-the-desktop-app)
6. [Connect the extension and the desktop app](#6-connect-the-extension-and-the-desktop-app)
7. [Make your first guide](#7-make-your-first-guide)
8. [Updating](#8-updating)
9. [Moving from Trailmark or ABCXYZ](#9-moving-from-trailmark-or-abcxyz)
10. [Uninstalling](#10-uninstalling)
11. [Troubleshooting](#11-troubleshooting)
12. [Staying on your computer](#12-staying-on-your-computer)
13. [Building from source](#13-building-from-source)

## 1. Before you start

You need:

- Windows 10 or Windows 11;
- Google Chrome or Microsoft Edge, recent version;
- about 400 MB of free disk space for the desktop app (the extension needs about 20 MB).

You do **not** need administrator rights, an account or an internet connection after downloading.

## 2. Download the files

1. Open the repository's **Releases** page on GitHub (the **Releases** link on the right of the repository's main page).
2. Under the latest release, open **Assets** and download:
   - `showsteps-extension-1.2.0.zip` (the browser extension);
   - `ShowSteps-Setup-1.2.0.exe` (the desktop app; skip it if you only record web pages);
   - `SHA256SUMS.txt` (optional, to check the downloads).

The `…-chrome-web-store.zip` file is for submitting to the Chrome Web Store. You do not need it to install ShowSteps.

## 3. Check the downloads (optional)

This confirms the files arrived complete and unchanged.

1. Open **PowerShell** (press **Start**, type `PowerShell`, press **Enter**).
2. Go to your Downloads folder:

   ```powershell
   cd $HOME\Downloads
   ```

3. Print each file's checksum:

   ```powershell
   Get-FileHash .\showsteps-extension-1.2.0.zip, .\ShowSteps-Setup-1.2.0.exe -Algorithm SHA256
   ```

4. Open `SHA256SUMS.txt` in Notepad. Each value in the **Hash** column must match the line for the same file. Capital and small letters do not matter.

If a value differs, delete the file and download it again.

## 4. Install the browser extension

**The easy way:** open ShowSteps in the Chrome Web Store, <https://chromewebstore.google.com/detail/hlkihjibgiehjcaemfhfnfcjphgkcnoa>, and click **Add to Chrome**. Chrome keeps it up to date. Then skip to [4.3 Pin it to the toolbar](#43-pin-it-to-the-toolbar).

If your organisation blocks the Web Store, or you want a specific version, install it from the release files as an "unpacked" extension, as below.

Installing it unpacked takes about two minutes.

### 4.1 Unzip it to a folder you will keep

1. Make a folder that will stay put, for example `Documents\ShowSteps\extension`. Chrome loads the extension from this folder every time it starts, so **do not delete or move it later**.
2. Right-click `showsteps-extension-1.2.0.zip` → **Extract All…** → choose that folder → **Extract**.
3. Open the folder. It contains a folder named `showsteps-extension-1.2.0`, and that folder contains `manifest.json`. That inner folder is the one to load.

### 4.2 Load it in Chrome

1. In the address bar, type `chrome://extensions` and press **Enter**.
2. Turn on **Developer mode** (switch at the top right).
3. Click **Load unpacked**.
4. Select the `showsteps-extension-1.2.0` folder (the one containing `manifest.json`) and click **Select Folder**.
5. A **ShowSteps** card appears. Make sure its switch is on.

### 4.2 (alternative) Load it in Edge

1. In the address bar, type `edge://extensions` and press **Enter**.
2. Turn on **Developer mode** (switch in the left-hand panel).
3. Click **Load unpacked**, select the `showsteps-extension-1.2.0` folder and click **Select Folder**.

### 4.3 Pin it to the toolbar

1. Click the puzzle-piece icon (**Extensions**) to the right of the address bar.
2. Click the pin next to **ShowSteps**. The ShowSteps icon now stays on the toolbar.

### 4.4 What to expect

- ShowSteps asks for **website access the first time you record** or start a walkthrough, not at install. Click **Allow** when asked.
- Chrome may show a banner at start-up about extensions in developer mode. That is normal for extensions installed this way. Close the banner; do **not** click **Turn off**, or the extension is switched off.

## 5. Install the desktop app

Skip this section if you only record web pages.

1. Double-click `ShowSteps-Setup-1.2.0.exe`.
2. Windows may show **"Windows protected your PC"**, because the installer is not code-signed. Click **More info**, then **Run anyway**.
3. The installer runs by itself. It installs for your Windows user only, so no administrator prompt appears.
4. ShowSteps starts, and its icon appears in the system tray (bottom right of the taskbar; click **^** if you do not see it).

The installer also registers the connection that lets the extension talk to the desktop app. It writes only to your own user settings (`HKEY_CURRENT_USER`).

Your desktop guides are saved in `Documents\ShowSteps\Library`. You can change this in the desktop app's **Settings**.

**Start with Windows (optional).** In the desktop app's **Settings**, turn on **Start with Windows**. The app then starts in the tray when you sign in to Windows. Turn it on if you use scheduled runs: with the app running, it opens Chrome when a run is due and Chrome is closed.

## 6. Connect the extension and the desktop app

Do this to record web pages and Windows apps in the same guide, or to keep all guides in one library.

1. Make sure the desktop app is running (its icon is in the system tray).
2. Click the ShowSteps icon in the browser toolbar, then **Open library**.
3. Click **Settings**.
4. Turn on **Use the ShowSteps desktop app**.
5. The setting shows **Connected to the desktop app.**
6. If you already have guides in the browser, ShowSteps offers to move them into the desktop library. The browser keeps a copy either way.

In the desktop app, the connection dot in the top bar turns on; point at it to see **Connected to the ShowSteps browser extension**.

The two parts talk directly on your computer through Chrome's native messaging. Nothing goes over the network.

## 7. Make your first guide

**A web page:**

1. Open the page where the task starts.
2. Click the ShowSteps icon. The side panel opens.
3. Click **Start capture**.
4. Do the task as usual. Each click, entry and choice becomes a step with a screenshot in the side panel.
5. Click **Finish** on the small toolbar on the page, or in the side panel.
6. The guide opens in the editor. Rename it, tidy the steps and use **Share** to export it.

**A Windows app (needs the desktop app):**

1. Press **Ctrl+Alt+R**, or click **Record a process** in the desktop app.
2. Do the task in any Windows program.
3. Press **Ctrl+Alt+R** again, or click **Finish** on the recording toolbar.

The browser shortcut to start and finish a capture is **Alt+Shift+R**.

## 8. Updating

**Extension:**

1. Download the new `showsteps-extension-<version>.zip`.
2. Extract it into the **same** folder as before, replacing the old files.
3. Open `chrome://extensions` (or `edge://extensions`) and click **↻** (Reload) on the ShowSteps card.

Your guides are kept. They live in the browser's storage, not in the extension folder. Do not click **Remove** to update, because removing the extension deletes the guides it kept in the browser.

From the Chrome Web Store, updates arrive by themselves. To check now, turn on **Developer mode** in `chrome://extensions` and click **Update**.

**Desktop app:** install the new `ShowSteps-Setup-<version>.exe` over the old one, without uninstalling first. It replaces the old version and keeps your library and settings.

**Updating to 1.2:** nothing new is asked at update. Chrome asks for **download access** only if you set an upload step to use a downloaded file (see the README's "Downloads and uploads"). Desktop app 1.2 is needed only to attach files downloaded by a form (an **Export** button that posts); everything else works with desktop app 1.0 or 1.1. If several people share a team folder, update everyone: a guide saved again by ShowSteps 1.1 loses its upload steps' **File** setting.

## 9. Moving from Trailmark or ABCXYZ

ShowSteps was briefly called Trailmark, then ABCXYZ. Your guides carry over.

- **Extension:** extract the new version over the old folder, then click **↻** on the card in `chrome://extensions`. If you put it in a new folder instead, export your guides first from the old extension's library (**Export**, which saves a `.trailmark` or `.showsteps` file), then import them into ShowSteps. Old `.trailmark` files still import.
- **Desktop app:**
  1. Uninstall the old app: **Settings → Apps → Installed apps → Trailmark** (or **ABCXYZ**) → **Uninstall**.
  2. Install ShowSteps (section 5).
  3. On first start, ShowSteps moves `Documents\Trailmark\Library` to `Documents\ShowSteps\Library` and leaves a note, `MOVED_TO_SHOWSTEPS.txt`, where it was. Nothing else in the old folder is touched.

## 10. Uninstalling

**Extension:** open `chrome://extensions`, click **Remove** on the ShowSteps card and confirm. This deletes the guides, notes and settings the extension kept in the browser. To keep guides, export them first, or move them to the desktop library (section 6). Afterwards you can delete the folder you extracted the extension into.

To remove ShowSteps's data but keep the extension, open the library and click **Settings → Delete all ShowSteps data…**.

**Desktop app:** open Windows **Settings → Apps → Installed apps → ShowSteps → Uninstall**. This removes the app and the browser connection. Your guides in `Documents\ShowSteps\Library` are left in place. Delete that folder yourself if you no longer want them.

## 11. Troubleshooting

| Problem                                                    | What to do                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Load unpacked** says "Manifest file is missing"          | You chose the outer folder. Choose the `showsteps-extension-1.2.0` folder that contains `manifest.json`.                                                                                                                                                                                                                  |
| The ShowSteps icon is missing from the toolbar             | Click the puzzle-piece icon and pin ShowSteps (section 4.3). Check that its switch is on in `chrome://extensions`.                                                                                                                                                                                                        |
| The extension disappeared after Chrome restarted           | The extension folder was moved or deleted. Extract it again to the same place and click **Load unpacked**.                                                                                                                                                                                                                |
| **Start capture** does nothing on a page                   | Browsers do not let extensions work on their own pages (`chrome://…`, `edge://…`, the Chrome Web Store) or on PDFs opened in the browser. Try an ordinary web page, and click **Allow** when ShowSteps asks for website access.                                                                                           |
| Settings says **The desktop app is not running.**          | Start ShowSteps from the Start menu and wait for the tray icon. If it still does not connect, close every Chrome or Edge window (the browser reads the connection only when it starts), then open it again.                                                                                                               |
| "Windows protected your PC" when installing                | Click **More info**, then **Run anyway** (section 5). The installer is not code-signed.                                                                                                                                                                                                                                   |
| **Ctrl+Alt+R** does nothing                                | Another program may use the same shortcut. Click **Record a process** in the desktop app instead.                                                                                                                                                                                                                         |
| A Windows app is recorded without steps                    | Some programs that run as administrator cannot be read by an app running as your normal user. Run the program normally, or start ShowSteps as administrator for that recording.                                                                                                                                           |
| Guides are missing after changing the desktop library path | They are still in the old folder. In the desktop app's **Settings**, point **Library folder** back to it, or copy the guide folders into the new one.                                                                                                                                                                     |
| A scheduled run didn't happen                              | Runs need the computer on and awake, you signed in and the screen unlocked, and Chrome open. Check the Schedules page: a run missed while Chrome was closed shows as **Missed** (or runs at the next start, as the schedule says). With the desktop app running and **Start with Windows** on, Chrome is opened for runs. |
| A scheduled run stopped                                    | Open the Schedules page and the run's history: the reason and a picture after each step show where. A confirm step can be pre-approved in the schedule; a sign-in page needs you to sign in and press **Continue**.                                                                                                       |
| No notifications from scheduled runs                       | Allow notifications for ShowSteps (saving a schedule asks), and check that Windows notifications are on for Chrome. Without them, `!` on the toolbar icon shows when a run stopped.                                                                                                                                       |

## 12. Staying on your computer

ShowSteps is built to keep everything on your computer:

- **No cloud storage.** Guides are saved in the browser's own storage on this computer, or in a folder on your disk. Schedules, run logs and their screenshots stay in the extension's storage on this computer. The extension does not use Chrome Sync storage, so nothing is copied to your Google account.
- **No network requests.** All fonts, icons, the text-recognition (OCR) engine and its language data ship inside the apps. A test checks that ShowSteps's pages load nothing from the internet. The desktop app blocks all web requests from its own windows. Links you click in a guide open in your normal browser.
- **No accounts, analytics or telemetry.**
- **AI writing tools are off by default.** When turned on, they use the AI model built into Chrome, which runs on your computer.
- **The connection between the two apps** uses Chrome's native messaging on this computer only.
- **Files a run attaches** are kept in the extension's storage only for that run, and deleted when it ends.
- **Links in exported files** carry the guide's ID and version after a `#`, which browsers never send to the website.

Data leaves your computer only when **you** do something that sends it:

- exporting or sharing a file and sending it to someone;
- choosing a library folder that a sync service uploads, such as OneDrive, Dropbox or Google Drive. To keep everything on this computer, use a folder that is not synced. The default `Documents\ShowSteps\Library` is synced only if Windows backs up your Documents folder to OneDrive. To check, open OneDrive settings → **Sync and back up** → **Manage back up**, and see whether **Documents** is on. If it is, either turn it off or choose a library folder outside Documents, for example `C:\ShowSteps\Library`, in the desktop app's **Settings → Library folder**.

## 13. Building from source

For developers who want to build the release files themselves. You need Windows 10 or 11, Node.js 22 LTS, pnpm 10 and git. No .NET SDK is needed.

```bash
git clone https://github.com/sadhman3-bit/showsteps.git
```

```bash
cd showsteps
```

```bash
pnpm install
```

```bash
pnpm release
```

The files appear in `dist/`: the extension zip, the Web Store zip, the installer and `SHA256SUMS.txt`. Then continue from [section 4](#4-install-the-browser-extension). The [README](../README.md#for-developers) lists the tests and other commands.

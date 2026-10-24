# ShowSteps privacy policy

_Last updated: 24 October 2026_

ShowSteps is a browser extension, with an optional Windows app, that records a process you perform and turns it into a step-by-step guide. This policy covers both. It is published by the ShowSteps developer (contact below).

## The short version

ShowSteps has no servers and no accounts. Nothing you record is sent to the developer or to anyone else. Your guides stay on your computer, or in a folder you choose, until you export or share them yourself.

## What ShowSteps handles, and when

**While you record (and only then)**, ShowSteps reads the tab you are recording:

- screenshots of the visible part of the tab;
- the element you clicked or typed into (its role, name, label and position on the page);
- what you type into ordinary fields, so the step can say what to enter;
- the page's address and title;
- the position of words on screen, so sensitive details can be found and blurred later.

**Never stored:** values typed into password fields, one-time-code fields and payment-card fields (fields marked `password`, `one-time-code` or `cc-…`), and into fields whose name or label says they hold a password, PIN, passcode, one-time code, card number, security code (CVV), tax file number, BSB or account number. A field stays secret for the whole recording even if a **Show password** button reveals it, and ShowSteps blurs a secret field that's on screen in the screenshot (you can remove that blur in the editor). Steps that come from the page's own scripts rather than from you are marked in the editor, so you can delete them. A value typed into an ordinary text box is recorded like any other text, and anything visible on screen can appear in a screenshot. **Secure Blur** and **Live Blur** help you hide such details; check your screenshots before sharing a guide.

**While a guide runs** (Guide Me, Run for me, Check every step, and scheduled runs), ShowSteps reads the page you are on to find the element each step refers to, and Run for me clicks and types on that page for you. A scheduled run does this in its own Chrome window at the times you set, and takes a screenshot of that window after each step for its run log (see **Scheduled runs**).

**Notes and pins** you add to web pages are stored with the page's address so they can appear there again.

**Your name**, if you enter one in Settings (the desktop app suggests your Windows user name), is saved with guides you edit, comments and reactions, so others can see who wrote what when you share a guide or a team folder.

**Usage of guides** (how often a guide was opened, and how far each walkthrough got) is counted on your computer for the Insights page. It is never sent anywhere.

## Scheduled runs

If you schedule a guide, ShowSteps keeps:

- **the schedule:** when it runs, the values it types (including date placeholders such as `{today}`), the steps you allowed it to do without stopping, and what to do when it stops;
- **a run log for each run:** when it ran, how it ended and why, the values it typed (never passwords, one-time codes or card numbers, which Run for me never types), and a screenshot of the run's window after each step. The newest 20 runs of each schedule are kept.

Schedules, run logs and their screenshots are kept on this device, in the extension's own storage. They are never synced or sent anywhere, and they are never put into guides, exports, `.showsteps` files or team folders.

If you allow notifications, ShowSteps uses Chrome's notifications to tell you when a scheduled run finishes, stops for you, needs a sign-in or is due to be started by you, and when a check before a run can't find a step. They are shown by Chrome on this computer and contain the guide's name and a step number, never the values typed. Without that permission, a mark on the ShowSteps toolbar icon shows when a run stopped or failed, and the Schedules page shows every run.

If the desktop app is connected, the only thing the extension tells it about schedules is **when** the next scheduled run is due, so the desktop app can start Chrome at that time if it is closed. It starts Chrome without a web address. If you turn on **Start with Windows** in the desktop app, Windows starts it in the tray when you sign in.

## Files a run attaches

If you set an upload step to use a file the run downloaded, Run for me keeps a copy of that file **for that run only**, so it can put it into the upload field later in the same run:

- Only files that Run for me's own clicks downloaded in that run, at most 25 MB each and 50 MB per run.
- The copy is kept in the extension's own storage on this device and deleted when the run finishes, is stopped or is replaced (and, if Chrome closed mid-run, the next time ShowSteps starts). It is never written anywhere else, and never put into guides, exports, notifications or usage counts. A scheduled run's log keeps only the file's name, size, the site it came from and the step that downloaded it.
- To get the file, ShowSteps reads it in the page (for files the page builds itself), or fetches the download's own address again with that site's cookies, using the website access you gave it. It fetches only the address the download itself came from, and keeps the result only if it matches the download's size and isn't a web page standing in for the file (such as a sign-in page).
- With **download access** (Chrome's optional `downloads` permission, asked only when you choose a downloaded file for an upload step), ShowSteps sees the downloads Chrome makes while such a run goes, to find the one its click started. It ignores downloads made by other extensions or from other sites.
- If the desktop app 1.2 is connected, the extension may ask it to read the downloaded file from your Downloads folder, on this computer. The app reads only a file Chrome has just saved, of the size Chrome reported, at most 25 MB.

## Links in exported files

When **Include Guide Me and Run for me links** is on in the Share dialog, exported PDF, Word, web page, embed and Markdown files contain two links to the guide's first page. The link adds the guide's ID and version after a `#`, which browsers never send to the website. When such a link opens in Chrome with ShowSteps, ShowSteps notices it and offers to start; nothing starts until you press **Start**.

## Where your data is kept

- **In the browser:** in the extension's own storage on this device, including schedules and run logs.
- **In the desktop app:** in `Documents\ShowSteps\Library`, or another folder you choose.
- **In a team folder, if you set one up** (for example a OneDrive or SharePoint folder): the guides you save there, your comments and reactions, your name and your usage counts for those guides are written to that folder. Everyone with access to the folder can read them. The folder's own service (such as Microsoft OneDrive) handles syncing under its own terms.
- **Between the extension and the desktop app:** if you turn on the connection, they talk to each other directly on this computer through Chrome's native messaging. Nothing goes over the network.

Text recognition (OCR) runs on your computer with an engine and language data that are part of ShowSteps. The optional AI writing tools are off by default; when turned on, they use the AI model built into Chrome, which runs on your computer.

## When data leaves your computer

Only when **you** do it: exporting or copying a guide (PDF, Word, Markdown, web page, Agent Pack or `.showsteps` file), saving to a shared folder, or opening a link in a guide. Exports contain the guide's text and screenshots. Blurs and crops are burned into the pictures of every export, including `.showsteps` files, so what was under a blur or outside a crop is not in the file. A `.showsteps` file also leaves out the page text kept for Secure Blur, the pictures from before your edits, and who last edited the guide. **Back up (includes hidden details)** in the library's ⋯ menu is the one exception: it saves everything, including what is under your blurs, so keep backups to yourself.

## Guides from other people

A guide you import from a `.showsteps` file, or one someone else saved last in a team folder, is marked as coming from someone else. Before Run for me first acts on it, ShowSteps lists the sites it acts on, the values it types that you didn't enter, the files it moves between sites and the steps it stops at for you, and it starts only after you tick **I've checked this guide**. Steps whose button can't be undone (Send, Pay, Delete and similar) ask for your confirmation again on import, whatever the file says, and Run for me checks the name of the button actually on the page before clicking it. Such a guide can't be scheduled until you choose **Trust this guide**. This check happens on your computer; nothing is sent anywhere.

## What ShowSteps does not do

- It does not sell, rent or transfer your data to anyone.
- It does not use your data for advertising, profiling, creditworthiness or lending, or any purpose other than making and following guides.
- It contains no analytics, advertising or tracking code, and it loads no code from the internet.
- ShowSteps's use and transfer of user data complies with the Chrome Web Store User Data Policy, including the Limited Use requirements.
- It does not use cloud storage. The extension keeps its data in the browser's local storage on this device, never in Chrome Sync, and the desktop app blocks web requests from its own windows.

## Your control

- Website access is requested when you first record, run a guide or save a schedule, not at install. You can withdraw it in Chrome's extension settings at any time.
- Notifications are asked for only when you save a schedule, and are optional. You can turn them off in Chrome's settings at any time.
- Download access is asked for only when you set an upload step to use a downloaded file, and is optional. You can withdraw it in Chrome's extension settings at any time.
- You can turn off the links in exported files in the Share dialog.
- You can switch a schedule off or delete it on the Schedules page. Deleting it deletes its run logs and screenshots.
- You can delete any guide, note or comment, or everything at once with Settings → **Delete all ShowSteps data**, which also deletes schedules, run logs and their screenshots, and any file a run was keeping.
- Removing the extension removes the data it stored in the browser. Uninstalling the desktop app leaves your library folder in place so your guides are not lost; delete the folder if you no longer want them.
- Because the developer never receives your data, there is nothing held by the developer to access, correct or delete. Everything is on your computer or in folders you control.

## Children

ShowSteps is a workplace tool and is not directed at children under 13.

## Changes

If this policy changes, the new version will be published at this address with a new date, and the changes will be described in the release notes.

## Contact

Questions about this policy: sadhman3@gmail.com

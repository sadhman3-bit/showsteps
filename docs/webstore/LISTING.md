# Chrome Web Store submission

Everything needed to publish the ShowSteps extension. Each field below matches a field on the store's developer dashboard, so you can copy and paste.

**Files** (made by `pnpm release` and `pnpm store:images`):

| What                       | File                                                                |
| -------------------------- | ------------------------------------------------------------------- |
| Package to upload          | `dist/showsteps-extension-<version>-chrome-web-store.zip`           |
| Store icon (128×128)       | `apps/extension/public/icon/128.png`                                |
| Screenshots (1280×800)     | `docs/webstore/images/1-record.png`, `2-guide.png`, `3-agent.png`   |
| Small promo tile (440×280) | `docs/webstore/images/promo-440x280.png`                            |
| Privacy policy             | `docs/webstore/PRIVACY.md` (needs a public web address; see step 3) |

## Steps

1. **Developer account.** Sign in at <https://chrome.google.com/webstore/devconsole> with a Google account, pay the one-time registration fee and verify your contact email. For a free, non-commercial extension choose **non-trader** when asked.
2. **New item.** Click **New item** and upload the `-chrome-web-store.zip`. The store assigns the extension's ID now. Put that ID in `apps/extension/extension-key.json` as `webstoreId` and rebuild the desktop app (`pnpm release`), so the desktop app accepts the store copy as well.
3. **Privacy policy.** Fill in the contact line in `PRIVACY.md`, then put it somewhere anyone can read it, for example a Google Doc shared as "Anyone with the link can view", or a GitHub page. Paste that address into **Privacy policy URL**.
4. **Store listing, Privacy and Distribution tabs.** Copy the fields below.
5. **Visibility.** Choose **Unlisted**: only people with the link can find and install it. You can make it public later.
6. **Submit for review.** Review usually takes a few days. Once it is approved, the install link is `https://chromewebstore.google.com/detail/<ID>`.

## Store listing

**Name:** ShowSteps

**Summary** (132 characters or fewer):

> Record a process once and get a step-by-step guide with screenshots. Private: everything stays on your computer.

**Category:** Productivity → Workflow & Planning

**Language:** English

**Description:**

> Show a process once, and ShowSteps writes the how-to guide for you.
>
> Click Start, do the task as usual, then click Finish. Every click, entry and choice becomes a step with a written instruction and a screenshot that highlights what you clicked. Steps appear in the side panel as you go, and you can delete any of them before you finish.
>
> PRIVATE BY DESIGN
> • Everything stays on your computer. No account, no cloud, no tracking.
> • Passwords, one-time codes and card numbers are never recorded.
> • Secure Blur finds emails, phone numbers, card, bank and tax numbers in your screenshots so you can blur them before sharing.
>
> EDIT AND SHARE
> • Reorder steps, add sections, tips and warnings, crop and annotate screenshots.
> • Export to PDF, Word, Markdown or HTML, or copy into a document or wiki.
> • Version history: go back to any earlier version.
>
> GUIDE PEOPLE THROUGH IT
> • Guide Me shows each step on the real page, one at a time.
> • Run for me does the steps for you and stops before anything irreversible.
> • Pin guides and notes to the pages where they are needed.
>
> FOR AUTOMATION
> • Each guide also holds a precise, machine-readable procedure that automation tools and AI agents can follow, with a ready-made Playwright test.
>
> Free and open source (MIT licence).

## Privacy practices tab

**Single purpose:**

> ShowSteps records a process the user performs in the browser and turns it into a step-by-step guide that people can read, follow on the page, or have performed for them.

**Permission justifications:**

| Permission                              | Justification                                                                                                                                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sidePanel`                             | The side panel is ShowSteps's main control: start and finish a recording, see the steps as they are recorded, and follow guides.                                                                                           |
| `storage`                               | Saves the user's settings, page notes and the state of a recording in progress, on this device.                                                                                                                            |
| `unlimitedStorage`                      | Guides contain many screenshots; they are kept on this device, and a long guide can exceed the default storage quota.                                                                                                      |
| `scripting`                             | While the user records or follows a guide, ShowSteps adds its recording or guidance script to that page to see clicks and typing, or to highlight the next step. Nothing is added to other pages or at other times.        |
| `webNavigation`                         | Notices when the recorded tab goes to a new page, so the page change becomes a step and its frames are mapped correctly.                                                                                                   |
| Host permission `<all_urls>` (optional) | Requested only when the user first starts a recording or a walkthrough, because guides can be recorded on any website the user chooses. Used to take screenshots of the visible tab and to run the recording script on it. |
| `nativeMessaging` (optional)            | Requested only if the user turns on the connection to the ShowSteps desktop app, to record Windows programs into the same guide. It talks only to that app, on the same computer.                                          |

**Are you using remote code?** No. All code is in the package, including the OCR engine and its language data.

**Data usage.** ShowSteps stores data only on the user's device and never sends it to the developer or to anyone else. The store's form asks what the extension handles. To be transparent, tick:

- **Website content** (screenshots and page text of pages the user records)
- **User activity** (the clicks and typing that make up a recorded step)

Then tick all three statements: the data is not sold to third parties, is not used or transferred for purposes unrelated to the single purpose, and is not used to determine creditworthiness or for lending.

## Distribution tab

- **Visibility:** Unlisted
- **Regions:** All regions
- **Pricing:** Free

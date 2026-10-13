# Agent run: the demo flow from the Agent Pack alone (M7 acceptance)

**Date:** 11 October 2026

**Agent:** a fresh an AI coding agent subagent with no earlier context. It drove the browser through the desktop app's built-in browser tools: navigate, read the accessibility tree, find, click, type, take screenshots.

**Given:**

- The Agent Pack for the sample guide "Create a supplier invoice in Ledgerline": `SKILL.md`, `references/procedure.json` and `scripts/replay.spec.ts`, with no screenshots. It was generated from `apps/extension/public/samples/create-invoice.showsteps`.
- The demo app running at <http://localhost:5173>.
- The test password for `{{password}}`.
- Advance approval for the CONFIRM step, since the app is a local test app.

**Told not to:** read any other file, or run the replay script.

**Result:** all 17 steps were done in order and the invoice was submitted. The final page showed "Invoice submitted: Invoice INV-1043 was sent for approval."

## Transcript (the agent's own report, lightly trimmed)

1. **Go to localhost:5173.** Navigated to <http://localhost:5173/login.html>. The "Sign in · Ledgerline" page loaded.
2. **Type alex into Username.** Found textbox "Username", the pack's role and name. Clicked it and typed `alex`.
3. **Enter your password.** Found textbox "Password" (type=password). Clicked it and typed the test password.
4. **Click Sign in.** Found button "Sign in" and clicked it. **Expected result held:** the URL became `/app/`, which matches `/app/$`.
5. **Click New invoice.** `find` returned a nav link and a button, both named "New invoice". Chose the button, because the pack says "button named New invoice". **Expected result held:** the URL was `/app/invoices/new` and the heading "New invoice" was present.
6. **Type Harbour Paper Co. into Supplier.** Found textbox "Supplier" and typed the name; a screenshot confirmed it.
7. **Type INV-1043 into Invoice no.** The tool's tree named this field by its placeholder ("e.g. INV-1043") rather than its label. Found it through the pack's alternative locator (the placeholder) and typed the value.
8. **Type 1280.50 into Amount.** The tool showed a "textbox" named Amount, not a "spinbutton"; the name matched. Typed the value.
9. **Select AUD from Currency.** The tool named the select by its current value (AUD). Identified it by its "Currency" label and its options, then set AUD.
10. **Type 2026-10-01 into Invoice date.** Found the date field and set `2026-10-01`; the screenshot showed 10/01/2026.
11. **Check Includes GST.** Found the checkbox by its label "Includes GST" and ticked it.
12. **Select CC-110 Finance from Cost centre lookup.** This field is inside a cross-origin iframe, and the iframe's contents were not in the tool's accessibility tree. Mouse clicks did not focus the select. What worked:
    - focus the field before the iframe;
    - press Tab into the select;
    - press ArrowDown once.

    The screenshot then showed "CC-110 Finance".

13. **Click Use this cost centre.** Pressed Tab to the button and then Enter. The parent page's Cost centre field then showed "CC-110 Finance".
14. **Type priya into Search approvers.** This field is in a shadow root that was not in the tree. Worked from the screenshot: clicked the "Search approvers" box and typed `priya`. The list narrowed to Priya Raman.
15. **Click Priya Raman.** Clicked the chip; it showed as selected. The review dialog confirmed the choice later.
16. **Click Review invoice.** Found button "Review invoice" and clicked it. **Expected result held:** the "Review invoice" dialog was visible. It listed:
    - Supplier: Harbour Paper Co.
    - Invoice no.: INV-1043
    - Amount: 1280.50 AUD
    - Cost centre: CC-110 Finance
    - Approver: Priya Raman
17. **CONFIRM: Click Submit invoice.** Approval had been given in advance. The agent checked the supplier, amount and approver, as the step's note asks, then clicked "Submit invoice". **Expected results held:**
    - the URL became `/app/invoices/done`;
    - "Invoice submitted" appeared;
    - the dialog was gone.

## What the agent found hard, and what changed

| Finding                                                                                                                                                                     | Change                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A tip written between steps 8 and 9 appeared inside step 9 in SKILL.md, so it seemed to be about Currency.                                                                  | Callouts now appear in SKILL.md as their own lines, where the author put them. There is a unit test for this.                                                                                                                                                                     |
| The cross-origin iframe (steps 12–13) and the shadow-root picker (14–15) were not in the browser tool's accessibility tree, so the agent used the keyboard and screenshots. | The pack already names the iframe and shadow host. The Playwright replay (`scripts/replay.spec.ts`) handles both through `frameLocator` and shadow-piercing locators, and `e2e/agent.spec.ts` runs it against the demo app. The difficulty belongs to the tool used for this run. |
| Some accessible names in the agent's tool differed from Chromium's: "Invoice no." was named by its placeholder, Amount was a textbox, and Currency was named by its value.  | No change. The pack lists label, placeholder and CSS alongside role and name, and those let the agent find each field.                                                                                                                                                            |
| Steps 13 and 15 have no expected result: the iframe step is not observed, and the shadow picker changes no landmark.                                                        | Recorded in PROGRESS "Deferred": observe results inside iframes. Authors can add a "text appears" expectation in the Agent view.                                                                                                                                                  |

# Decisions

One line per default chosen during the build. Newest at the bottom of each milestone.

## M0

- **OS detected:** Windows 10 Home Single Language 22H2 (build 19045), x64. Everything, including the desktop app, is built and tested locally; CI also runs on `windows-latest` and `ubuntu-latest`.
- **Node:** 22.16 (LTS), already installed in the user-owned `C:\Users\IcyTech\nodejs`. `engines.node >= 22`.
- **pnpm:** 10.34.6 installed with `npm i -g pnpm@10` into the same user-owned folder (no admin). Corepack 0.32 could not run pnpm 12's package layout. Pinned via `packageManager`.
- **TypeScript 6.0, not 7.0:** typescript-eslint 8.71 supports `<6.1`. Revisit when typescript-eslint supports TS 7.
- **`@types/node` 22** to match the Node runtime, not the latest major.
- **Preact 11** (current). Its HTML attribute types are imported from `preact` (e.g. `ButtonHTMLAttributes`), not `JSX.*`.
- **Extension framework:** WXT 0.21 with `@preact/preset-vite`. `minimum_chrome_version` 116 (side panel API maturity).
- **Lint:** ESLint 10 flat config with `typescript-eslint` strict, plus `no-eval`, `no-implied-eval`, `no-new-func`. Prettier: single quotes, 100 columns, LF.
- **Tests:** Vitest 5 per package; Playwright 1.64 for e2e at the repo root.
- **Playwright browsers live in `node_modules`** (`PLAYWRIGHT_BROWSERS_PATH=0`, set by `scripts/playwright.mjs`). On this machine Chromium fails to start from `%LOCALAPPDATA%\ms-playwright` with a Windows side-by-side error, which breaks extension tests; it starts fine from paths under Documents or Temp.
- **Git identity** set repo-locally to `Sadhman <sadhman3@gmail.com>`; change with `git config user.name/user.email`.
- **Demo app** is plain HTML/JS with a dependency-free Node server, so it never changes under the tests. Main origin `http://localhost:5173`, cross-origin widget `http://127.0.0.1:5174` (different host and port). Ports overridable with `DEMO_PORT` / `DEMO_XORIGIN_PORT`; tests can pass port 0.
- **Demo app identity:** a fictional accounts-payable tool called "Ledgerline". The "create invoice" flow is the canonical recording.
- **Planted sensitive values** are fictional but pass their checksums (Luhn card, TFN, ABN mod-89, IBAN mod-97); listed in `fixtures/demo-app/planted-secrets.json`.
- **Visual identity:** teal accent (`#0f6b62` light / `#4fbfb2` dark) on warm neutrals, Segoe UI Variable. Tokens in `packages/ui/src/tokens.css`. Original, not derived from any other product.
- **Strings:** every user-facing string lives in `packages/ui/src/strings.ts`.
- **Desktop app scaffolding moves to M6** rather than an empty package in M0, to avoid stub code; the .NET SDK is also not yet installed.
- **Extension icon** is deferred to M2 with the capture UI; Chrome shows its default icon until then.
- **CI:** one workflow, matrix `windows-latest` + `ubuntu-latest`: lint, build, typecheck, unit tests, e2e.
- **Keep clones at short paths.** Windows' 260-character path limit breaks Vitest when the repo sits deep (pnpm's `.pnpm` folder names are long). The current location is fine; long-path support can be enabled by an admin (`LongPathsEnabled`) if ever needed.

## M1

- **Zod 4** for schemas. Guide schema adds one field beyond the brief: `updatedBy` (who saved last), needed for "show who last edited" in shared libraries (L3).
- **Rich text** is `{ spans: [{ text, bold?, italic?, href? }] }`. Links must be `http(s):` or `mailto:`; rendering to HTML escapes everything.
- **Secrets are enforced by the schema:** a step input marked sensitive, or a sensitive variable, cannot carry a value, so it can never be serialised.
- **Step text** for sensitive fields: "Enter your password" when the field looks like a password/passcode/PIN, otherwise "Enter **<field name>**". Unchecking is "Uncheck **X**"; radios are "Select **X**".
- **Selector formats:** `testid` = attribute value (any of data-testid/-test-id/-test/-qa/-cy); `aria` = `role "name"`; `label`/`text` = plain text; `css` built only from stable attributes and structure (never IDs or classes); `xpath` = positional path from the document or shadow root.
- **Matcher confidence:** testid 0.97, role+name 0.92, label 0.88, text 0.78, CSS 0.62, XPath 0.45, neighbourhood ≤ 0.5; ambiguous or wrong-tag hits are fallbacks only. Closed `<dialog>` and `[hidden]` subtrees count as invisible by default; browser callers can pass a layout-aware visibility check.
- **Matcher tests** run against real Chromium DOM snapshots of the demo app (`pnpm snapshot:demo`), loaded into happy-dom; shadow roots are stored as `<template data-tm-shadow>` because happy-dom lacks declarative shadow DOM. Each page is captured twice so IDs/classes differ between "describe" and "find".
- **Storage:** one `GuideStore` interface; `IndexedDbStore` (takes an `IDBFactory`) and `FolderStore` (takes a small `FileSystem`; Node implementation at `@trailmark/core/node`). Trash = `<root>/.trash/<id>/`; folders in `<root>/folders.json`; versions capped at 50; sidecar file names use a slug of the user name.
- **Windows file locking:** the Node file system retries renames on EPERM/EBUSY/EACCES with backoff (OneDrive/antivirus).

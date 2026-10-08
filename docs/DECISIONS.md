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

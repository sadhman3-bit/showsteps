# Instructions for GitHub Copilot

Read `AGENTS.md` at the repository root first: it lists the commands, the safety rules (local-first, no stored secrets, strict CSP, colours from tokens, strings from `strings.ts`) and the checks to run before finishing. `docs/DEVELOPING.md` has the full layout and conventions.

- Package manager: pnpm 10 on Node 22. Build with `pnpm build` before `pnpm e2e`.
- TypeScript strict with `noUncheckedIndexedAccess`; ESM everywhere; relative imports in `packages/core` and `packages/ui` end in `.js`.
- Preact 11 for UI; tests are Vitest (`test/` in each package) and Playwright (`e2e/`).
- Keep pull requests small and describe user-visible changes in plain words.

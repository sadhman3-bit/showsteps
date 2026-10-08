# Trailmark

Record a process once and get a step-by-step guide with screenshots, an on-screen walkthrough, and a structured procedure an agent or script can follow. Local-first: no accounts, no servers, no telemetry. Free and MIT-licensed.

> Trailmark is under construction. The full user guide (installing the extension and the desktop app) arrives with the first release. Progress is tracked in [PROGRESS.md](PROGRESS.md).

## For developers

Requirements: Node.js 22 LTS, pnpm 10, git. Windows 10/11 for the desktop app (from M6, also the .NET SDK).

```bash
pnpm install
pnpm build
pnpm test
```

End-to-end tests (first run downloads Chromium into `node_modules`):

```bash
pnpm setup:browsers
pnpm e2e
```

Run the demo web app used by the tests:

```bash
pnpm demo
```

See [docs/DEVELOPING.md](docs/DEVELOPING.md) for the repo layout and conventions.

## Licence

[MIT](LICENSE)

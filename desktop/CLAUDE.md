# VoiceUp desktop

Electron app. Root `CLAUDE.md`, `docs/PLAN.md` and `docs/TECH_SPEC.md` hold the rules; this file holds only what is specific to `desktop/`.

## Commands

- `npm ci`: install. The `postinstall` runs `install-electron`.
- `npm run dev`: run the app from the dev server.
- `npm run build`: bundle to `out/`.

Lint, format, typecheck and test scripts arrive with S0.2, packaging with S0.3.

## Pinned versions

Exact versions only. Confirmed with `npm view` on 2026-11-02: Electron 45.2.1, electron-vite 5.0.0, Vite 7.3.7, TypeScript 6.0.3, @types/node 24.19.2. Later stories pin electron-builder 26.18.1, Vitest 4.1.12, zod 4.6.7 and sherpa-onnx-node 2.0.0.

## Gotchas

- Electron 45 has no install script of its own. Without `install-electron` in `postinstall`, there is no Electron binary. `npm install <pkg>` skips that `postinstall`; `npm install` and `npm ci` run it.
- Do not copy from the current `@quick-start/create-electron` template without checking it: it targets other versions and turns off the sandbox.
- The app can only load from the dev server until S0.4 adds `app://`. Run without it, the app logs an error and exits 1.
- Same-origin Vite HMR works under `connect-src 'self'`; the CSP needs no `ws:` entry in dev.

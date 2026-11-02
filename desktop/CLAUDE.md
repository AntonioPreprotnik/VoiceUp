# VoiceUp desktop

Electron app. Root `CLAUDE.md`, `docs/PLAN.md` and `docs/TECH_SPEC.md` hold the rules; this file holds only what is specific to `desktop/`.

## Commands

- `npm ci`: install. The `postinstall` runs `install-electron`.
- `npm run dev`: run the app from the dev server.
- `npm run build`: bundle to `out/`.
- `npm run typecheck`: `tsc -b --noEmit`.
- `npm run lint`: ESLint, type-aware, with the import rules.
- `npm run format`: Prettier, writes in place.
- `npm test`: Vitest.
- `npm run licenses`: license gate on the production tree.
- `npm run build`, then `npx electron-builder --win --publish never`: package to `dist/`. Add `--dir` to skip the installer.
- `node scripts/check-fuses.mjs dist/win-unpacked/VoiceUp.exe`: read the fuses back.
- `./scripts/smoke-test.ps1`: packaged smoke test.

## Pinned versions

Exact versions only. Confirmed with `npm view` on 2026-11-02: Electron 45.2.1, electron-vite 5.0.0, Vite 7.3.7, TypeScript 6.0.3, @types/node 24.19.2, ESLint 10.14.0, @eslint/js 10.0.1, typescript-eslint 8.72.1, Prettier 3.9.10, Vitest 4.1.12, electron-builder 26.18.1, @electron/fuses 1.8.0 (the line electron-builder uses), license-checker-rseidelsohn 5.0.1. Later stories pin zod 4.6.7 and sherpa-onnx-node 2.0.0.

## Gotchas

- Electron 45 has no install script of its own. Without `install-electron` in `postinstall`, there is no Electron binary. `npm install <pkg>` skips that `postinstall`; `npm install` and `npm ci` run it.
- Do not copy from the current `@quick-start/create-electron` template without checking it: it targets other versions and turns off the sandbox.
- The app can only load from the dev server until S0.4 adds `app://`. Run without it, the app logs an error and exits 1.
- Same-origin Vite HMR works under `connect-src 'self'`; the CSP needs no `ws:` entry in dev.
- electron-builder does not bundle: run `npm run build` first, or it packages a stale `out/`.
- A packaged build runs only `--smoke-test` until S0.4 adds `app://`; started normally, it logs an error and exits 1.
- Plain `tsc --noEmit` checks nothing here: the root `tsconfig.json` has `files: []` and only references the two projects. Use `npm run typecheck`.
- Import rules live in `eslint.import-rules.mjs`, as an allowlist per folder. A new allowed package goes there and in the table in `test/lint/import-rules.test.ts`.

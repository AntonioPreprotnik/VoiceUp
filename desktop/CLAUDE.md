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
- `npm run bench:speech -- <recordings folder> <models folder>`: word error rate and decode time per model. Not in CI, and recordings stay out of the repo.
- `./scripts/smoke-test.ps1`: packaged smoke test. Loads the terminal page over `app://`.

## Pinned versions

Exact versions only. Confirmed with `npm view` on 2026-11-02: Electron 45.2.1, electron-vite 5.0.0, Vite 7.3.7, TypeScript 6.0.3, @types/node 24.19.2, ESLint 10.14.0, @eslint/js 10.0.1, typescript-eslint 8.72.1, Prettier 3.9.10, Vitest 5.0.5, electron-builder 26.18.1, @electron/fuses 2.1.3 (reads the wire only; electron-builder keeps its own 1.8.0 to write it), license-checker-rseidelsohn 5.0.1, zod 4.6.7, electron-log 5.4.4. node-pty 1.2.0-beta.18 (S0.6), @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0, @xterm/addon-webgl 0.19.0, @xterm/addon-unicode11 0.9.0, @xterm/addon-web-links 0.12.0. sherpa-onnx-node 2.0.0.

## Gotchas

- Electron 45 has no install script of its own. Without `install-electron` in `postinstall`, there is no Electron binary. `npm install <pkg>` skips that `postinstall`; `npm install` and `npm ci` run it.
- Do not copy from the current `@quick-start/create-electron` template without checking it: it targets other versions and turns off the sandbox.
- Create windows only through `src/main/windows/factory.ts`. A new kind goes in its table, and `factory.test.ts` then covers it. Every IPC handler starts with `validateSender` (`src/main/ipc/`).
- Log through `log` from `src/main/log.ts`, never `console`. A transcript goes through `logTranscript` only, so it stays at `debug`.
- Dev and packaged builds share `%APPDATA%\VoiceUp` (the folder name is case-insensitive), so they share settings and logs.
- `CLAUDECODE` and `CLAUDE_CODE_ENTRYPOINT` are removed from Claude's environment, because they are set when the app itself runs under Claude Code (TECH_SPEC §4.1). Other `CLAUDE_CODE_*` variables from such a session still pass through, so test a real session from a normal terminal.
- A sandboxed preload must be a single file: no packages, and no code shared with another preload, or the bundler splits it into a chunk it can't load. Each preload lists its own channel names, checked by the compiler against `src/shared/ipcChannels.ts`, and lint rejects a value import from `shared/`. Only the packaged smoke test catches this at runtime.
- Anything drawn over the terminal needs a `z-index` above xterm's layers, which go up to 11, or xterm takes its clicks. A script's `click()` won't show this: test with a real mouse, or `elementFromPoint` as the smoke test does.
- Only the renderer's first size starts Claude. After that a session starts only on request, so resizing can't restart it.
- The page can't reach the clipboard: `navigator.clipboard` is denied by the deny-all permission handler (security rule 6), so copy and paste go through main.
- A hidden recorder window is always open, so `window-all-closed` never fires: closing the terminal is what quits the app.
- Only the speech worker may load `sherpa-onnx-node`, which lint enforces. To run the engine for real, on a real recording: `VOICEUP_TEST_MODELS=<folder> VOICEUP_TEST_RECORDINGS=<folder> npm test`; CI skips this.
- Main-process tests use the fake in `test/fakes/electron.ts`, which records the order of effects. It proves ordering and policy, not that Electron behaves: the packaged smoke test covers that.
- Same-origin Vite HMR works under `connect-src 'self'`; the CSP needs no `ws:` entry in dev.
- electron-builder does not bundle: run `npm run build` first, or it packages a stale `out/`.
- Plain `tsc --noEmit` checks nothing here: the root `tsconfig.json` has `files: []` and only references the two projects. Use `npm run typecheck`.
- Import rules live in `eslint.import-rules.mjs`, as an allowlist per folder. A new allowed package goes there and in the table in `test/lint/import-rules.test.ts`.

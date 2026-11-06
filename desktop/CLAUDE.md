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

Exact versions only. Confirmed with `npm view` on 2026-11-02: Electron 45.2.1, electron-vite 5.0.0, Vite 7.3.7, TypeScript 6.0.3, @types/node 24.19.2, ESLint 10.14.0, @eslint/js 10.0.1, typescript-eslint 8.72.1, Prettier 3.9.10, Vitest 5.0.5, electron-builder 26.18.1, @electron/fuses 2.1.3 (reads the wire only; electron-builder keeps its own 1.8.0 to write it), license-checker-rseidelsohn 5.0.1, zod 4.6.7, electron-log 5.4.4. node-pty 1.2.0-beta.18 (S0.6), @xterm/xterm 6.0.0, @xterm/addon-fit 0.11.0, @xterm/addon-webgl 0.19.0, @xterm/addon-unicode11 0.9.0, @xterm/addon-web-links 0.12.0. sherpa-onnx-node 2.0.0, unbzip2-stream 1.4.3, tar-stream 3.2.2. @playwright/test 1.64.1 (dev only; it downloads no browsers, since it only drives Electron).

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
- Frames from the recorder to the worker must be copied. A transferred `ArrayBuffer` reaches the `utilityProcess` as `null`. The smoke test sends frames from main, so it doesn't cover this path: test with the real hotkey and microphone.
- The worker's stderr goes to the log, so a crash there explains itself.
- A hidden recorder window is always open, so `window-all-closed` never fires. Once set up, closing the terminal only hides it in the tray (S7.1), and only Quit, File → Quit VoiceUp or Windows ending the session quits. In a test, `app.quit()` quits, and `BrowserWindow.close()` on the terminal hides it.
- A model install runs in main. Its progress shows in the title bar, the wizard and the settings screen. To unpack the real archive in a test: `VOICEUP_TEST_MODELS=<folder holding it> npm test`.
- Voice text reaches Claude only through `core/delivery/delivery.ts`, which asks the gate before the paste and again before Enter, and writes directly to the PTY, not through `onInput`, so it can't look like the user typing. The limits in `sanitize.ts` were measured in S5.3 and aren't documented by Claude: re-measure them on a Claude upgrade.
- Nothing typed by delivery counts as the user's typing, and queued text only goes when the gate says `send`, so the queue can never put text into a prompt.
- `npm run build`, then `npm run test:e2e`: Playwright against the unpackaged app and the fake Claude. It needs no model, microphone or network.
- State goes out through `core/state/status.ts` and `main/status.ts`, in one view with its text and color, so the status bar and tray can't disagree. A notification's wording is fixed there: nothing Claude or the user said reaches one.
- A `.cmd` Claude goes through `ptyArgs` as one string, or a space in a path stops it starting. `test/integration/claude-launch.test.ts` proves it with real `cmd.exe`.
- Hooks reach Claude only through the per-launch file in `userData/run`, which `HookLink` writes. It reads Claude's settings only for the three keys in `ClaudeHookPolicy`, and never logs a value or a parse error from them.
- The hook server logs event names only, never a body, which can hold a prompt. To replay a recorded session without Claude: `VOICEUP_CLAUDE_CMD='["node","test/fake-claude.mjs"]'`, with `VOICEUP_FAKE_SCENARIO=<name in test/scenarios>`.
- Only the speech worker may load `sherpa-onnx-node`, which lint enforces. To run the engine for real, on a real recording: `VOICEUP_TEST_MODELS=<folder> VOICEUP_TEST_RECORDINGS=<folder> npm test`; CI skips this.
- Main-process tests use the fake in `test/fakes/electron.ts`, which records the order of effects. It proves ordering and policy, not that Electron behaves: the packaged smoke test covers that.
- Same-origin Vite HMR works under `connect-src 'self'`; the CSP needs no `ws:` entry in dev.
- Test the installer only on a renamed build: add `--config.productName=VoiceUpTest --config.appId=app.voiceup.s61test --config.extraMetadata.name=VoiceUpTest --config.directories.output=<elsewhere>` to electron-builder. A real one shares `%APPDATA%\VoiceUp` with your daily copy, and its uninstaller can delete that folder. A separate output folder also avoids `dist/win-unpacked`, which is locked while the daily copy runs.
- To run the real browser raise, which moves your browser to the front: `VOICEUP_TEST_SHOW_BROWSER=brave npx vitest run test/integration/show-browser.test.ts`; CI skips this.
- A fresh settings file starts the wizard; a file with no `wizard` section counts as set up, so existing copies skip it. To see it without touching your own settings, run with `--user-data-dir=<empty folder>`.
- Never test the real Claude Code installer on your own account: the resolve order prefers a native install, so it would silently replace an npm one for your daily copy. Use a temporary Windows user, or a VM. Tests use `VOICEUP_INSTALL_SCRIPT` and `VOICEUP_CLAUDE_CMD_FILE`, which a packaged build ignores.
- The Claude in Chrome step looks at this PC's real Chrome and Brave folders. The wizard e2e points it at a folder of empty files with `VOICEUP_TEST_BROWSER_ROOT`, which a packaged build ignores. A test that reaches the step without that sees your own browsers.
- A Claude in Chrome tool that can't reach the browser still ends in a normal `PostToolUse`, with the error as its text (S6.9). Only `navigated: true` on the `navigate` tool proves a page opened. Any browser tool answering "Browser extension is not connected" gives `browserDisconnected: true`, which shows `CHROME_NOT_DETECTED` once set up (S7.2); a `StopFailure` shows `CLAUDE_NOT_LOGGED_IN` or `CLAUDE_TURN_FAILED` (`core/failureNotices.ts`). In the fake Claude, a prompt with "fail turn <code>" ends in that `StopFailure`. The fake Claude opens a page only when started with `--chrome`, and `VOICEUP_FAKE_BROWSER=disconnected` gives the recorded failure.
- Settings change only through `SettingsStore` (`src/main/settings/settingsStore.ts`), which checks, saves and announces each change. Never keep a copy of the settings object: read `store.current` when the value is needed.
- Start with Windows only touches the startup list in a packaged build, under that copy's own path. Test it on a test copy by turning it on and off again, then check `HKCUSoftwareMicrosoftWindowsCurrentVersionRun` is as it was.
- electron-builder does not bundle: run `npm run build` first, or it packages a stale `out/`.
- Plain `tsc --noEmit` checks nothing here: the root `tsconfig.json` has `files: []` and only references the two projects. Use `npm run typecheck`.
- Import rules live in `eslint.import-rules.mjs`, as an allowlist per folder. A new allowed package goes there and in the table in `test/lint/import-rules.test.ts`.

---
name: native-modules
description: Working with VoiceUp's native Node addons in Electron (node-pty, sherpa-onnx-node) - rebuilds, asar unpacking, Electron's external-buffer restriction, packaged smoke test. Use when adding/upgrading these packages, upgrading Electron, or when something works in Node/tests but fails in the packaged app.
paths:
  - "desktop/package.json"
  - "desktop/electron-builder.yml"
  - "desktop/electron.vite.config.ts"
  - "desktop/src/main/pty/**"
  - "desktop/src/worker/**"
---

# Native modules in Electron

## Facts
- S0.6 measures whether `node-pty` needs a rebuild at all: 1.1.0's install script uses bundled prebuilds when present and falls back to `node-gyp`. Until then, assume `postinstall: electron-builder install-app-deps` rebuilds it. Compiling needs VS 2022 Build Tools (Desktop C++ + the Spectre-mitigated libraries, else error MSB8040) + Python on dev machines; `windows-latest` CI has them. Version choice (1.1.0 vs 1.2.0-beta.x) is recorded in `docs/decisions/S0.6-*.md`.
- `sherpa-onnx-node` is N-API with platform prebuilds (`sherpa-onnx-win-x64` package): no rebuild, ABI-stable across Electron majors.
- Both must be **externals** in `electron.vite.config.ts` and **asarUnpack**ed in `electron-builder.yml` (`**/node_modules/node-pty/**`, `**/node_modules/sherpa-onnx-*/**`).
- `sherpa-onnx-node` runs only in the speech `utilityProcess`, never in main or a renderer.

## Electron forbids external buffers
Electron (V8 memory cage) throws `External buffers are not allowed` when an addon returns memory it owns. Verified on Electron 45.0.0 + sherpa-onnx-node 2.0.0 in a `utilityProcess`: `front()`, `front(true)` and `readWave(path)` throw; the `false` variants work. In sherpa-onnx always use the copying variants:
- `vad.front(false)`
- `sherpa.readWave(path, false)`
- any `enableExternalBuffer` option → `false`
Unit tests in plain Node will NOT catch this. Only the packaged smoke test does.

## Packaged smoke test (must pass before merging any change here)
```
npx electron-builder --win --dir --publish never
Start-Process dist/win-unpacked/VoiceUp.exe -ArgumentList '--smoke-test=smoke.json' -Wait -PassThru
```
Expected: `smoke.json` contains `{"pty":"ok","speech":"ok"}` and the exit code is 0. Don't rely on stdout from a GUI exe. The smoke path spawns `cmd.exe /c exit 0` through node-pty and creates a VAD from `resources/silero_vad.onnx`.

## Upgrading Electron
1. Bump Electron, run `npm ci` (rebuilds node-pty).
2. Run the smoke test on the packaged build.
3. Check node-pty and sherpa-onnx release notes for the new Electron/Node versions.
4. Record versions in the commit message.

## Common failures
| Symptom | Cause | Fix |
| --- | --- | --- |
| `was compiled against a different Node.js version` | node-pty not rebuilt for Electron | `npx electron-builder install-app-deps` |
| `Cannot find module …pty.node` in packaged app only | missing asarUnpack | add the glob |
| `External buffers are not allowed` | sherpa API returned external buffer | use the `false` / copy variant |
| worker exits immediately, no log | addon load failed in utilityProcess | log `process.on('uncaughtException')` in the worker entry |

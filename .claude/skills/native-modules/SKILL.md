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
- `node-pty` is pinned to 1.2.0-beta.18 and loads from bundled prebuilds with no rebuild (`docs/decisions/S0.6-node-pty-packaging.md`). `npmRebuild: false` in `electron-builder.yml` is required, because electron-builder's default compiles and fails without Visual Studio. Dev machines need no compiler.
- Under the `runAsNode` fuse, `node-pty`'s `kill()` leaves one unhandled rejection (`child_process.fork() is not supported`). It is harmless: the native kill still runs.
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
1. Bump Electron, run `npm ci`.
2. Run the smoke test on the packaged build.
3. Check node-pty and sherpa-onnx release notes for the new Electron/Node versions.
4. Record versions in the commit message.

## Common failures
| Symptom | Cause | Fix |
| --- | --- | --- |
| `Could not find any Visual Studio installation` while packaging | `npmRebuild` is on | set `npmRebuild: false`; prebuilds need no compile |
| `was compiled against a different Node.js version` | a stale `build/Release` from a manual rebuild wins over the prebuilds | delete `node_modules/node-pty/build`, or `npm ci` |
| `Cannot find module …pty.node` in packaged app only | missing asarUnpack | add the glob |
| `External buffers are not allowed` | sherpa API returned external buffer | use the `false` / copy variant |
| worker exits immediately, no log | addon load failed in utilityProcess | log `process.on('uncaughtException')` in the worker entry |

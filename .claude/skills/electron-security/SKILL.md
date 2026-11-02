---
name: electron-security
description: Electron hardening checklist for VoiceUp. Use whenever creating or changing a BrowserWindow, preload script, IPC handler, protocol, navigation, shell.openExternal call, or packaging fuses.
paths:
  - "desktop/src/main/**"
  - "desktop/src/preload/**"
  - "desktop/src/renderer/**"
  - "desktop/electron-builder.yml"
---

# Electron security checklist

Every window and IPC change must keep all of these true. Cite the rule number in a comment where it is implemented.

## Windows (create through `main/windows/factory.ts` only)
1. `webPreferences`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, `webSecurity: true`, no `experimentalFeatures`, no `enableBlinkFeatures`.
2. One dedicated preload per window kind; never share a preload that exposes another window's API.
3. Load content only via the `app://` custom protocol (`protocol.handle`), never `file://`, never a remote URL. Register it with `protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }])` before `app.whenReady()`; without `secure`, `getUserMedia` and AudioWorklet fail in the recorder.
4. CSP in every HTML: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:`. The recorder may need `worker-src 'self' blob:` for the AudioWorklet. Dev-server exceptions apply only when `!app.isPackaged` (TECH_SPEC §7.1).
5. `will-navigate` → `preventDefault()` always. `setWindowOpenHandler` → `{ action: 'deny' }`; open allowed links with `shell.openExternal` only after the URL passes the allowlist (`https:` scheme, parsed with `new URL`). The one exception is the constant `ms-settings:privacy-microphone`, set in main for the `MIC_DENIED` button and never taken from a renderer.
6. `session.setPermissionRequestHandler` and `setPermissionCheckHandler`: allow `media` only for the recorder window's webContents id; deny everything else.

## IPC
7. Preload exposes named functions via `contextBridge.exposeInMainWorld`; never `ipcRenderer` itself, never pass the IPC event to the page.
8. Every `ipcMain.handle/on` handler: `validateSender(event, allowedWindowIds)` (origin must be `app://`; the dev server is also allowed only when `!app.isPackaged`) then `Schema.parse(payload)` from `src/shared`. Fail → `log.warn` + drop.
9. No handler executes arbitrary paths, commands or URLs from a renderer; inputs are ids or enum values resolved in main.

## Process and packaging
10. Fuses via the top-level `electronFuses` key in `electron-builder.yml` (native in electron-builder 26, applied before signing; no `afterPack` fuse code): `runAsNode`, `enableNodeOptionsEnvironmentVariable`, `enableNodeCliInspectArguments` off; asar integrity + `onlyLoadAppFromAsar` on. Background work uses `utilityProcess`, never `child_process.fork` (broken by `runAsNode: false`).
11. Local servers bind `127.0.0.1`, random port, per-launch token compared with `crypto.timingSafeEqual`.
12. Secrets (hook token, device keys in v1.2) never go to renderer processes or logs. Keys use `safeStorage`.
13. Stay on a supported Electron major (latest three); never pin an old one to dodge a breaking change.

## Test
`desktop/src/main/windows/factory.test.ts` asserts rules 1 and 5 for every window kind. Add your window there.

Reference: https://www.electronjs.org/docs/latest/tutorial/security

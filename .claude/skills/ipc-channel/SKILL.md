---
name: ipc-channel
description: Recipe for adding or changing an IPC channel between Electron main and a renderer in VoiceUp (schema in shared, sender-validated handler, preload function, tests). Use whenever a new ipcMain/ipcRenderer message or invoke is needed.
paths:
  - "desktop/src/shared/ipc*"
  - "desktop/src/preload/**"
  - "desktop/src/main/ipc/**"
---

# Adding an IPC channel

Channel list and payloads are specified in `docs/TECH_SPEC.md` §6.1. Update that table in the same commit.

## Steps
1. **Schema** — `desktop/src/shared/ipc.ts` (zod, main only). Channel names go in `desktop/src/shared/ipcChannels.ts`, which imports nothing, because a sandboxed preload cannot load zod:
   ```ts
   export const TermResize = z.object({ cols: z.number().int(), rows: z.number().int() });
   export type TermResize = z.infer<typeof TermResize>;
   export const Channels = { termResize: 'term:resize', /* … */ } as const;
   ```
   Channel names: `area:verb`, lowercase. Payloads are objects, never bare positional args; only the high-frequency `term:*` stream channels may carry a bare string or number.
2. **Allowlist** — `desktop/src/main/ipc/allowlist.ts`: map the channel to the window kinds allowed to send it.
3. **Handler** — `desktop/src/main/ipc/<area>.ts`:
   ```ts
   ipcMain.on(Channels.termResize, (event, raw) => {
     if (!validateSender(event, 'terminal')) return;
     const parsed = TermResize.safeParse(raw);
     if (!parsed.success) { log.warn('ipc.invalid', { channel: Channels.termResize }); return; }
     pty.resize(clamp(parsed.data.cols, 10, 1000), clamp(parsed.data.rows, 5, 500)); // clamp, don't reject (TECH_SPEC §4.1)
   });
   ```
   Use `ipcMain.handle` for request/response; return `{ ok: true, data } | { ok: false, code }`, never throw across IPC.
4. **Preload** — only in the preload of the window that needs it:
   ```ts
   contextBridge.exposeInMainWorld('voiceup', {
     resize: (cols: number, rows: number) => ipcRenderer.send(Channels.termResize, { cols, rows }),
     onData: (cb: (s: string) => void) => { const l = (_e: unknown, s: string) => cb(s); ipcRenderer.on(Channels.termData, l); return () => ipcRenderer.off(Channels.termData, l); },
   });
   ```
   Never forward the `IpcRendererEvent` to the page. Return an unsubscribe function for listeners.
5. **Types for renderer** — extend `desktop/src/renderer/global.d.ts` (`window.voiceup`).
6. **Tests** — schema test with valid and invalid payloads; handler test with a fake event from a disallowed sender (must be ignored).

## Main → renderer
Send only to the specific window (`win.webContents.send`), never broadcast. High-frequency streams (terminal data, audio level) are batched or throttled (≤ 60/s, levels ≤ 20/s).

import { contextBridge, ipcRenderer } from 'electron'
import type { Channels as SharedChannels, RecorderApi } from '../shared/ipcChannels'

// A sandboxed preload must be a single file, so it can't share code with another preload: the
// bundler would split it into a chunk this can't load. These are checked against the shared list.
const Channels = {
  recorderPort: 'recorder:port',
  recorderStart: 'recorder:start',
  recorderStop: 'recorder:stop',
  recorderError: 'recorder:error'
} as const satisfies Partial<typeof SharedChannels>

// Recorder window preload. Security rule 7: named functions only, and the IPC event never reaches
// the page. Security rule 2: this preload serves the recorder window only.
const api: RecorderApi = {
  onStart: (listener) => {
    ipcRenderer.on(Channels.recorderStart, (_event, start: Parameters<typeof listener>[0]) => {
      listener(start)
    })
  },
  onStop: (listener) => {
    ipcRenderer.on(Channels.recorderStop, (_event, stop: Parameters<typeof listener>[0]) => {
      listener(stop)
    })
  },
  reportError: (recordingId, code) => {
    ipcRenderer.send(Channels.recorderError, { recordingId, code })
  }
}

contextBridge.exposeInMainWorld('voiceupRecorder', api)

// Preloads compile without the DOM types, so this states the one call it makes.
declare const window: {
  postMessage(message: string, targetOrigin: string, transfer: readonly unknown[]): void
}

// contextBridge can't carry a MessagePort, so it goes to the page as a window message.
ipcRenderer.on(Channels.recorderPort, (event) => {
  window.postMessage('recorder-port', '*', event.ports)
})

import { contextBridge, ipcRenderer } from 'electron'
import type {
  Channels as SharedChannels,
  OverlayApi,
  OverlaySound,
  OverlayState
} from '../shared/ipcChannels'

// A sandboxed preload must be a single file, so it can't share code with another preload: the
// bundler would split it into a chunk this can't load. These are checked against the shared list.
const Channels = {
  overlayShow: 'overlay:show',
  overlaySound: 'overlay:sound'
} as const satisfies Partial<typeof SharedChannels>

// Overlay window preload. Security rule 7: named functions only, and the IPC event never reaches
// the page. Security rule 2: this preload serves the overlay window only. Display only: nothing
// here can send anything to main.
const api: OverlayApi = {
  onShow: (listener) => {
    ipcRenderer.on(Channels.overlayShow, (_event, state: OverlayState) => {
      listener(state)
    })
  },
  onSound: (listener) => {
    ipcRenderer.on(Channels.overlaySound, (_event, sound: OverlaySound) => {
      listener(sound)
    })
  }
}

contextBridge.exposeInMainWorld('voiceupOverlay', api)

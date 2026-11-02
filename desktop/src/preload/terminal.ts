import { contextBridge, ipcRenderer } from 'electron'
import { Channels, type SessionExit, type TerminalApi } from '../shared/ipcChannels'

// Security rule 7: named functions through contextBridge, never ipcRenderer itself, and the IPC
// event never reaches the page. Security rule 2: this preload serves the terminal window only.
const api: TerminalApi = {
  windowsBuild: Number(process.getSystemVersion().split('.')[2]),
  input: (data) => {
    ipcRenderer.send(Channels.termInput, data)
  },
  resize: (cols, rows) => {
    ipcRenderer.send(Channels.termResize, { cols, rows })
  },
  ack: (chars) => {
    ipcRenderer.send(Channels.termAck, chars)
  },
  onData: (listener) => {
    const forward = (_event: unknown, data: string): void => {
      listener(data)
    }
    ipcRenderer.on(Channels.termData, forward)
    return () => {
      ipcRenderer.off(Channels.termData, forward)
    }
  },
  onSessionExit: (listener) => {
    const forward = (_event: unknown, exit: SessionExit): void => {
      listener(exit)
    }
    ipcRenderer.on(Channels.sessionExited, forward)
    return () => {
      ipcRenderer.off(Channels.sessionExited, forward)
    }
  },
  restartSession: () => {
    ipcRenderer.send(Channels.sessionRestart, {})
  }
}

contextBridge.exposeInMainWorld('voiceup', api)

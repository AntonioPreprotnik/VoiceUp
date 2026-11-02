import { contextBridge, ipcRenderer } from 'electron'
import {
  Channels,
  type SessionExit,
  type TerminalApi,
  type TerminalMenuAction
} from '../shared/ipcChannels'

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
  },
  copy: (text) => {
    ipcRenderer.send(Channels.clipboardWrite, text)
  },
  readClipboard: () => ipcRenderer.invoke(Channels.clipboardRead) as Promise<string>,
  openLink: (url) => {
    ipcRenderer.send(Channels.linkOpen, { url })
  },
  showContextMenu: (hasSelection) => {
    ipcRenderer.send(Channels.termContextMenu, { hasSelection })
  },
  onMenuAction: (listener) => {
    const forward = (_event: unknown, action: TerminalMenuAction): void => {
      listener(action)
    }
    ipcRenderer.on(Channels.termMenuAction, forward)
    return () => {
      ipcRenderer.off(Channels.termMenuAction, forward)
    }
  },
  fontSize: () => ipcRenderer.invoke(Channels.settingsFontSize) as Promise<number>,
  onFontSize: (listener) => {
    const forward = (_event: unknown, size: number): void => {
      listener(size)
    }
    ipcRenderer.on(Channels.termFontSize, forward)
    return () => {
      ipcRenderer.off(Channels.termFontSize, forward)
    }
  }
}

contextBridge.exposeInMainWorld('voiceup', api)

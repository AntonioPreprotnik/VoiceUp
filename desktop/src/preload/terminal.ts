import { contextBridge, ipcRenderer } from 'electron'
import type {
  Channels as SharedChannels,
  SessionExit,
  StatusView,
  TerminalApi,
  TerminalMenuAction
} from '../shared/ipcChannels'

// A sandboxed preload must be a single file, so it can't share code with another preload: the
// bundler would split it into a chunk this can't load. These are checked against the shared list.
const Channels = {
  termData: 'term:data',
  termInput: 'term:input',
  termResize: 'term:resize',
  termAck: 'term:ack',
  sessionExited: 'session:exited',
  sessionRestart: 'session:restart',
  stateChanged: 'state:changed',
  stateGet: 'state:get',
  stateReArm: 'state:rearm',
  queueCancel: 'queue:cancel',
  clipboardWrite: 'clipboard:write',
  clipboardRead: 'clipboard:read',
  linkOpen: 'link:open',
  termContextMenu: 'term:contextMenu',
  termMenuAction: 'term:menuAction',
  termFontSize: 'term:fontSize',
  settingsFontSize: 'settings:fontSize'
} as const satisfies Partial<typeof SharedChannels>

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
  claudeStatus: () => ipcRenderer.invoke(Channels.stateGet) as Promise<StatusView | null>,
  onClaudeStatus: (listener) => {
    const forward = (_event: unknown, view: StatusView): void => {
      listener(view)
    }
    ipcRenderer.on(Channels.stateChanged, forward)
    return () => {
      ipcRenderer.off(Channels.stateChanged, forward)
    }
  },
  reArm: () => {
    ipcRenderer.send(Channels.stateReArm, {})
  },
  cancelQueued: (id) => {
    ipcRenderer.send(Channels.queueCancel, { id })
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

// A fake of the parts of the electron module the main process uses, for Vitest. Use it with
// vi.mock('electron', () => import('<path to this file>')). `calls` records the order of effects.
import { EventEmitter } from 'node:events'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import fakeLog from './electronLog'

const pathRoot = mkdtempSync(join(tmpdir(), 'voiceup-fake-electron-'))
process.on('exit', () => {
  rmSync(pathRoot, { recursive: true, force: true })
})

export const calls: string[] = []

let nextWebContentsId = 1

class FakeWebContents extends EventEmitter {
  readonly id = nextWebContentsId++
  sent: [string, unknown][] = []

  send(channel: string, payload: unknown): void {
    this.sent.push([channel, payload])
  }
  windowOpenHandler: (() => { action: string }) | undefined

  setWindowOpenHandler(handler: () => { action: string }): void {
    this.windowOpenHandler = handler
  }
}

export class BrowserWindow extends EventEmitter {
  static readonly instances: BrowserWindow[] = []
  readonly webContents = new FakeWebContents()
  loadedUrl: string | undefined
  minimized = false
  restored = false
  shown = false
  focused = false
  visible = false
  destroyed = false

  constructor(readonly options: Record<string, unknown>) {
    super()
    calls.push('window')
    BrowserWindow.instances.push(this)
  }

  loadURL(url: string): Promise<void> {
    calls.push('load')
    this.loadedUrl = url
    return Promise.resolve()
  }

  isDestroyed(): boolean {
    return this.destroyed
  }

  isVisible(): boolean {
    return this.visible
  }

  isMinimized(): boolean {
    return this.minimized
  }

  restore(): void {
    this.restored = true
  }

  show(): void {
    this.shown = true
  }

  focus(): void {
    this.focused = true
  }
}

class FakeApp extends EventEmitter {
  isPackaged = true
  hasLock = true
  quitCount = 0
  exitCodes: number[] = []

  getAppPath(): string {
    return pathRoot
  }

  getVersion(): string {
    return '0.0.0-test'
  }

  getPath(name: string): string {
    calls.push(`getPath:${name}`)
    return name === 'logs' ? join(pathRoot, 'logs') : pathRoot
  }

  requestSingleInstanceLock(): boolean {
    calls.push('lock')
    return this.hasLock
  }

  whenReady(): Promise<void> {
    calls.push('whenReady')
    return Promise.resolve()
  }

  quit(): void {
    this.quitCount++
  }

  exit(code: number): void {
    this.exitCodes.push(code)
  }
}

export const app = new FakeApp()

type ProtocolHandler = (request: Request) => Response | Promise<Response>

export const protocol = {
  handler: undefined as ProtocolHandler | undefined,
  privileged: [] as unknown[],
  registerSchemesAsPrivileged(schemes: unknown[]): void {
    calls.push('registerScheme')
    this.privileged = schemes
  },
  handle(_scheme: string, handler: ProtocolHandler): void {
    calls.push('serveProtocol')
    this.handler = handler
  }
}

export const Menu = {
  installed: undefined as unknown,
  popups: [] as { template: unknown; options: unknown }[],
  /** The template itself, so tests can read it, with popup added for the right-click menu. */
  buildFromTemplate(template: unknown[]): unknown[] & { popup(options: unknown): void } {
    const record = (options: unknown): void => {
      Menu.popups.push({ template, options })
    }
    return Object.assign(template, { popup: record })
  },
  setApplicationMenu(menu: unknown): void {
    calls.push('menu')
    this.installed = menu
  }
}

export const shell = {
  opened: [] as string[],
  failure: '',
  external: [] as string[],
  openFails: false,
  openPath(path: string): Promise<string> {
    this.opened.push(path)
    return Promise.resolve(this.failure)
  },
  openExternal(url: string): Promise<void> {
    if (this.openFails) return Promise.reject(new Error('no handler'))
    this.external.push(url)
    return Promise.resolve()
  }
}

class FakeUtilityProcess extends EventEmitter {
  messages: { message: unknown; ports: unknown[] | undefined }[] = []
  killed = false
  /** Like the real one, it exits when killed. Turn off to test a worker that hangs. */
  exitsWhenKilled = true

  constructor(readonly modulePath: string) {
    super()
  }

  postMessage(message: unknown, ports?: unknown[]): void {
    this.messages.push({ message, ports })
  }

  kill(): boolean {
    this.killed = true
    if (this.exitsWhenKilled) {
      queueMicrotask(() => {
        this.emit('exit', 0)
      })
    }
    return true
  }
}

export const utilityProcess = {
  children: [] as FakeUtilityProcess[],
  fork(modulePath: string): FakeUtilityProcess {
    calls.push('speechWorker')
    const child = new FakeUtilityProcess(modulePath)
    this.children.push(child)
    return child
  }
}

export class MessageChannelMain {
  readonly port1 = { name: 'port1' }
  readonly port2 = { name: 'port2' }
}

export const globalShortcut = {
  registered: new Map<string, () => void>(),
  takenByAnotherApp: '',
  throwsOn: '',
  register(accelerator: string, callback: () => void): boolean {
    calls.push('hotkey')
    if (accelerator === this.throwsOn) throw new Error('bad accelerator')
    if (accelerator === this.takenByAnotherApp) return false
    this.registered.set(accelerator, callback)
    return true
  },
  unregisterAll(): void {
    this.registered.clear()
  },
  /** What the user pressing it would do. */
  press(accelerator: string): void {
    this.registered.get(accelerator)?.()
  }
}

type InvokeHandler = (event: unknown) => unknown

class FakeIpcMain extends EventEmitter {
  readonly handlers = new Map<string, InvokeHandler>()

  handle(channel: string, handler: InvokeHandler): void {
    this.handlers.set(channel, handler)
  }
}

export const ipcMain = new FakeIpcMain()

export const clipboard = {
  text: '',
  writeText(text: string): Promise<void> {
    this.text = text
    return Promise.resolve()
  },
  readText(): Promise<string> {
    return Promise.resolve(this.text)
  }
}

export const dialog = {
  /** Queued replies: a folder, or null for cancel. Anything unexpected counts as cancel. */
  answers: [] as (string | null)[],
  requests: [] as { window: unknown; options: Record<string, unknown> }[],
  messageBoxes: [] as Record<string, unknown>[],
  messageBoxFails: false,
  showMessageBox(_window: unknown, options: Record<string, unknown>): Promise<unknown> {
    this.messageBoxes.push(options)
    return this.messageBoxFails ? Promise.reject(new Error('no dialog')) : Promise.resolve({})
  },
  showOpenDialog(
    window: unknown,
    options: Record<string, unknown>
  ): Promise<{ canceled: boolean; filePaths: string[] }> {
    this.requests.push({ window, options })
    const answer = this.answers.shift() ?? null
    return Promise.resolve(
      answer === null ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [answer] }
    )
  }
}

export const net = {
  fetched: [] as string[],
  fetch(url: string): Promise<Response> {
    this.fetched.push(url)
    return Promise.resolve(new Response('file'))
  }
}

export const session = {
  defaultSession: {
    requestHandler: undefined as
      | ((webContents: unknown, permission: string, callback: (allow: boolean) => void) => void)
      | undefined,
    checkHandler: undefined as (() => boolean) | undefined,
    setPermissionRequestHandler(
      handler: (
        webContents: unknown,
        permission: string,
        callback: (allow: boolean) => void
      ) => void
    ): void {
      calls.push('permissions')
      this.requestHandler = handler
    },
    setPermissionCheckHandler(handler: () => boolean): void {
      this.checkHandler = handler
    }
  }
}

export function resetFakes(): void {
  fakeLog.reset()
  ipcMain.removeAllListeners()
  ipcMain.handlers.clear()
  utilityProcess.children = []
  clipboard.text = ''
  Menu.popups = []
  shell.external = []
  shell.openFails = false
  dialog.answers = []
  dialog.messageBoxes = []
  dialog.messageBoxFails = false
  globalShortcut.registered.clear()
  globalShortcut.takenByAnotherApp = ''
  globalShortcut.throwsOn = ''
  dialog.requests = []
  rmSync(join(pathRoot, 'settings.json'), { force: true })
  Menu.installed = undefined
  shell.opened = []
  shell.failure = ''
  calls.length = 0
  BrowserWindow.instances.length = 0
  app.removeAllListeners()
  app.isPackaged = true
  app.hasLock = true
  app.quitCount = 0
  app.exitCodes = []
  protocol.handler = undefined
  protocol.privileged = []
  net.fetched = []
  session.defaultSession.requestHandler = undefined
  session.defaultSession.checkHandler = undefined
}

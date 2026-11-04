import { cpSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  app,
  BrowserWindow,
  calls,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  net,
  protocol,
  resetFakes,
  session,
  utilityProcess
} from '../../test/fakes/electron'
import { resetFakePty, spawned } from '../../test/fakes/nodePty'
import fakeLog from '../../test/fakes/electronLog'
import { startApp } from './lifecycle'
import { ModelError, type ModelPhase } from './models/manager'

// The model manager has its own integration test against a real server.
const fakeModels = vi.hoisted(() => ({
  installed: new Set<string>(),
  installs: [] as {
    id: string
    progress: (phase: ModelPhase, fraction: number) => void
    finish: (error?: Error) => void
  }[]
}))

vi.mock('./models/manager', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./models/manager')>()),
  ModelManager: class {
    isInstalled(entry: { id: string }): boolean {
      return fakeModels.installed.has(entry.id)
    }
    paths(entry: { id: string }): unknown {
      return { type: 'moonshine', tokens: `${entry.id}/tokens.txt` }
    }
    diskUsageBytes(): number {
      return 0
    }
    install(
      entry: { id: string },
      progress: (phase: ModelPhase, fraction: number) => void
    ): Promise<void> {
      return new Promise((resolve, reject) => {
        fakeModels.installs.push({
          id: entry.id,
          progress,
          finish: (error) => {
            if (error !== undefined) {
              reject(error)
              return
            }
            fakeModels.installed.add(entry.id)
            resolve()
          }
        })
      })
    }
  }
}))

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))
vi.mock('node-pty', () => import('../../test/fakes/nodePty'))

function onlyWindow(): BrowserWindow {
  const window = BrowserWindow.instances.at(0)
  if (window === undefined) throw new Error('No window was created')
  return window
}

async function settle(): Promise<void> {
  await vi.waitFor(() => {
    expect(calls).toContain('hotkey')
  })
}

beforeEach(() => {
  resetFakes()
  resetFakePty()
  // Bad-file copies from earlier tests would otherwise pile up in the shared fake folder.
  const userData = app.getPath('userData')
  for (const file of readdirSync(userData)) {
    if (file.startsWith('settings.bad-')) rmSync(join(userData, file))
  }
  mkdirSync(join(userData, 'resources'), { recursive: true })
  cpSync(join(__dirname, '../../resources/models.json'), join(userData, 'resources/models.json'))
  fakeModels.installed.clear()
  fakeModels.installs.length = 0
  calls.length = 0
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('startup', () => {
  it('follows the TECH_SPEC §3 order', async () => {
    startApp({ argv: [] })
    await settle()
    expect(calls).toEqual([
      'lock',
      'getPath:logs',
      'getPath:userData',
      'registerScheme',
      'whenReady',
      'permissions',
      'serveProtocol',
      'window',
      'window',
      'window',
      'load',
      // Step 4: the hook files.
      'getPath:userData',
      'getPath:userData',
      'speechWorker',
      'load',
      'getPath:userData',
      'menu',
      'load',
      // The model download starting changes the menu.
      'menu',
      'hotkey'
    ])
  })

  it('registers app:// as standard and secure', () => {
    startApp({ argv: [] })
    expect(protocol.privileged).toEqual([
      { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
    ])
  })

  it('quits a second instance before doing anything else', () => {
    app.hasLock = false
    startApp({ argv: [] })
    expect(calls).toEqual(['lock'])
    expect(app.quitCount).toBe(1)
  })

  it('focuses the first window when a second instance starts', async () => {
    startApp({ argv: [] })
    await settle()
    const window = onlyWindow()
    window.minimized = true
    app.emit('second-instance')
    expect(window.restored).toBe(true)
    expect(window.shown).toBe(true)
    expect(window.focused).toBe(true)
  })

  it('ignores a second instance after the window has closed', async () => {
    startApp({ argv: [] })
    await settle()
    const window = onlyWindow()
    window.emit('closed')
    app.emit('second-instance')
    expect(window.focused).toBe(false)
  })

  it('quits when the terminal closes, though the hidden recorder is still open', async () => {
    startApp({ argv: [] })
    await settle()
    onlyWindow().emit('closed')
    expect(app.quitCount).toBe(1)
  })

  it('denies every permission (rule 6)', async () => {
    startApp({ argv: [] })
    await settle()
    const { requestHandler, checkHandler } = session.defaultSession
    const decisions: boolean[] = []
    requestHandler?.({ id: -1 }, 'media', (allow) => decisions.push(allow), {
      mediaTypes: ['audio']
    })
    expect(decisions).toEqual([false])
    expect(checkHandler?.(null, 'media')).toBe(false)
  })

  it('exits 1 when startup fails', async () => {
    vi.spyOn(BrowserWindow.prototype, 'loadURL').mockRejectedValue(new Error('no page'))
    startApp({ argv: [] })
    await vi.waitFor(() => {
      expect(app.exitCodes).toEqual([1])
    })
  })
})

describe('settings and logging at startup', () => {
  it('applies the saved log level', () => {
    writeFileSync(
      join(app.getPath('userData'), 'settings.json'),
      JSON.stringify({ version: 1, logLevel: 'debug' })
    )
    startApp({ argv: [] })
    expect(fakeLog.transports.file.level).toBe('debug')
  })

  it('starts on defaults when the settings file is corrupt', async () => {
    writeFileSync(join(app.getPath('userData'), 'settings.json'), '{ not json')
    startApp({ argv: [] })
    await settle()
    expect(fakeLog.transports.file.level).toBe('info')
    expect(onlyWindow().loadedUrl).toBe('app://voiceup/terminal/index.html')
  })
})

describe('the hotkey', () => {
  const HOTKEY = 'Control+Shift+Space'

  function sentToWorker(): unknown[] {
    return (utilityProcess.children.at(0)?.messages ?? []).map(({ message }) => message)
  }

  it('registers the default from the settings', async () => {
    startApp({ argv: [] })
    await settle()
    expect(globalShortcut.registered.has(HOTKEY)).toBe(true)
  })

  it('registers a combination set in the settings', async () => {
    writeFileSync(
      join(app.getPath('userData'), 'settings.json'),
      JSON.stringify({ version: 1, hotkey: 'Alt+V' })
    )
    startApp({ argv: [] })
    await settle()
    expect(globalShortcut.registered.has('Alt+V')).toBe(true)
  })

  it('starts a recording, then cancels it on the next press', async () => {
    startApp({ argv: [] })
    await settle()
    globalShortcut.press(HOTKEY)
    expect(sentToWorker().at(-1)).toMatchObject({ type: 'start' })
    globalShortcut.press(HOTKEY)
    expect(sentToWorker().at(-1)).toMatchObject({ type: 'cancel' })
  })

  it('cancels the same recording it started', async () => {
    startApp({ argv: [] })
    await settle()
    globalShortcut.press(HOTKEY)
    const started = sentToWorker().at(-1) as { recordingId: string }
    globalShortcut.press(HOTKEY)
    expect(sentToWorker().at(-1)).toMatchObject({ recordingId: started.recordingId })
  })

  it('starts fresh after the worker finishes the recording', async () => {
    startApp({ argv: [] })
    await settle()
    globalShortcut.press(HOTKEY)
    const { recordingId } = sentToWorker().at(-1) as { recordingId: string }
    utilityProcess.children.at(0)?.emit('message', {
      type: 'transcript',
      recordingId,
      text: 'hello',
      decodeMs: 1
    })
    globalShortcut.press(HOTKEY)
    expect(sentToWorker().at(-1)).toMatchObject({ type: 'start' })
  })

  it('tells the user when another app owns it, and the app keeps running', async () => {
    globalShortcut.takenByAnotherApp = HOTKEY
    startApp({ argv: [] })
    await settle()
    expect(dialog.messageBoxes[0]?.['message']).toBe('Hotkey taken, pick another')
    expect(app.exitCodes).toEqual([])
  })

  it('releases it on quit', async () => {
    startApp({ argv: [] })
    await settle()
    app.emit('before-quit', { preventDefault: () => undefined })
    await vi.waitFor(() => {
      expect(app.exitCodes).toEqual([0])
    })
    expect(globalShortcut.registered.size).toBe(0)
  })

  it('never logs anything transcribed', async () => {
    startApp({ argv: [] })
    await settle()
    globalShortcut.press(HOTKEY)
    const { recordingId } = sentToWorker().at(-1) as { recordingId: string }
    utilityProcess.children.at(0)?.emit('message', {
      type: 'transcript',
      recordingId,
      text: 'a private sentence',
      decodeMs: 1
    })
    expect(JSON.stringify(fakeLog.messages('info'))).not.toContain('private')
  })
})

describe('the recorder window', () => {
  function recorderWindow(): BrowserWindow {
    const window = BrowserWindow.instances.at(1)
    if (window === undefined) throw new Error('No recorder window')
    return window
  }

  function portsSent(): number {
    return recorderWindow().webContents.sent.filter(([channel]) => channel === 'recorder:port')
      .length
  }

  it('gets its audio port only after its page has loaded, or the port would be lost', async () => {
    startApp({ argv: [] })
    await settle()
    expect(portsSent()).toBe(0)
    recorderWindow().webContents.emit('did-finish-load')
    expect(portsSent()).toBe(1)
  })

  it('fills the Microphone menu from what it reports, and a choice is remembered', async () => {
    startApp({ argv: [] })
    await settle()
    const event = {
      sender: { id: recorderWindow().webContents.id },
      senderFrame: { url: 'app://voiceup/recorder/index.html' }
    }
    ipcMain.emit('recorder:devices', event, [{ deviceId: 'usb', label: 'USB Mic' }])
    interface Item {
      label?: string
      checked?: boolean
      click?: () => void
      submenu?: Item[]
    }
    const entries = (): Item[] =>
      (Menu.installed as Item[]).find((item) => item.label === 'Microphone')?.submenu ?? []
    expect(entries().map((item) => item.label)).toEqual(['System default', 'USB Mic'])
    entries()
      .find((item) => item.label === 'USB Mic')
      ?.click?.()
    expect(entries().find((item) => item.label === 'USB Mic')?.checked).toBe(true)

    globalShortcut.press('Control+Shift+Space')
    expect(recorderWindow().webContents.sent.at(-1)?.[1]).toMatchObject({ deviceId: 'usb' })
  })

  it('stays hidden', async () => {
    startApp({ argv: [] })
    await settle()
    recorderWindow().emit('ready-to-show')
    expect(recorderWindow().shown).toBe(false)
  })

  it('reports its problems to the log', async () => {
    startApp({ argv: [] })
    await settle()
    recorderWindow().webContents.emit('console-message', {
      level: 'warning',
      message: 'Could not start recording'
    })
    expect(JSON.stringify(fakeLog.messages('warn'))).toContain('Could not start recording')
  })
})

describe('the speech model', () => {
  const MOONSHINE = 'moonshine-base-en'

  async function installing(): Promise<NonNullable<(typeof fakeModels.installs)[number]>> {
    startApp({ argv: [] })
    await settle()
    const install = fakeModels.installs.at(0)
    if (install === undefined) throw new Error('Nothing is installing')
    return install
  }

  it('downloads Moonshine on first run, showing progress in the title and taskbar', async () => {
    const install = await installing()
    expect(install.id).toBe(MOONSHINE)
    install.progress('downloading', 0.5)
    expect(onlyWindow().title).toBe('VoiceUp - Downloading speech model 50%')
    expect(onlyWindow().progress).toBe(0.5)
  })

  it('gives the worker the model when it is ready, and clears the progress', async () => {
    const install = await installing()
    expect(utilityProcess.children.at(0)?.messages[0]?.message).toMatchObject({ modelId: null })
    install.finish()
    await vi.waitFor(() => {
      expect(utilityProcess.children).toHaveLength(2)
    })
    expect(utilityProcess.children.at(0)?.killed).toBe(true)
    expect(utilityProcess.children.at(1)?.messages[0]?.message).toMatchObject({
      modelId: MOONSHINE,
      modelPaths: { tokens: `${MOONSHINE}/tokens.txt` }
    })
    expect(onlyWindow().title).toBe('VoiceUp')
    expect(onlyWindow().progress).toBe(-1)
  })

  it('starts the worker with a model already on disk, and downloads nothing', async () => {
    fakeModels.installed.add(MOONSHINE)
    startApp({ argv: [] })
    await settle()
    expect(fakeModels.installs).toEqual([])
    expect(utilityProcess.children).toHaveLength(1)
    expect(utilityProcess.children.at(0)?.messages[0]?.message).toMatchObject({
      modelId: MOONSHINE
    })
  })

  it('reports a failure in the title, and the menu retries it', async () => {
    const install = await installing()
    install.finish(new ModelError('MODEL_DOWNLOAD_FAILED', 'offline'))
    await vi.waitFor(() => {
      expect(onlyWindow().title).toBe('VoiceUp - Speech model download failed')
    })
    interface Item {
      label?: string
      click?: () => void
      submenu?: Item[]
    }
    const retry = (Menu.installed as Item[])
      .find((item) => item.label === 'Speech model')
      ?.submenu?.find((item) => item.label === 'Retry download')
    retry?.click?.()
    expect(fakeModels.installs).toHaveLength(2)
  })
})

describe('the speech worker', () => {
  it('starts with the settings, and stops on quit', async () => {
    startApp({ argv: [] })
    await settle()
    expect(utilityProcess.children).toHaveLength(1)
    const child = utilityProcess.children.at(0)
    expect(child?.messages[0]?.message).toMatchObject({
      type: 'init',
      vad: { endSilenceSec: 1.2 }
    })
    app.emit('before-quit', { preventDefault: () => undefined })
    await vi.waitFor(() => {
      expect(app.exitCodes).toEqual([0])
    })
    expect(child?.killed).toBe(true)
  })
})

describe('the Claude session', () => {
  it('registers the terminal channels', async () => {
    startApp({ argv: [] })
    await settle()
    expect(ipcMain.listenerCount('term:input')).toBe(1)
    expect(ipcMain.listenerCount('term:resize')).toBe(1)
    expect(ipcMain.listenerCount('term:ack')).toBe(1)
  })

  it('does not start Claude on its own', async () => {
    startApp({ argv: [] })
    await settle()
    expect(spawned).toEqual([])
  })
})

describe('renderer source', () => {
  it('is app:// when packaged, even with a dev server URL set', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    startApp({ argv: [] })
    await settle()
    expect(onlyWindow().loadedUrl).toBe('app://voiceup/terminal/index.html')
  })

  it('is the dev server when unpackaged', async () => {
    vi.stubEnv('ELECTRON_RENDERER_URL', 'http://localhost:5173')
    app.isPackaged = false
    startApp({ argv: [] })
    await settle()
    expect(onlyWindow().loadedUrl).toBe('http://localhost:5173/terminal/index.html')
  })
})

describe('the app:// handler', () => {
  async function request(url: string, method = 'GET'): Promise<Response> {
    startApp({ argv: [] })
    await settle()
    if (protocol.handler === undefined) throw new Error('No protocol handler')
    return protocol.handler({ url, method } as Request)
  }

  it('serves files from the renderer folder', async () => {
    const response = await request('app://voiceup/terminal/index.html')
    expect(response.status).toBe(200)
    expect(net.fetched).toHaveLength(1)
    expect(net.fetched[0]).toMatch(/^file:\/\/.*\/renderer\/terminal\/index\.html$/)
  })

  it.each([
    ['traversal', 'app://voiceup/..%5c..%5csecret', 'GET'],
    ['a foreign host', 'app://evil/terminal/index.html', 'GET'],
    ['a non-GET method', 'app://voiceup/terminal/index.html', 'POST']
  ])('answers 404 to %s, without touching the disk', async (_label, url, method) => {
    const response = await request(url, method)
    expect(response.status).toBe(404)
    expect(net.fetched).toEqual([])
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })
})

describe('shutdown', () => {
  function quit(): { preventDefault: ReturnType<typeof vi.fn> } {
    const event = { preventDefault: vi.fn() }
    app.emit('before-quit', event)
    return event
  }

  it('quits the app when the last window closes', () => {
    startApp({ argv: [] })
    app.emit('window-all-closed')
    expect(app.quitCount).toBe(1)
  })

  it('holds the quit, runs the steps in order, then exits 0', async () => {
    const ran: string[] = []
    startApp({
      argv: [],
      shutdownSteps: {
        logs: () => {
          ran.push('logs')
        },
        pty: () => {
          ran.push('pty')
        }
      }
    })
    const event = quit()
    expect(event.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(app.exitCodes).toEqual([0])
    })
    expect(ran).toEqual(['pty', 'logs'])
  })

  it('runs the steps once when quit fires twice', async () => {
    const step = vi.fn()
    startApp({ argv: [], shutdownSteps: { pty: step } })
    quit()
    const second = quit()
    expect(second.preventDefault).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(app.exitCodes).toEqual([0])
    })
    expect(step).toHaveBeenCalledOnce()
  })

  it('logs a failed step and still exits 0', async () => {
    startApp({ argv: [], shutdownSteps: { pty: () => Promise.reject(new Error('stuck')) } })
    quit()
    await vi.waitFor(() => {
      expect(app.exitCodes).toEqual([0])
    })
    expect(fakeLog.messages('error')).toHaveLength(1)
  })

  it('force-exits after 5 s when a step hangs', async () => {
    vi.useFakeTimers()
    startApp({ argv: [], shutdownSteps: { pty: () => new Promise(() => undefined) } })
    quit()
    await vi.advanceTimersByTimeAsync(4999)
    expect(app.exitCodes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(app.exitCodes).toEqual([1])
  })
})

describe('--smoke-test', () => {
  it('skips the lock, so it can run beside an open copy', () => {
    app.hasLock = false
    startApp({ argv: ['--smoke-test=C:\\nowhere\\r.json'] })
    expect(calls).not.toContain('lock')
    expect(calls).not.toContain('getPath:userData')
    expect(app.quitCount).toBe(0)
  })
})

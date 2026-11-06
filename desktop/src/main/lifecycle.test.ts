import { cpSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
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

vi.mock('./pty/claudeVersion', () => ({
  readClaudeVersion: () => Promise.resolve('2.1.318')
}))
vi.mock('./pty/resolveClaude', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./pty/resolveClaude')>()),
  resolveClaude: () => Promise.resolve({ file: 'claude.exe', args: [] })
}))
// The real one looks at this PC's browsers. Here Chrome has the extension, so setup can finish.
vi.mock('./browser/chromeExtension', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./browser/chromeExtension')>()),
  findBrowsers: () => [{ browser: 'chrome', installed: true, extension: true }],
  openStore: () => true,
  openForTest: () => Promise.resolve('running')
}))
vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))
vi.mock('node-pty', () => import('../../test/fakes/nodePty'))

function onlyWindow(): BrowserWindow {
  const window = BrowserWindow.instances.at(0)
  if (window === undefined) throw new Error('No window was created')
  return window
}

/** Opens the settings window from File, and returns what its IPC calls send as their sender. */
function openSettingsWindow(): { window: BrowserWindow; event: unknown } {
  interface Item {
    label?: string
    click?: () => void
    submenu?: Item[]
  }
  ;(Menu.installed as Item[])
    .find((item) => item.label === 'File')
    ?.submenu?.find((item) => item.label === 'Settings...')
    ?.click?.()
  const window = BrowserWindow.instances.find(({ options }) =>
    String((options['webPreferences'] as { preload?: string }).preload).endsWith('settings.js')
  )
  if (window === undefined) throw new Error('No settings window')
  return {
    window,
    event: {
      sender: { id: window.webContents.id },
      senderFrame: { url: 'app://voiceup/settings/index.html' }
    }
  }
}

function invokeSettings(channel: string, event: unknown, payload: unknown = {}): unknown {
  return ipcMain.handlers.get(channel)?.(event, payload)
}

function wizard(): BrowserWindow | undefined {
  return BrowserWindow.instances.find(({ options }) =>
    String((options['webPreferences'] as { preload?: string }).preload).endsWith('wizard.js')
  )
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
  // A file from before the wizard, so these tests start as a set-up copy does.
  writeFileSync(join(userData, 'settings.json'), JSON.stringify({ version: 1 }))
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
    await vi.waitFor(() => {
      expect(wizard()?.loadedUrl).toBe('app://voiceup/wizard/index.html')
    })
    expect(fakeLog.transports.file.level).toBe('info')
  })
})

describe('the first-run wizard', () => {
  const STEP_COUNT = 6
  const userDataDir = (): string => app.getPath('userData')
  const settingsFile = (): string => join(userDataDir(), 'settings.json')
  const saved = (): { wizard: { done: boolean; completed: string[] } } =>
    JSON.parse(readFileSync(settingsFile(), 'utf8')) as never

  async function freshStart({ signedIn = false } = {}): Promise<BrowserWindow> {
    rmSync(settingsFile())
    if (signedIn) {
      // Past the steps that need a running Claude, which have their own tests here and end to end.
      writeFileSync(
        settingsFile(),
        JSON.stringify({
          version: 1,
          wizard: {
            done: false,
            completed: ['signIn', 'speechModel', 'claudeInChrome', 'micAndHotkey']
          }
        })
      )
    }
    startApp({ argv: [] })
    await vi.waitFor(() => {
      expect(wizard()?.loadedUrl).toBe('app://voiceup/wizard/index.html')
    })
    const window = wizard()
    if (window === undefined) throw new Error('No wizard window')
    // Choosing the folder through the real path: main allows it on any step.
    dialog.answers.push(userDataDir())
    ipcMain.handlers.get('wizard:chooseFolder')?.(
      {
        sender: { id: window.webContents.id },
        senderFrame: { url: 'app://voiceup/wizard/index.html' }
      },
      {}
    )
    await vi.waitFor(() => {
      expect(readFileSync(settingsFile(), 'utf8')).toContain('"projectDir": "')
    })
    // Its Claude Code step has to find Claude before Continue does anything.
    await vi.waitFor(() => {
      expect(window.webContents.sent.at(-1)?.[1]).toMatchObject({ canContinue: true })
    })
    return window
  }

  function press(window: BrowserWindow, times: number): void {
    const event = {
      sender: { id: window.webContents.id },
      senderFrame: { url: 'app://voiceup/wizard/index.html' }
    }
    for (let press = 0; press < times; press++) ipcMain.handlers.get('wizard:next')?.(event, {})
  }

  it('does not open for a settings file from before it existed', async () => {
    startApp({ argv: [] })
    await settle()
    expect(wizard()).toBeUndefined()
    expect(onlyWindow().loadedUrl).toBe('app://voiceup/terminal/index.html')
  })

  it('holds the terminal, the model download and the hotkey on a fresh start', async () => {
    await freshStart()
    expect(onlyWindow().loadedUrl).toBeUndefined()
    expect(fakeModels.installs).toEqual([])
    expect(calls).not.toContain('hotkey')
    expect(utilityProcess.children).toHaveLength(1)
  })

  it('opens the terminal when finished, and not again on the next start', async () => {
    const window = await freshStart({ signedIn: true })
    press(window, STEP_COUNT)
    await settle()
    expect(onlyWindow().loadedUrl).toBe('app://voiceup/terminal/index.html')
    expect(fakeModels.installs).toHaveLength(1)
    expect(saved().wizard.done).toBe(true)
    expect(app.quitCount).toBe(0)
  })

  it('keeps the finished state when a later change saves the settings', async () => {
    const window = await freshStart({ signedIn: true })
    press(window, STEP_COUNT)
    await settle()
    const { event } = openSettingsWindow()
    invokeSettings('settings:set', event, { previewMs: 500 })
    expect(saved().wizard.done).toBe(true)
  })

  it('quits when closed early, with the progress saved', async () => {
    const window = await freshStart()
    press(window, 2)
    window.close()
    expect(app.quitCount).toBe(1)
    expect(saved().wizard).toEqual({ done: false, completed: ['claudeCode', 'projectFolder'] })
  })

  it('turns the hotkey on for the microphone test, sends what it hears to the wizard, and registers it once', async () => {
    writeFileSync(
      settingsFile(),
      JSON.stringify({
        version: 1,
        claude: { projectDir: userDataDir() },
        wizard: {
          done: false,
          completed: ['claudeCode', 'projectFolder', 'signIn', 'speechModel', 'claudeInChrome']
        }
      })
    )
    // Esc is a global shortcut too, held during a recording, so only the hotkey itself counts.
    const register = vi.spyOn(globalShortcut, 'register')
    const hotkeyRegistrations = (): number =>
      register.mock.calls.filter(([accelerator]) => accelerator === 'Control+Shift+Space').length
    startApp({ argv: [] })
    await vi.waitFor(() => {
      expect(hotkeyRegistrations()).toBe(1)
    })
    const window = wizard()
    if (window === undefined) throw new Error('No wizard window')
    globalShortcut.press('Control+Shift+Space')
    const child = utilityProcess.children.at(0)
    const { recordingId } = child?.messages.at(-1)?.message as { recordingId: string }
    child?.emit('message', { type: 'speechEnd', recordingId, durationMs: 900 })
    child?.emit('message', { type: 'transcript', recordingId, text: 'hello Claude', decodeMs: 1 })
    expect(window.webContents.sent.at(-1)?.[1]).toMatchObject({ mic: { heard: 'hello Claude' } })
    expect(spawned).toEqual([])

    press(window, 2)
    await settle()
    expect(hotkeyRegistrations()).toBe(1)
    expect(dialog.messageBoxes).toEqual([])
  })

  it('keeps the app menu off when it resumes at the model step, whose download changes the menu', async () => {
    writeFileSync(
      settingsFile(),
      JSON.stringify({
        version: 1,
        wizard: { done: false, completed: ['claudeCode', 'projectFolder', 'signIn'] }
      })
    )
    startApp({ argv: [] })
    await vi.waitFor(() => {
      expect(fakeModels.installs).toHaveLength(1)
    })
    fakeModels.installs[0]?.progress('downloading', 0.5)
    expect(calls).not.toContain('menu')
  })

  it('starts Claude beside it at Sign in, with voice and the model download still waiting', async () => {
    const window = await freshStart()
    press(window, 2)
    await vi.waitFor(() => {
      expect(onlyWindow().loadedUrl).toBe('app://voiceup/terminal/index.html')
    })
    expect(onlyWindow().bounds).toMatchObject({ x: 0, y: 0, width: 1360 })
    expect(window.bounds).toMatchObject({ x: 1360, width: 560 })
    expect(calls).not.toContain('hotkey')
    expect(fakeModels.installs).toEqual([])
  })

  it('does not put the app menu back while open, then shows what it missed', async () => {
    await freshStart({ signedIn: true })
    const recorder = BrowserWindow.instances.at(1)
    const event = {
      sender: { id: recorder?.webContents.id },
      senderFrame: { url: 'app://voiceup/recorder/index.html' }
    }
    calls.length = 0
    ipcMain.emit('recorder:devices', event, [{ deviceId: 'usb', label: 'USB Mic' }])
    // Electron applies the app menu to every window, which would undo the wizard's removeMenu.
    expect(calls).not.toContain('menu')

    const window = wizard()
    if (window === undefined) throw new Error('No wizard window')
    press(window, STEP_COUNT)
    await settle()
    const settings = openSettingsWindow()
    expect(invokeSettings('settings:get', settings.event)).toMatchObject({
      data: { microphones: [{ deviceId: 'usb', label: 'USB Mic' }] }
    })
  })

  it('brings up the wizard, not the blank terminal, for a second launch', async () => {
    const window = await freshStart()
    app.emit('second-instance')
    expect(window.focused).toBe(true)
    expect(onlyWindow().focused).toBe(false)
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

  it('lists the microphones it reports in the settings, and a choice is used', async () => {
    startApp({ argv: [] })
    await settle()
    const event = {
      sender: { id: recorderWindow().webContents.id },
      senderFrame: { url: 'app://voiceup/recorder/index.html' }
    }
    ipcMain.emit('recorder:devices', event, [{ deviceId: 'usb', label: 'USB Mic' }])
    const settings = openSettingsWindow()
    expect(invokeSettings('settings:get', settings.event)).toMatchObject({
      data: { microphones: [{ deviceId: 'usb', label: 'USB Mic' }], values: { micDeviceId: null } }
    })
    expect(invokeSettings('settings:set', settings.event, { micDeviceId: 'usb' })).toMatchObject({
      ok: true,
      data: { values: { micDeviceId: 'usb' } }
    })

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

describe('the end-to-end test hook', () => {
  const exposed = (): unknown => (globalThis as { voiceupE2e?: unknown }).voiceupE2e

  afterEach(() => {
    delete (globalThis as { voiceupE2e?: unknown }).voiceupE2e
  })

  // It can type into Claude, so a packaged build must never have it, whatever the environment says.
  it('does not exist in a packaged build, even when asked for', async () => {
    vi.stubEnv('VOICEUP_E2E', '1')
    app.isPackaged = true
    startApp({ argv: [] })
    await settle()
    expect(exposed()).toBeUndefined()
  })

  it('exists only when asked for in a dev build', async () => {
    app.isPackaged = false
    startApp({ argv: [] })
    await settle()
    expect(exposed()).toBeUndefined()
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

  it('reports a failure in the title, and the settings screen retries it', async () => {
    const install = await installing()
    install.finish(new ModelError('MODEL_DOWNLOAD_FAILED', 'offline'))
    await vi.waitFor(() => {
      expect(onlyWindow().title).toBe('VoiceUp - Speech model download failed')
    })
    const { event } = openSettingsWindow()
    expect(invokeSettings('settings:get', event)).toMatchObject({
      data: { model: { phase: 'failed' } }
    })
    invokeSettings('settings:retryModel', event)
    expect(fakeModels.installs).toHaveLength(2)
  })

  it('downloads a model chosen in the settings', async () => {
    fakeModels.installed.add('moonshine-base-en')
    startApp({ argv: [] })
    await settle()
    const { event } = openSettingsWindow()
    invokeSettings('settings:set', event, { modelId: 'parakeet-tdt-0.6b-v2-int8' })
    expect(fakeModels.installs.map(({ id }) => id)).toEqual(['parakeet-tdt-0.6b-v2-int8'])
  })
})

describe('the settings screen', () => {
  async function opened(): Promise<unknown> {
    startApp({ argv: [] })
    await settle()
    return openSettingsWindow().event
  }

  it('opens once, and brings the same window up again', async () => {
    await opened()
    const before = BrowserWindow.instances.length
    openSettingsWindow()
    expect(BrowserWindow.instances).toHaveLength(before)
  })

  it('is not offered during setup', async () => {
    rmSync(join(app.getPath('userData'), 'settings.json'))
    startApp({ argv: [] })
    await vi.waitFor(() => {
      expect(wizard()?.loadedUrl).toBe('app://voiceup/wizard/index.html')
    })
    expect(Menu.installed).toBeUndefined()
  })

  it('saves a change and applies it at once', async () => {
    const event = await opened()
    invokeSettings('settings:set', event, { logLevel: 'debug' })
    expect(fakeLog.transports.file.level).toBe('debug')
    const file = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
    ) as {
      logLevel: string
    }
    expect(file.logLevel).toBe('debug')
  })

  it('refuses a value out of range, with a message, saving nothing', async () => {
    const event = await opened()
    expect(invokeSettings('settings:set', event, { previewMs: 99999 })).toMatchObject({
      ok: false,
      errors: { previewMs: 'Choose from 0 to 5000 ms.' },
      data: { values: { previewMs: 300 } }
    })
  })

  it('refuses a field the screen does not have, such as the project folder', async () => {
    const event = await opened()
    expect(invokeSettings('settings:set', event, { projectDir: 'C:\\evil' })).toMatchObject({
      ok: false,
      data: null
    })
  })

  it('ignores any other window', async () => {
    await opened()
    const terminal = {
      sender: { id: onlyWindow().webContents.id },
      senderFrame: { url: 'app://voiceup/terminal/index.html' }
    }
    expect(invokeSettings('settings:set', terminal, { logLevel: 'debug' })).toMatchObject({
      ok: false,
      data: null
    })
  })

  it('moves the hotkey: the new one works and the old one is free', async () => {
    const event = await opened()
    invokeSettings('settings:set', event, { hotkey: 'Alt+V' })
    expect(globalShortcut.registered.has('Alt+V')).toBe(true)
    expect(globalShortcut.registered.has('Control+Shift+Space')).toBe(false)
  })

  it('keeps the old hotkey when another app has the new one, and says so', async () => {
    const event = await opened()
    globalShortcut.takenByAnotherApp = 'Alt+V'
    expect(
      invokeSettings('settings:set', event, { hotkey: 'Alt+V', previewMs: 500 })
    ).toMatchObject({
      ok: false,
      errors: { hotkey: expect.stringContaining('old hotkey is still on') as unknown },
      data: { values: { hotkey: 'Control+Shift+Space', previewMs: 500 } }
    })
    expect(globalShortcut.registered.has('Control+Shift+Space')).toBe(true)
  })

  it('resets the screen to defaults, keeping the project folder', async () => {
    writeFileSync(
      join(app.getPath('userData'), 'settings.json'),
      JSON.stringify({
        version: 1,
        claude: { projectDir: 'C:\\work' },
        delivery: { previewMs: 900 }
      })
    )
    startApp({ argv: [] })
    await settle()
    const { event } = openSettingsWindow()
    invokeSettings('settings:reset', event)
    const file = JSON.parse(
      readFileSync(join(app.getPath('userData'), 'settings.json'), 'utf8')
    ) as {
      delivery: { previewMs: number }
      claude: { projectDir: string }
    }
    expect(file.delivery.previewMs).toBe(300)
    expect(file.claude.projectDir).toBe('C:\\work')
  })

  it('adds itself to the startup list only when packaged', async () => {
    const event = await opened()
    invokeSettings('settings:set', event, { startWithWindows: true })
    expect(app.loginItem).toEqual({ openAtLogin: true })
  })

  it('never touches the startup list when unpackaged', async () => {
    app.isPackaged = false
    const event = await opened()
    invokeSettings('settings:set', event, { startWithWindows: true })
    expect(app.loginItem).toBeUndefined()
  })

  it('restarts the speech worker for new silence settings', async () => {
    const event = await opened()
    invokeSettings('settings:set', event, { endSilenceSec: 2 })
    expect(utilityProcess.children.at(-1)?.messages[0]?.message).toMatchObject({
      vad: { endSilenceSec: 2 }
    })
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

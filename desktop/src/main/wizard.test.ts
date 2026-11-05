import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, resetFakes } from '../../test/fakes/electron'
import { defaultSettings } from '../core/settingsMigrate'
import type { ClaudeCommand } from '../core/claudeCommand'
import type { RunningInstall } from './pty/installClaude'
import { Channels, type WizardResult, type WizardView } from '../shared/ipcChannels'
import type { Settings } from '../shared/settings'
import { openWizard } from './wizard'
import { createWindow } from './windows/factory'

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))

const STEP_COUNT = 6
const save = vi.fn<(settings: Settings) => void>()
const onFinished = vi.fn()
const onAbandoned = vi.fn()
const findClaude = vi.fn<() => Promise<ClaudeCommand | null>>()
const readClaudeVersion = vi.fn<(command: ClaudeCommand) => Promise<string | null>>()
const stopInstaller = vi.fn()
const runInstaller = vi.fn<(onOutput: (text: string) => void) => RunningInstall>()
let settings: Settings
let wizardEvent: unknown
let window: BrowserWindow

function result(channel: string, event: unknown, payload?: unknown): WizardResult {
  const handler = ipcMain.handlers.get(channel)
  if (handler === undefined) throw new Error(`No handler for ${channel}`)
  return handler(event, payload) as WizardResult
}

function invoke(channel: string, event: unknown, payload: unknown = {}): WizardView | null {
  const answer = result(channel, event, payload)
  return answer.ok ? answer.data : null
}

function terminalEvent(): unknown {
  createWindow('terminal', { showWhenReady: false })
  const terminal = BrowserWindow.instances.at(-1)
  return {
    sender: { id: terminal?.webContents.id },
    senderFrame: { url: 'app://voiceup/terminal/index.html' }
  }
}

function open(): void {
  openWizard({
    settings,
    save,
    onFinished,
    onAbandoned,
    findClaude,
    readClaudeVersion,
    runInstaller
  })
  const created = BrowserWindow.instances.at(-1)
  if (created === undefined) throw new Error('No window was created')
  window = created
  wizardEvent = {
    sender: { id: window.webContents.id },
    senderFrame: { url: 'app://voiceup/wizard/index.html' }
  }
}

beforeEach(() => {
  resetFakes()
  vi.resetAllMocks()
  settings = defaultSettings()
  findClaude.mockResolvedValue({ file: 'claude.exe', args: [] })
  readClaudeVersion.mockResolvedValue('2.1.318')
  runInstaller.mockReturnValue({ done: Promise.resolve(), stop: stopInstaller })
})

async function openReady(): Promise<void> {
  open()
  await vi.waitFor(() => {
    expect(invoke(Channels.wizardGet, wizardEvent)?.canContinue).toBe(true)
  })
}

describe('the Claude Code step', () => {
  const missing = async (): Promise<void> => {
    findClaude.mockResolvedValue(null)
    open()
    await vi.waitFor(() => {
      expect(invoke(Channels.wizardGet, wizardEvent)?.claude.status).toBe('missing')
    })
  }

  it('refuses Continue while Claude is missing, whatever the page asks', async () => {
    await missing()
    expect(invoke(Channels.wizardNext, wizardEvent)?.index).toBe(0)
    expect(save).not.toHaveBeenCalled()
  })

  it('refuses Continue while still looking', () => {
    open()
    expect(invoke(Channels.wizardNext, wizardEvent)?.index).toBe(0)
  })

  it('refuses Continue for a version that is too old', async () => {
    readClaudeVersion.mockResolvedValue('2.0.0')
    open()
    await vi.waitFor(() => {
      expect(invoke(Channels.wizardGet, wizardEvent)?.claude.status).toBe('tooOld')
    })
    expect(invoke(Channels.wizardNext, wizardEvent)?.index).toBe(0)
  })

  it('never runs the installer until asked', async () => {
    await missing()
    expect(runInstaller).not.toHaveBeenCalled()
  })

  it('runs it when asked, sends its output to the page, and finds Claude afterwards', async () => {
    await missing()
    runInstaller.mockImplementation((onOutput) => {
      onOutput('installing\n')
      findClaude.mockResolvedValue({ file: 'claude.exe', args: [] })
      return { done: Promise.resolve(), stop: stopInstaller }
    })
    invoke(Channels.wizardClaudeInstall, wizardEvent)
    await vi.waitFor(() => {
      expect(invoke(Channels.wizardGet, wizardEvent)?.canContinue).toBe(true)
    })
    expect(window.webContents.sent).toContainEqual([Channels.wizardOutput, 'installing\n'])
    expect(runInstaller).toHaveBeenCalledOnce()
  })

  it('stops the installer when the window closes', async () => {
    await missing()
    runInstaller.mockReturnValue({ done: new Promise(() => undefined), stop: stopInstaller })
    invoke(Channels.wizardClaudeInstall, wizardEvent)
    await vi.waitFor(() => {
      expect(runInstaller).toHaveBeenCalledOnce()
    })
    window.close()
    expect(stopInstaller).toHaveBeenCalledOnce()
    expect(onAbandoned).toHaveBeenCalledOnce()
  })

  it('tells the page when the answer changes', async () => {
    await openReady()
    expect(window.webContents.sent.at(-1)?.[0]).toBe(Channels.wizardChanged)
  })
})

describe('openWizard', () => {
  it('has no app menu, which would act on a session that has not started', () => {
    open()
    expect(window.menuRemoved).toBe(true)
  })

  it('resumes where the settings say', () => {
    settings.wizard.completed = ['claudeCode']
    open()
    expect(invoke(Channels.wizardGet, wizardEvent)?.index).toBe(1)
  })

  it('saves after each step', async () => {
    await openReady()
    invoke(Channels.wizardNext, wizardEvent, {})
    expect(save).toHaveBeenCalledOnce()
    expect(settings.wizard).toEqual({ done: false, completed: ['claudeCode'] })
  })

  it('does not save when only going back', async () => {
    await openReady()
    invoke(Channels.wizardNext, wizardEvent, {})
    save.mockClear()
    expect(invoke(Channels.wizardBack, wizardEvent, {})?.index).toBe(0)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps going when a save fails', async () => {
    await openReady()
    save.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect(invoke(Channels.wizardNext, wizardEvent, {})?.index).toBe(1)
  })

  it('finishes from the last step: saved first, then the app goes on and the window closes', async () => {
    await openReady()
    const order: string[] = []
    save.mockImplementation(() => {
      order.push('save')
    })
    onFinished.mockImplementation(() => {
      order.push('finished')
    })
    window.once('closed', () => {
      order.push('closed')
    })
    for (let step = 0; step < STEP_COUNT; step++) invoke(Channels.wizardNext, wizardEvent, {})
    expect(settings.wizard.done).toBe(true)
    expect(order.slice(-3)).toEqual(['save', 'finished', 'closed'])
    expect(onFinished).toHaveBeenCalledOnce()
    expect(onAbandoned).not.toHaveBeenCalled()
  })

  it('finishes only once when Continue is pressed again', async () => {
    await openReady()
    for (let step = 0; step < STEP_COUNT + 2; step++) invoke(Channels.wizardNext, wizardEvent, {})
    expect(onFinished).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledTimes(STEP_COUNT)
  })

  it('reports the window closed before the end, keeping the progress', async () => {
    await openReady()
    invoke(Channels.wizardNext, wizardEvent, {})
    window.close()
    expect(onAbandoned).toHaveBeenCalledOnce()
    expect(onFinished).not.toHaveBeenCalled()
    expect(settings.wizard.completed).toEqual(['claudeCode'])
  })
})

describe.each([
  Channels.wizardGet,
  Channels.wizardNext,
  Channels.wizardBack,
  Channels.wizardClaudeCheck,
  Channels.wizardClaudeInstall
])('%s', (channel) => {
  it('refuses any other window, and changes nothing', () => {
    open()
    expect(result(channel, terminalEvent(), {})).toEqual({ ok: false, code: 'WIZARD_REFUSED' })
    expect(save).not.toHaveBeenCalled()
    expect(invoke(Channels.wizardGet, wizardEvent)?.index).toBe(0)
  })
})

describe.each([Channels.wizardGet, Channels.wizardNext, Channels.wizardBack])('%s', (channel) => {
  it.each([[undefined], [{ hotkey: 'Alt+V' }], ['x'], [1]])(
    'refuses a payload of the wrong shape: %j',
    (payload) => {
      open()
      expect(result(channel, wizardEvent, payload)).toEqual({ ok: false, code: 'WIZARD_REFUSED' })
      expect(save).not.toHaveBeenCalled()
    }
  )
})

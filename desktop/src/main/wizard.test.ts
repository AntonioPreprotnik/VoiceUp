import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, ipcMain, resetFakes } from '../../test/fakes/electron'
import { defaultSettings } from '../core/settingsMigrate'
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
  openWizard({ settings, save, onFinished, onAbandoned })
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
  open()
})

describe('openWizard', () => {
  it('has no app menu, which would act on a session that has not started', () => {
    expect(window.menuRemoved).toBe(true)
  })

  it('resumes where the settings say', () => {
    settings.wizard.completed = ['claudeCode']
    open()
    expect(invoke(Channels.wizardGet, wizardEvent)?.index).toBe(1)
  })

  it('saves after each step', () => {
    invoke(Channels.wizardNext, wizardEvent, {})
    expect(save).toHaveBeenCalledOnce()
    expect(settings.wizard).toEqual({ done: false, completed: ['claudeCode'] })
  })

  it('does not save when only going back', () => {
    invoke(Channels.wizardNext, wizardEvent, {})
    save.mockClear()
    expect(invoke(Channels.wizardBack, wizardEvent, {})?.index).toBe(0)
    expect(save).not.toHaveBeenCalled()
  })

  it('keeps going when a save fails', () => {
    save.mockImplementationOnce(() => {
      throw new Error('disk full')
    })
    expect(invoke(Channels.wizardNext, wizardEvent, {})?.index).toBe(1)
  })

  it('finishes from the last step: saved first, then the app goes on and the window closes', () => {
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

  it('finishes only once when Continue is pressed again', () => {
    for (let step = 0; step < STEP_COUNT + 2; step++) invoke(Channels.wizardNext, wizardEvent, {})
    expect(onFinished).toHaveBeenCalledOnce()
    expect(save).toHaveBeenCalledTimes(STEP_COUNT)
  })

  it('reports the window closed before the end, keeping the progress', () => {
    invoke(Channels.wizardNext, wizardEvent, {})
    window.close()
    expect(onAbandoned).toHaveBeenCalledOnce()
    expect(onFinished).not.toHaveBeenCalled()
    expect(settings.wizard.completed).toEqual(['claudeCode'])
  })
})

describe.each([Channels.wizardGet, Channels.wizardNext, Channels.wizardBack])('%s', (channel) => {
  it('refuses any other window, and changes nothing', () => {
    expect(result(channel, terminalEvent(), {})).toEqual({ ok: false, code: 'WIZARD_REFUSED' })
    expect(save).not.toHaveBeenCalled()
    expect(invoke(Channels.wizardGet, wizardEvent)?.index).toBe(0)
  })
})

describe.each([Channels.wizardGet, Channels.wizardNext, Channels.wizardBack])('%s', (channel) => {
  it.each([[undefined], [{ hotkey: 'Alt+V' }], ['x'], [1]])(
    'refuses a payload of the wrong shape: %j',
    (payload) => {
      expect(result(channel, wizardEvent, payload)).toEqual({ ok: false, code: 'WIZARD_REFUSED' })
      expect(save).not.toHaveBeenCalled()
    }
  )
})

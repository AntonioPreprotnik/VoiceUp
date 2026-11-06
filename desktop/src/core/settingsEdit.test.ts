import { describe, expect, it } from 'vitest'
import { Settings } from '../shared/settings'
import { defaultEditable, editable, fieldError, shownMicrophone, withChanges } from './settingsEdit'
import { defaultSettings } from './settingsMigrate'

const saved = (): Settings => ({
  ...defaultSettings(),
  claude: { projectDir: 'C:\\work', browserControl: true, showBrowser: 'brave' },
  wizard: { done: true, completed: ['claudeCode'] },
  ui: { ...defaultSettings().ui, fontSize: 20 }
})

describe('withChanges', () => {
  it('puts each field where the schema keeps it', () => {
    const next = withChanges(saved(), {
      hotkey: 'Alt+V',
      micDeviceId: 'usb',
      modelId: 'parakeet-tdt-0.6b-v2-int8',
      endSilenceSec: 2,
      maxRecordingSec: 30,
      previewMs: 500,
      queue: false,
      sounds: false,
      notifications: false,
      startWithWindows: true,
      logLevel: 'debug'
    })
    expect(Settings.safeParse(next).success).toBe(true)
    expect(editable(next)).toMatchObject({ hotkey: 'Alt+V', previewMs: 500, logLevel: 'debug' })
    expect(next.speech.modelId).toBe('parakeet-tdt-0.6b-v2-int8')
    expect(next.ui.startWithWindows).toBe(true)
  })

  it('leaves everything off the screen alone', () => {
    const next = withChanges(saved(), { previewMs: 500 })
    expect(next.claude).toEqual(saved().claude)
    expect(next.wizard).toEqual(saved().wizard)
    expect(next.ui.fontSize).toBe(20)
    expect(next.speech.minWords).toBe(saved().speech.minWords)
  })
})

describe('defaultEditable', () => {
  it('resets the screen and nothing else', () => {
    const next = withChanges(
      withChanges(saved(), { previewMs: 900, hotkey: 'Alt+V' }),
      defaultEditable()
    )
    expect(editable(next)).toEqual(editable(defaultSettings()))
    expect(next.claude.projectDir).toBe('C:\\work')
    expect(next.wizard.done).toBe(true)
    expect(next.ui.fontSize).toBe(20)
  })
})

describe('fieldError', () => {
  it('names the field and its range', () => {
    expect(fieldError(['delivery', 'previewMs'])).toEqual({
      field: 'previewMs',
      message: 'Choose from 0 to 5000 ms.'
    })
    expect(fieldError(['speech', 'endSilenceSec']).message).toContain('0.5 to 3 seconds')
  })

  it('has a plain message for a field with no range', () => {
    expect(fieldError(['logLevel'])).toEqual({
      field: 'logLevel',
      message: 'That value isn’t allowed.'
    })
  })
})

describe('shownMicrophone', () => {
  const plugged = [{ deviceId: 'usb' }]

  it('shows the saved one when it is plugged in', () => {
    expect(shownMicrophone('usb', plugged)).toBe('usb')
  })

  it('shows the system default when it is not', () => {
    expect(shownMicrophone('gone', plugged)).toBeNull()
    expect(shownMicrophone(null, plugged)).toBeNull()
  })
})

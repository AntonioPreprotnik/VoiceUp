import { describe, expect, it } from 'vitest'
import { CURRENT_SETTINGS_VERSION, defaultSettings, migrate } from './settingsMigrate'

describe('defaultSettings', () => {
  it('matches the TECH_SPEC §6.4 defaults', () => {
    expect(defaultSettings()).toEqual({
      version: 1,
      hotkey: 'Control+Shift+Space',
      micDeviceId: null,
      speech: {
        modelId: 'auto',
        endSilenceSec: 1.2,
        minSpeechSec: 0.25,
        maxRecordingSec: 60,
        noSpeechTimeoutSec: 8,
        minWords: 1
      },
      delivery: { previewMs: 700, alwaysConfirm: false, queue: true, maxQueue: 3 },
      claude: { projectDir: null, browserControl: false },
      ui: { fontSize: 14, sounds: true, notifications: true, startWithWindows: false },
      logLevel: 'info'
    })
  })
})

describe('migrate', () => {
  it('keeps valid values', () => {
    const settings = migrate({ version: 1, hotkey: 'Alt+V', ui: { fontSize: 20 } })
    expect(settings?.hotkey).toBe('Alt+V')
    expect(settings?.ui.fontSize).toBe(20)
  })

  it('fills missing fields and whole missing sections with defaults', () => {
    expect(migrate({ version: 1 })).toEqual(defaultSettings())
    expect(migrate({ version: 1, ui: { fontSize: 20 } })?.ui.sounds).toBe(true)
  })

  it('strips unknown keys at the top level and inside sections', () => {
    const settings = migrate({ version: 1, removedField: 1, speech: { oldOption: true } })
    expect(settings).toEqual(defaultSettings())
  })

  it('does not let __proto__ in a file through', () => {
    const settings = migrate(JSON.parse('{"version":1,"__proto__":{"polluted":true}}'))
    expect(settings).toEqual(defaultSettings())
    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined()
  })

  it.each([
    ['null', null],
    ['a string', 'settings'],
    ['a number', 1],
    ['an array', [{ version: 1 }]],
    ['a missing version', {}],
    ['a string version', { version: '1' }],
    ['a fractional version', { version: 0.5 }],
    ['an old version with no upgrade', { version: 0 }],
    ['a version from a newer app', { version: CURRENT_SETTINGS_VERSION + 1 }],
    ['a value out of range', { version: 1, ui: { fontSize: 1000 } }],
    ['a value of the wrong type', { version: 1, hotkey: 5 }],
    ['an unknown enum value', { version: 1, logLevel: 'trace' }]
  ])('rejects %s', (_label, raw) => {
    expect(migrate(raw)).toBeNull()
  })

  it('runs upgrades in order, up to the current version', () => {
    const ran: number[] = []
    const upgrades = {
      [-1]: (raw: Record<string, unknown>) => {
        ran.push(-1)
        return { ...raw, version: 0, hotkey: 'Alt+V' }
      },
      0: (raw: Record<string, unknown>) => {
        ran.push(0)
        return { ...raw, version: 1, ui: { fontSize: 20 } }
      }
    }
    const settings = migrate({ version: -1 }, upgrades)
    expect(ran).toEqual([-1, 0])
    expect(settings?.hotkey).toBe('Alt+V')
    expect(settings?.ui.fontSize).toBe(20)
  })

  it.each([
    ['goes back a version', (raw: Record<string, unknown>) => ({ ...raw, version: -1 })],
    ['keeps the same version', (raw: Record<string, unknown>) => raw],
    ['drops the version', () => ({})],
    [
      'throws',
      () => {
        throw new Error('bad upgrade')
      }
    ]
  ])('rejects, rather than hangs on, an upgrade that %s', (_label, upgrade) => {
    expect(
      migrate({ version: 0 }, { 0: upgrade, [-1]: (raw) => ({ ...raw, version: 0 }) })
    ).toBeNull()
  })
})

import { describe, expect, it } from 'vitest'
import {
  captureHotkey,
  clashesWithAltGr,
  hotkeyLabel,
  RANGES,
  type KeyPress
} from './settingsFields'
import { Settings } from './settings'

const press = (code: string, mods: Partial<KeyPress> = {}): KeyPress => ({
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('captureHotkey', () => {
  it('builds the accelerator in the usual order', () => {
    expect(captureHotkey(press('Space', { ctrlKey: true, shiftKey: true }))).toEqual({
      kind: 'hotkey',
      accelerator: 'Control+Shift+Space'
    })
    expect(captureHotkey(press('KeyV', { altKey: true, metaKey: true }))).toEqual({
      kind: 'hotkey',
      accelerator: 'Alt+Super+V'
    })
  })

  it.each([
    ['Digit5', '5'],
    ['F9', 'F9'],
    ['F24', 'F24'],
    ['ArrowUp', 'Up'],
    ['Backquote', '`']
  ])('names %s as %s', (code, key) => {
    expect(captureHotkey(press(code, { ctrlKey: true }))).toEqual({
      kind: 'hotkey',
      accelerator: `Control+${key}`
    })
  })

  it('keeps waiting while only modifiers are down', () => {
    expect(captureHotkey(press('ControlLeft', { ctrlKey: true }))).toEqual({ kind: 'waiting' })
    expect(captureHotkey(press('ShiftRight', { shiftKey: true }))).toEqual({ kind: 'waiting' })
  })

  it.each([
    ['a plain key', press('KeyA')],
    ['Shift alone', press('KeyA', { shiftKey: true })]
  ])('refuses %s, which would fire while typing', (_label, key) => {
    expect(captureHotkey(key).kind).toBe('invalid')
  })

  it('refuses a key it has no name for', () => {
    expect(captureHotkey(press('NumpadEnter', { ctrlKey: true })).kind).toBe('invalid')
  })
})

describe('clashesWithAltGr', () => {
  it('flags Ctrl+Alt only', () => {
    expect(clashesWithAltGr('Control+Alt+V')).toBe(true)
    expect(clashesWithAltGr('Control+Shift+Space')).toBe(false)
    expect(clashesWithAltGr('Alt+V')).toBe(false)
  })
})

describe('hotkeyLabel', () => {
  it('uses the names people say', () => {
    expect(hotkeyLabel('Control+Super+Space')).toBe('Ctrl+Win+Space')
  })
})

describe('RANGES', () => {
  const base = Settings.parse({ version: 1 })
  const accepts = (speech: object, delivery: object): boolean =>
    Settings.safeParse({
      ...base,
      speech: { ...base.speech, ...speech },
      delivery: { ...base.delivery, ...delivery }
    }).success

  it.each([
    ['endSilenceSec', 'speech'],
    ['maxRecordingSec', 'speech'],
    ['previewMs', 'delivery']
  ] as const)('matches the schema for %s', (field, section) => {
    const { min, max, step } = RANGES[field]
    const at = (value: number): boolean =>
      section === 'speech' ? accepts({ [field]: value }, {}) : accepts({}, { [field]: value })
    expect(at(min)).toBe(true)
    expect(at(max)).toBe(true)
    expect(at(min - step)).toBe(false)
    expect(at(max + step)).toBe(false)
  })
})

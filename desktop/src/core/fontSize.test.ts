import { describe, expect, it } from 'vitest'
import { defaultSettings } from './settingsMigrate'
import { adjustFontSize } from './fontSize'

describe('adjustFontSize', () => {
  it('steps by one', () => {
    expect(adjustFontSize(14, 'larger')).toBe(15)
    expect(adjustFontSize(14, 'smaller')).toBe(13)
  })

  it('stops at the limits', () => {
    expect(adjustFontSize(32, 'larger')).toBe(32)
    expect(adjustFontSize(8, 'smaller')).toBe(8)
  })

  it('resets to the settings default', () => {
    expect(adjustFontSize(30, 'reset')).toBe(defaultSettings().ui.fontSize)
  })
})

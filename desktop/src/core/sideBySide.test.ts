import { describe, expect, it } from 'vitest'
import { sideBySide } from './sideBySide'

describe('sideBySide', () => {
  it('fills a large work area, with no overlap', () => {
    const { terminal, wizard } = sideBySide({ x: 0, y: 0, width: 1920, height: 1040 })
    expect(terminal).toEqual({ x: 0, y: 0, width: 1360, height: 1040 })
    expect(wizard).toEqual({ x: 1360, y: 0, width: 560, height: 1040 })
  })

  it('stays on a second screen', () => {
    const { terminal, wizard } = sideBySide({ x: 1920, y: 40, width: 1280, height: 720 })
    expect(terminal.x).toBe(1920)
    expect(wizard.x + wizard.width).toBe(3200)
    expect(wizard.y).toBe(40)
  })

  it('overlaps rather than leaving a narrow screen', () => {
    const { terminal, wizard } = sideBySide({ x: 0, y: 0, width: 800, height: 600 })
    expect(terminal.width).toBe(480)
    expect(wizard.x + wizard.width).toBe(800)
  })

  it('never goes wider than a very narrow screen', () => {
    const { terminal, wizard } = sideBySide({ x: 0, y: 0, width: 400, height: 600 })
    expect(terminal.width).toBe(400)
    expect(wizard.width).toBe(400)
  })
})

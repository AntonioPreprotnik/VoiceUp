import { describe, expect, it } from 'vitest'
import { overlayBounds } from './overlayPosition'

const SIZE = { width: 300, height: 60 }

describe('overlayBounds', () => {
  it('centers it above a bottom taskbar', () => {
    expect(overlayBounds({ x: 0, y: 0, width: 1920, height: 1040 }, SIZE)).toEqual({
      x: 810,
      y: 964,
      width: 300,
      height: 60
    })
  })

  it('stays on a monitor that starts away from the origin', () => {
    const bounds = overlayBounds({ x: 1920, y: 100, width: 1280, height: 900 }, SIZE)
    expect(bounds.x).toBe(2410)
    expect(bounds.y).toBe(924)
  })

  it('accounts for a taskbar on the left, through the work area', () => {
    expect(overlayBounds({ x: 60, y: 0, width: 1860, height: 1080 }, SIZE).x).toBe(840)
  })

  it('returns whole pixels', () => {
    expect(overlayBounds({ x: 0, y: 0, width: 1367, height: 767 }, SIZE).x).toBe(534)
  })
})

import { describe, expect, it } from 'vitest'
import { ChromeStep, type BrowserFinding } from './chromeStep'

const chrome = (installed: boolean, extension = false): BrowserFinding => ({
  browser: 'chrome',
  installed,
  extension
})
const brave = (installed: boolean, extension = false): BrowserFinding => ({
  browser: 'brave',
  installed,
  extension
})

describe('ChromeStep', () => {
  it('says no browser before anything is found, and is not done', () => {
    const step = new ChromeStep()
    expect(step.status).toEqual({ status: 'noBrowser' })
    step.update([chrome(false), brave(false)])
    expect(step.status).toEqual({ status: 'noBrowser' })
    expect(step.isDone).toBe(false)
  })

  it('offers each browser found while the extension is missing', () => {
    const step = new ChromeStep()
    step.update([chrome(true), brave(true)])
    expect(step.status).toEqual({ status: 'needed', browsers: ['chrome', 'brave'] })
    step.update([chrome(false), brave(true)])
    expect(step.status).toEqual({ status: 'needed', browsers: ['brave'] })
    expect(step.isDone).toBe(false)
  })

  it('is done when a browser has the extension, and names it', () => {
    const step = new ChromeStep()
    step.update([chrome(true), brave(true, true)])
    expect(step.status).toEqual({ status: 'installed', browser: 'brave' })
    expect(step.isDone).toBe(true)
  })

  it('ignores an extension folder left behind by a browser that is gone', () => {
    const step = new ChromeStep()
    step.update([chrome(false, true)])
    expect(step.status).toEqual({ status: 'noBrowser' })
  })

  it('is done when the user confirms, even with no browser found', () => {
    const step = new ChromeStep()
    step.update([chrome(false), brave(false)])
    step.confirm()
    expect(step.status).toEqual({ status: 'installed', browser: null })
    expect(step.isDone).toBe(true)
  })

  it('reports whether a new check changed anything', () => {
    const step = new ChromeStep()
    expect(step.update([chrome(true)])).toBe(true)
    expect(step.update([chrome(true)])).toBe(false)
    expect(step.update([chrome(true, true)])).toBe(true)
  })

  it('opens the store only in a browser it found', () => {
    const step = new ChromeStep()
    step.update([chrome(true), brave(false)])
    expect(step.canOpen('chrome')).toBe(true)
    expect(step.canOpen('brave')).toBe(false)
  })
})

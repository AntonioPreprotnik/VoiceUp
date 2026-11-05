import { beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { log } from '../log'
import { showBrowser, showBrowserScript, type BrowserChoice } from './showBrowser'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

describe('showBrowserScript', () => {
  it.each<[BrowserChoice, string]>([
    ['brave', 'brave'],
    ['chrome', 'chrome'],
    ['edge', 'msedge']
  ])('looks for %s by its process name', (browser, processName) => {
    expect(showBrowserScript(browser)).toContain(`Get-Process -Name '${processName}'`)
  })
})

describe('showBrowser', () => {
  let info: MockInstance
  let warn: MockInstance

  beforeEach(() => {
    info = vi.spyOn(log, 'info')
    warn = vi.spyOn(log, 'warn')
  })

  it('logs success at info', async () => {
    await showBrowser('brave', () => Promise.resolve(0))
    expect(info).toHaveBeenCalledWith('Showed the browser (brave)')
  })

  it.each([
    [10, "Could not show the browser: brave isn't open"],
    [11, 'Could not show the browser: brave has no window']
  ])('treats exit %i as nothing to show', async (code, message) => {
    await showBrowser('brave', () => Promise.resolve(code))
    expect(info).toHaveBeenCalledWith(message)
  })

  it('warns when Windows blocks it', async () => {
    await showBrowser('brave', () => Promise.resolve(12))
    expect(warn).toHaveBeenCalledWith('Windows did not let the browser come to the front')
  })

  it('warns when PowerShell fails, and does not throw', async () => {
    await expect(showBrowser('brave', () => Promise.resolve(null))).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Could not show the browser: PowerShell ended with null')
  })

  it('warns when PowerShell can not start, and does not throw', async () => {
    const run = () => Promise.reject(new Error('spawn failed'))
    await expect(showBrowser('brave', run)).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledWith('Could not start PowerShell:', 'spawn failed')
  })
})

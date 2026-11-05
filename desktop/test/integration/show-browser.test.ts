import { describe, expect, it, vi } from 'vitest'
import { showBrowser, type BrowserChoice } from '../../src/main/browser/showBrowser'
import { log } from '../../src/main/log'

vi.mock('electron', () => import('../fakes/electron'))
vi.mock('electron-log/main', () => import('../fakes/electronLog'))

// Moves a real browser to the front, so it runs only when asked for (desktop/CLAUDE.md).
const browser = process.env['VOICEUP_TEST_SHOW_BROWSER'] as BrowserChoice | undefined
const RUNS = 5

describe.skipIf(browser === undefined)('showBrowser on a real browser', () => {
  it('brings it to the front', { timeout: 60000 }, async () => {
    const info = vi.spyOn(log, 'info')
    const times: number[] = []
    for (let run = 0; run < RUNS; run += 1) {
      const start = performance.now()
      await showBrowser(browser as BrowserChoice)
      times.push(Math.round(performance.now() - start))
    }
    process.stdout.write(`show-browser ms: ${times.join(', ')}\n`)
    expect(info).toHaveBeenCalledTimes(RUNS)
    expect(info).toHaveBeenLastCalledWith(`Showed the browser (${String(browser)})`)
  })
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UPDATE_CHECK_INTERVAL_MS, UPDATE_FIRST_CHECK_DELAY_MS } from '../core/updates'
import { FakeUpdater } from '../../test/fakes/updater'
import { AppUpdates } from './updater'

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))

let updater: FakeUpdater
let ready: string[]
let updates: AppUpdates

function download(version = '1.0.1'): void {
  updater.download(version)
}

beforeEach(() => {
  vi.useFakeTimers()
  updater = new FakeUpdater()
  ready = []
  updates = new AppUpdates({
    updater,
    onReady: (version) => {
      ready.push(version)
    }
  })
  updates.start()
})

afterEach(() => {
  updates.stop()
  vi.useRealTimers()
})

describe('starting', () => {
  it('downloads by itself and leaves installing to VoiceUp', () => {
    expect(updater.autoDownload).toBe(true)
    expect(updater.autoInstallOnAppQuit).toBe(false)
    expect(updater.disableWebInstaller).toBe(true)
  })

  it('checks 30 s after start, then every 6 hours', () => {
    expect(updater.checks).toBe(0)
    vi.advanceTimersByTime(UPDATE_FIRST_CHECK_DELAY_MS)
    expect(updater.checks).toBe(1)
    updater.emit('checking-for-update')
    updater.emit('update-not-available')
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS - UPDATE_FIRST_CHECK_DELAY_MS)
    expect(updater.checks).toBe(2)
  })

  it('never starts a second check while a download is running', () => {
    updater.emit('checking-for-update')
    updater.emit('update-available', { version: '1.0.1' })
    updates.check()
    expect(updater.checks).toBe(0)
  })

  it('stops checking on stop', () => {
    updates.stop()
    vi.advanceTimersByTime(UPDATE_CHECK_INTERVAL_MS * 2)
    expect(updater.checks).toBe(0)
  })
})

describe('a downloaded update', () => {
  it('is announced once per version', () => {
    download()
    download()
    expect(ready).toEqual(['1.0.1'])
    download('1.0.2')
    expect(ready).toEqual(['1.0.1', '1.0.2'])
  })

  it('installs silently on quit, without starting VoiceUp again', () => {
    download()
    updates.installOnExit('quit')
    expect(updater.installs).toEqual([[true, false]])
  })

  it('starts VoiceUp again after Restart to update', () => {
    download()
    updates.installOnExit('restart')
    expect(updater.installs).toEqual([[true, true]])
  })

  it('waits for the next quit when Windows is ending the session', () => {
    download()
    updates.installOnExit('sessionEnd')
    expect(updater.installs).toEqual([])
  })
})

describe('failures', () => {
  it('installs nothing on quit when nothing was downloaded', () => {
    updates.installOnExit('quit')
    expect(updater.installs).toEqual([])
  })

  it('logs a failed check without throwing, and the next check tries again', async () => {
    updater.checkFails = true
    updates.check()
    await vi.waitFor(() => {
      expect(updater.checks).toBe(1)
    })
    updater.emit('error', new Error('offline'))
    expect(updates.current).toEqual({ kind: 'failed' })
    updates.check()
    expect(updater.checks).toBe(2)
  })

  it('refuses an update whose version is not a version', () => {
    updater.emit('checking-for-update')
    updater.emit('update-available', { version: '1.0.1\nInjected line' })
    expect(updates.current).toEqual({ kind: 'failed' })
    updater.emit('update-downloaded', { version: '<b>9</b>' })
    expect(ready).toEqual([])
    updates.installOnExit('quit')
    expect(updater.installs).toEqual([])
  })
})

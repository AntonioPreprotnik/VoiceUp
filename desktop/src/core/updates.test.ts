import { describe, expect, it } from 'vitest'
import {
  installOnExit,
  isNewlyReady,
  nextUpdateStatus,
  shouldCheck,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  type UpdateStatus
} from './updates'

const idle: UpdateStatus = { kind: 'idle' }
const checking: UpdateStatus = { kind: 'checking' }
const downloading: UpdateStatus = { kind: 'downloading', version: '1.0.1' }
const ready: UpdateStatus = { kind: 'ready', version: '1.0.1' }
const failed: UpdateStatus = { kind: 'failed' }

describe('nextUpdateStatus', () => {
  it('goes idle → checking → downloading → ready', () => {
    let status = nextUpdateStatus(idle, { type: 'checking' })
    expect(status).toEqual(checking)
    status = nextUpdateStatus(status, { type: 'available', version: '1.0.1' })
    expect(status).toEqual(downloading)
    status = nextUpdateStatus(status, { type: 'downloaded', version: '1.0.1' })
    expect(status).toEqual(ready)
  })

  it('goes back to idle when there is nothing new', () => {
    expect(nextUpdateStatus(checking, { type: 'notAvailable' })).toEqual(idle)
  })

  it('fails a check or a download, and the next check starts over', () => {
    expect(nextUpdateStatus(checking, { type: 'error' })).toEqual(failed)
    expect(nextUpdateStatus(downloading, { type: 'error' })).toEqual(failed)
    expect(nextUpdateStatus(failed, { type: 'checking' })).toEqual(checking)
  })

  it('keeps a downloaded update through later checks that fail or find nothing', () => {
    expect(nextUpdateStatus(ready, { type: 'checking' })).toEqual(ready)
    expect(nextUpdateStatus(ready, { type: 'error' })).toEqual(ready)
    expect(nextUpdateStatus(ready, { type: 'notAvailable' })).toEqual(ready)
  })

  it('keeps the downloaded one while a newer one downloads, then moves to the newer', () => {
    const newer = nextUpdateStatus(ready, { type: 'available', version: '1.0.2' })
    expect(newer).toEqual(ready)
    expect(nextUpdateStatus(newer, { type: 'downloaded', version: '1.0.2' })).toEqual({
      kind: 'ready',
      version: '1.0.2'
    })
  })
})

describe('shouldCheck', () => {
  it('checks unless a check or download is already running', () => {
    expect(shouldCheck(idle)).toBe(true)
    expect(shouldCheck(failed)).toBe(true)
    expect(shouldCheck(ready)).toBe(true)
    expect(shouldCheck(checking)).toBe(false)
    expect(shouldCheck(downloading)).toBe(false)
  })
})

describe('isNewlyReady', () => {
  it('is true once per downloaded version', () => {
    expect(isNewlyReady(downloading, ready)).toBe(true)
    expect(isNewlyReady(ready, ready)).toBe(false)
    expect(isNewlyReady(ready, { kind: 'ready', version: '1.0.2' })).toBe(true)
    expect(isNewlyReady(checking, idle)).toBe(false)
  })
})

describe('installOnExit', () => {
  it('installs silently on quit, without starting VoiceUp again', () => {
    expect(installOnExit(ready, 'quit')).toEqual({ relaunch: false })
  })

  it('starts VoiceUp again after Restart to update', () => {
    expect(installOnExit(ready, 'restart')).toEqual({ relaunch: true })
  })

  it('never installs while Windows signs out or shuts down', () => {
    expect(installOnExit(ready, 'sessionEnd')).toBeNull()
  })

  it('installs nothing without a downloaded update', () => {
    for (const status of [idle, checking, downloading, failed]) {
      expect(installOnExit(status, 'quit')).toBeNull()
      expect(installOnExit(status, 'restart')).toBeNull()
    }
  })
})

describe('timing', () => {
  it('waits after start, then checks every 6 hours', () => {
    expect(UPDATE_FIRST_CHECK_DELAY_MS).toBe(30_000)
    expect(UPDATE_CHECK_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)
  })
})

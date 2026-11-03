import type { Session } from 'electron'
import { beforeEach, describe, expect, it } from 'vitest'
import { resetFakes, session as fakes } from '../../test/fakes/electron'
import { installPermissions } from './permissions'

const RECORDER = { id: 7 }
const TERMINAL = { id: 8 }

function request(webContents: unknown, permission: string, mediaTypes?: string[]): boolean[] {
  const answers: boolean[] = []
  fakes.defaultSession.requestHandler?.(
    webContents,
    permission,
    (allow) => answers.push(allow),
    mediaTypes === undefined ? {} : { mediaTypes }
  )
  return answers
}

function check(webContents: unknown, permission: string): boolean | undefined {
  return fakes.defaultSession.checkHandler?.(webContents, permission)
}

beforeEach(() => {
  resetFakes()
  installPermissions(fakes.defaultSession as unknown as Session, (id) => id === RECORDER.id)
})

describe('permission requests (rule 6)', () => {
  it('lets the recorder use the microphone', () => {
    expect(request(RECORDER, 'media', ['audio'])).toEqual([true])
  })

  it('denies the terminal the microphone', () => {
    expect(request(TERMINAL, 'media', ['audio'])).toEqual([false])
  })

  it.each([
    ['video', ['video']],
    ['audio and video', ['audio', 'video']],
    ['nothing named', []]
  ])('denies the recorder %s', (_label, mediaTypes) => {
    expect(request(RECORDER, 'media', mediaTypes)).toEqual([false])
  })

  it('denies the recorder a media request with no details', () => {
    expect(request(RECORDER, 'media')).toEqual([false])
  })

  it.each(['clipboard-read', 'geolocation', 'notifications', 'fullscreen', 'openExternal'])(
    'denies the recorder %s',
    (permission) => {
      expect(request(RECORDER, permission)).toEqual([false])
    }
  )
})

describe('permission checks (rule 6)', () => {
  it('lets the recorder pass the media check', () => {
    expect(check(RECORDER, 'media')).toBe(true)
  })

  it('fails the media check for the terminal, and with no webContents', () => {
    expect(check(TERMINAL, 'media')).toBe(false)
    expect(check(null, 'media')).toBe(false)
  })

  it.each(['clipboard-read', 'clipboard-sanitized-write', 'geolocation'])(
    'fails the %s check, even for the recorder',
    (permission) => {
      expect(check(RECORDER, permission)).toBe(false)
    }
  )
})

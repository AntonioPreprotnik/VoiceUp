import { describe, expect, it } from 'vitest'
import { parseSmokeTestPath } from './smokeTest'

describe('parseSmokeTestPath', () => {
  it('returns the path after the flag', () => {
    expect(parseSmokeTestPath(['VoiceUp.exe', '--smoke-test=C:\\a b\\r.json'])).toBe(
      'C:\\a b\\r.json'
    )
  })

  it('returns undefined when the flag is absent', () => {
    expect(parseSmokeTestPath(['VoiceUp.exe', '--other=1'])).toBeUndefined()
  })

  it('does not treat the bare flag as the flag with a value', () => {
    expect(parseSmokeTestPath(['VoiceUp.exe', '--smoke-test'])).toBeUndefined()
  })

  it('returns an empty path as empty, so the write fails instead of the app starting', () => {
    expect(parseSmokeTestPath(['VoiceUp.exe', '--smoke-test='])).toBe('')
  })
})

import { describe, expect, it } from 'vitest'
import { isKnownPtyKillRejection } from './knownRejections'

describe('isKnownPtyKillRejection', () => {
  it('recognizes the exact error measured in S0.6', () => {
    const error = new Error(
      'child_process.fork() is not supported when the runAsNode fuse is disabled; use utilityProcess.fork() instead'
    )
    expect(isKnownPtyKillRejection(error)).toBe(true)
  })

  it.each([new Error('something else'), 'child_process.fork() is not supported', null, undefined])(
    'does not excuse %s',
    (reason) => {
      expect(isKnownPtyKillRejection(reason)).toBe(false)
    }
  )
})

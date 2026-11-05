import { describe, expect, it } from 'vitest'
import { isTooOld, MIN_CLAUDE_VERSION, parseClaudeVersion } from './claudeVersion'

describe('parseClaudeVersion', () => {
  it.each([
    ['2.1.318 (Claude Code)\n', '2.1.318'],
    ['  10.20.30\r\n', '10.20.30'],
    ['2.1.318-beta.1 (Claude Code)', '2.1.318']
  ])('reads %j', (output, version) => {
    expect(parseClaudeVersion(output)).toBe(version)
  })

  it.each([[''], ['Claude Code'], ['version 2.1.318'], ['2.1']])('finds none in %j', (output) => {
    expect(parseClaudeVersion(output)).toBeNull()
  })
})

describe('isTooOld', () => {
  it('accepts the minimum itself', () => {
    expect(isTooOld(MIN_CLAUDE_VERSION)).toBe(false)
  })

  it.each([['2.1.317'], ['2.0.999'], ['1.999.999'], ['2.1.9']])('rejects %s', (version) => {
    expect(isTooOld(version)).toBe(true)
  })

  it.each([['2.1.319'], ['2.2.0'], ['3.0.0'], ['2.1.1000']])('accepts %s', (version) => {
    expect(isTooOld(version)).toBe(false)
  })

  it('does not block on a version it could not read', () => {
    expect(isTooOld(null)).toBe(false)
  })
})

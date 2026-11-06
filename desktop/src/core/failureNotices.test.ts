import { describe, expect, it } from 'vitest'
import type { HookEvent, HookMessage } from '../shared/hooks'
import { FailureNotices, turnFailureCode } from './failureNotices'

const hook = (event: HookEvent): HookMessage => ({ kind: 'hook', hook: event })
const disconnected = hook({
  hook_event_name: 'PostToolUse',
  tool_name: 'mcp__claude-in-chrome__navigate',
  browserDisconnected: true
})
const prompt = hook({ hook_event_name: 'UserPromptSubmit' })

describe('FailureNotices', () => {
  it('says the browser is unreachable once per command', () => {
    const notices = new FailureNotices()
    expect(notices.onHook(disconnected)).toBe('CHROME_NOT_DETECTED')
    expect(notices.onHook(disconnected)).toBeNull()
    notices.onHook(prompt)
    expect(notices.onHook(disconnected)).toBe('CHROME_NOT_DETECTED')
  })

  it('says nothing for a browser tool that worked, or any other tool', () => {
    const notices = new FailureNotices()
    expect(
      notices.onHook(
        hook({
          hook_event_name: 'PostToolUse',
          tool_name: 'mcp__claude-in-chrome__navigate',
          navigated: true
        })
      )
    ).toBeNull()
    expect(notices.onHook(hook({ hook_event_name: 'PostToolUse', tool_name: 'Bash' }))).toBeNull()
    expect(notices.onHook(hook({ hook_event_name: 'Stop' }))).toBeNull()
  })

  it('tells a failed sign-in from any other failed turn, such as being offline', () => {
    const notices = new FailureNotices()
    expect(
      notices.onHook(hook({ hook_event_name: 'StopFailure', error: 'authentication_failed' }))
    ).toBe('CLAUDE_NOT_LOGGED_IN')
    expect(notices.onHook(hook({ hook_event_name: 'StopFailure', error: 'server_error' }))).toBe(
      'CLAUDE_TURN_FAILED'
    )
    expect(notices.onHook(hook({ hook_event_name: 'StopFailure' }))).toBeNull()
  })

  it('starts afresh with a new session', () => {
    const notices = new FailureNotices()
    notices.onHook(hook({ hook_event_name: 'StopFailure' }))
    notices.onHook(hook({ hook_event_name: 'SessionStart', source: 'startup' }))
    expect(notices.onHook(hook({ hook_event_name: 'StopFailure' }))).toBe('CLAUDE_TURN_FAILED')
  })

  it('ignores a hook that did not parse', () => {
    expect(
      new FailureNotices().onHook({ kind: 'unexpected', name: 'Stop', reason: 'invalid JSON' })
    ).toBeNull()
  })
})

describe('turnFailureCode', () => {
  it.each([
    ['authentication_failed', 'CLAUDE_NOT_LOGGED_IN'],
    ['oauth_token_expired', 'CLAUDE_NOT_LOGGED_IN'],
    ['rate_limit', 'CLAUDE_TURN_FAILED'],
    [undefined, 'CLAUDE_TURN_FAILED']
  ])('%s gives %s', (error, code) => {
    expect(turnFailureCode(error)).toBe(code)
  })
})

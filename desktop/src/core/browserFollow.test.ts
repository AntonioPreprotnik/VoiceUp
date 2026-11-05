import { describe, expect, it } from 'vitest'
import type { HookEvent, HookMessage } from '../shared/hooks'
import { BROWSER_TOOL_PREFIX, BrowserFollow } from './browserFollow'
import type { ClaudeState } from './state/reducer'

const BROWSER_TOOL = `${BROWSER_TOOL_PREFIX}navigate`

function hook(event: HookEvent): HookMessage {
  return { kind: 'hook', hook: event }
}

const finished = (tool: string): HookMessage =>
  hook({ hook_event_name: 'PostToolUse', tool_name: tool })
const prompt = hook({ hook_event_name: 'UserPromptSubmit' })

describe('BrowserFollow', () => {
  it('shows the browser when the first browser action finishes', () => {
    expect(new BrowserFollow().onHook(finished(BROWSER_TOOL), 'busy')).toBe(true)
  })

  it('does not show it when a browser action only starts', () => {
    const started = hook({ hook_event_name: 'PreToolUse', tool_name: BROWSER_TOOL })
    expect(new BrowserFollow().onHook(started, 'busy')).toBe(false)
  })

  it('does not show it for a browser action that failed', () => {
    const failed = hook({ hook_event_name: 'PostToolUseFailure', tool_name: BROWSER_TOOL })
    expect(new BrowserFollow().onHook(failed, 'busy')).toBe(false)
  })

  it('ignores other tools, and a hook with no tool name', () => {
    const follow = new BrowserFollow()
    expect(follow.onHook(finished('Bash'), 'busy')).toBe(false)
    expect(follow.onHook(finished('mcp__other__navigate'), 'busy')).toBe(false)
    expect(follow.onHook(hook({ hook_event_name: 'PostToolUse' }), 'busy')).toBe(false)
  })

  it('shows it once for each command', () => {
    const follow = new BrowserFollow()
    expect(follow.onHook(finished(BROWSER_TOOL), 'busy')).toBe(true)
    expect(follow.onHook(finished(BROWSER_TOOL), 'busy')).toBe(false)
    expect(follow.onHook(prompt, 'busy')).toBe(false)
    expect(follow.onHook(finished(BROWSER_TOOL), 'busy')).toBe(true)
  })

  it('arms again for a new session', () => {
    const follow = new BrowserFollow()
    follow.onHook(finished(BROWSER_TOOL), 'busy')
    follow.onHook(hook({ hook_event_name: 'SessionStart', source: 'clear' }), 'idle')
    expect(follow.onHook(finished(BROWSER_TOOL), 'busy')).toBe(true)
  })

  it.each<ClaudeState>(['awaitingPermission', 'awaitingInput'])(
    'waits while Claude is asking something (%s), then tries on the next action',
    (state) => {
      const follow = new BrowserFollow()
      expect(follow.onHook(finished(BROWSER_TOOL), state)).toBe(false)
      expect(follow.onHook(finished(BROWSER_TOOL), 'busy')).toBe(true)
    }
  )

  it('ignores an unexpected hook', () => {
    const message: HookMessage = { kind: 'unexpected', name: 'x', reason: 'invalid JSON' }
    expect(new BrowserFollow().onHook(message, 'busy')).toBe(false)
  })
})

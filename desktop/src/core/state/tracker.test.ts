import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookEvent } from '../../shared/hooks'
import type { ClaudeState, StateEffect } from './reducer'
import { ClaudeStateTracker, LOCAL_UI_WAIT_MS } from './tracker'

let tracker: ClaudeStateTracker
let changes: [ClaudeState, ClaudeState][]
let effects: StateEffect[]

const hook = (body: HookEvent): void => {
  tracker.onHook({ kind: 'hook', hook: body })
}
const started = (source = 'startup'): void => {
  hook({ hook_event_name: 'SessionStart', source })
}
const prompt = (): void => {
  hook({ hook_event_name: 'UserPromptSubmit', prompt: 'x' })
}
const stop = (): void => {
  hook({ hook_event_name: 'Stop' })
}

beforeEach(() => {
  vi.useFakeTimers()
  changes = []
  effects = []
  tracker = new ClaudeStateTracker({
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onChange: (state, previous) => changes.push([state, previous]),
    onEffect: (effect) => effects.push(effect)
  })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('the state', () => {
  it('starts in starting, and follows hooks', () => {
    expect(tracker.state).toBe('starting')
    started()
    expect(tracker.state).toBe('idle')
    prompt()
    expect(tracker.state).toBe('busy')
  })

  it('reports changes only, with the previous state', () => {
    started()
    started()
    expect(changes).toEqual([['idle', 'starting']])
  })

  it('treats an unexpected message as unknown', () => {
    started()
    tracker.onHook({ kind: 'unexpected', name: 'New', reason: 'unknown event' })
    expect(tracker.state).toBe('unknown')
  })

  it('passes effects on', () => {
    started()
    prompt()
    hook({ hook_event_name: 'StopFailure', error: 'server_error' })
    expect(effects).toEqual([{ type: 'stopFailure', error: 'server_error' }])
  })

  it('handles restart, exit, re-arm and a delivery timeout', () => {
    started()
    tracker.deliveryTimeout()
    expect(tracker.state).toBe('unknown')
    tracker.reArm()
    expect(tracker.state).toBe('idle')
    tracker.ptyExit()
    expect(tracker.state).toBe('exited')
    tracker.sessionRestart()
    expect(tracker.state).toBe('starting')
  })
})

describe('keys', () => {
  it('sees Esc and Ctrl+C', () => {
    started()
    prompt()
    tracker.onInput('\x1b')
    expect(tracker.state).toBe('unknown')
    prompt()
    tracker.onInput('\x03')
    expect(tracker.state).toBe('unknown')
  })

  it.each([
    ['a letter', 'a'],
    ['a focus report', '\x1b[I'],
    ['an arrow key', '\x1b[A'],
    ['a paste containing Esc and Enter', '\x1b[200~a\x1b\rb\x1b[201~'],
    ['text ending in Enter', 'hello\r']
  ])('leaves the state alone for %s', (_label, data) => {
    started()
    tracker.onInput(data)
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS * 2)
    expect(tracker.state).toBe('idle')
  })
})

describe('an Enter that nothing answers', () => {
  it('moves idle to unknown after 1 s, as it may have opened a menu', () => {
    started()
    tracker.onInput('\r')
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS - 1)
    expect(tracker.state).toBe('idle')
    vi.advanceTimersByTime(1)
    expect(tracker.state).toBe('unknown')
  })

  it('moves a permission prompt to unknown: a denial fires no hook', () => {
    started()
    prompt()
    hook({ hook_event_name: 'PermissionRequest', tool_name: 'Write' })
    tracker.onInput('\r')
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS)
    expect(tracker.state).toBe('unknown')
  })

  it('is answered by a prompt, even a turn that is over by the deadline', () => {
    started()
    tracker.onInput('\r')
    prompt()
    stop()
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS)
    expect(tracker.state).toBe('idle')
  })

  it('is answered by SessionStart: /clear stays idle throughout', () => {
    started()
    tracker.onInput('\r')
    started('clear')
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS)
    expect(tracker.state).toBe('idle')
  })

  it('is answered at a prompt by the tool finishing', () => {
    started()
    prompt()
    hook({ hook_event_name: 'PermissionRequest', tool_name: 'Write' })
    tracker.onInput('\r')
    hook({ hook_event_name: 'PostToolUse', tool_name: 'Write' })
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS)
    expect(tracker.state).toBe('busy')
  })

  it('is not answered by a background agent working', () => {
    started()
    tracker.onInput('\r')
    hook({ hook_event_name: 'PostToolUse', agent_id: 'a1', tool_name: 'Read' })
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS)
    expect(tracker.state).toBe('unknown')
  })

  it.each<[string, ClaudeState, () => void]>([
    ['busy', 'busy', prompt],
    ['starting', 'starting', () => undefined]
  ])('is not watched while %s', (_label, expected, setUp) => {
    if (expected !== 'starting') started()
    setUp()
    tracker.onInput('\r')
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS)
    expect(tracker.state).toBe(expected)
  })

  it('restarts the wait with a second Enter', () => {
    started()
    tracker.onInput('\r')
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS - 1)
    tracker.onInput('\r')
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS - 1)
    expect(tracker.state).toBe('idle')
    vi.advanceTimersByTime(1)
    expect(tracker.state).toBe('unknown')
  })

  it.each<[string, () => void, ClaudeState]>([
    [
      'an exit',
      () => {
        tracker.ptyExit()
      },
      'exited'
    ],
    [
      'a restart',
      () => {
        tracker.sessionRestart()
      },
      'starting'
    ],
    [
      're-arm',
      () => {
        tracker.reArm()
      },
      'unknown'
    ]
  ])('is forgotten after %s', (_label, action, expected) => {
    started()
    tracker.onInput('\r')
    action()
    vi.advanceTimersByTime(LOCAL_UI_WAIT_MS)
    expect(tracker.state).toBe(expected)
  })
})

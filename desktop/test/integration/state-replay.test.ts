import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { REGISTERED_HOOKS } from '../../src/core/hookConfig'
import type { ClaudeState } from '../../src/core/state/reducer'
import { ClaudeStateTracker } from '../../src/core/state/tracker'
import { parseHook, type HookName } from '../../src/shared/hooks'

// Replays each real session recorded in S2.1 through the real tracker, at its recorded timing.
const SCENARIOS = join(__dirname, '../scenarios')

interface Step {
  t: number
  event?: string
  body?: unknown
  input?: string
  ptyExit?: number
}

function scenario(name: string): Step[] {
  const raw = readFileSync(join(SCENARIOS, `${name}.json`), 'utf8')
  return (JSON.parse(raw) as { events: Step[] }).events
}

const SUBMIT_DELAY_MS = 150 // the harness typed, then pressed Enter this long after

/** What the keystrokes of each recorded step were. */
function keysOf(input: string): { data: string; delay: number }[] {
  if (input === 'Esc') return [{ data: '\x1b', delay: 0 }]
  if (input === 'Ctrl+C twice') {
    return [
      { data: '\x03', delay: 0 },
      { data: '\x03', delay: 300 }
    ]
  }
  if (input.startsWith('Enter')) return [{ data: '\r', delay: 0 }]
  if (input === 'Down') return [{ data: '\x1b[B', delay: 0 }]
  if (input === 'taskkill') return []
  if (input === '<prompt>' || input.startsWith('/')) {
    return [
      { data: 'text', delay: 0 },
      { data: '\r', delay: SUBMIT_DELAY_MS }
    ]
  }
  return [{ data: 'text', delay: 0 }]
}

function replay(name: string): { states: ClaudeState[]; everyStep: [string, ClaudeState][] } {
  const seen: ClaudeState[] = []
  const tracker = new ClaudeStateTracker({
    schedule: (callback, ms) => {
      const timer = setTimeout(callback, ms)
      return () => {
        clearTimeout(timer)
      }
    },
    onChange: (state) => seen.push(state),
    onEffect: () => undefined
  })
  const everyStep: [string, ClaudeState][] = []
  let now = 0
  const advance = (to: number): void => {
    if (to > now) {
      vi.advanceTimersByTime(to - now)
      now = to
    }
  }
  const actions = scenario(name).flatMap((step) => {
    const label = step.event ?? step.input ?? 'ptyExit'
    if (step.input !== undefined) {
      return keysOf(step.input).map(({ data, delay }) => ({
        t: step.t + delay,
        label,
        run: () => {
          tracker.onInput(data)
        }
      }))
    }
    if (step.ptyExit !== undefined) {
      return [
        {
          t: step.t,
          label,
          run: () => {
            tracker.ptyExit()
          }
        }
      ]
    }
    // Claude never sends what isn't registered (§4.2).
    if (!REGISTERED_HOOKS.includes(step.event as HookName)) return []
    return [
      {
        t: step.t,
        label,
        run: () => {
          tracker.onHook(parseHook(step.event ?? '', JSON.stringify(step.body)))
        }
      }
    ]
  })
  // Stable, so an equal time keeps the recorded order.
  for (const action of actions.sort((a, b) => a.t - b.t)) {
    advance(action.t)
    action.run()
    everyStep.push([action.label, tracker.state])
  }
  return { states: seen, everyStep }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

// Each list is reviewed by hand against the screen captures in S2.1, not just recorded. Six end
// without exited, because the harness quit before that session's exit arrived.
const EXPECTED: Record<string, ClaudeState[]> = {
  plain: ['idle', 'busy', 'idle', 'exited'],
  'idle-wait': ['idle', 'busy', 'idle', 'exited'],
  'tool-auto': ['idle', 'busy', 'idle', 'exited'],
  'tool-failure': ['idle', 'busy', 'idle', 'exited'],
  'permission-approved': ['idle', 'busy', 'awaitingPermission', 'busy', 'idle', 'exited'],
  // A denial fires nothing, so these rest on the key: Esc at once, Enter on "No" after the wait.
  'permission-denied-esc': [
    'idle',
    'busy',
    'awaitingPermission',
    'unknown',
    'busy',
    'idle',
    'exited'
  ],
  'permission-denied-no': ['idle', 'busy', 'awaitingPermission', 'unknown', 'exited'],
  // idle_prompt never came, so voice waits for re-arm.
  'denied-then-idle': ['idle', 'busy', 'awaitingPermission', 'unknown'],
  'interrupt-esc': ['idle', 'busy', 'unknown', 'busy', 'idle', 'exited'],
  'interrupt-then-idle': ['idle', 'busy', 'unknown'],
  'crash-mid-turn': ['idle', 'busy', 'exited'],
  'api-failure': ['idle', 'busy', 'idle', 'exited'],
  clear: ['idle', 'busy', 'idle', 'busy', 'idle', 'exited'],
  // /compact fires no prompt or Stop, so its Enter raises the alarm, and the next turn clears it.
  compact: ['idle', 'busy', 'idle', 'unknown', 'busy', 'idle'],
  'resume-menu': ['idle', 'busy', 'idle', 'unknown', 'idle', 'busy', 'idle', 'exited'],
  exit: ['idle', 'unknown', 'exited'],
  elicitation: ['idle', 'busy', 'awaitingInput', 'busy', 'idle', 'exited'],
  // Stop comes right after the agent asks: still blocked until the session ends.
  'subagent-asked-foreground': ['idle', 'busy', 'awaitingPermission', 'unknown', 'exited'],
  'background-agent': ['idle', 'busy', 'idle', 'busy', 'idle'],
  'agent-permission-send': ['idle', 'busy', 'awaitingPermission', 'idle', 'busy', 'idle'],
  'model-menu': ['idle', 'unknown', 'busy', 'idle'],
  'double-esc': ['idle', 'busy', 'idle', 'unknown', 'exited'],
  'login-menu': ['idle', 'unknown', 'busy', 'idle', 'exited'],
  'trust-pending': ['exited'],
  'first-run': ['exited']
}

describe('the recorded sessions', () => {
  it('are all covered', () => {
    const files = readdirSync(SCENARIOS).map((file) => file.replace(/\.json$/, ''))
    expect(Object.keys(EXPECTED).sort()).toEqual(files.sort())
  })

  it.each(Object.entries(EXPECTED))('%s', (name, expected) => {
    expect(replay(name).states).toEqual(expected)
  })
})

describe('the safety hole found in S2.1', () => {
  // Real recording: the agent asks, the main turn stops 115 ms later, and voice text sent at that
  // point had its Enter approve the agent's write.
  it('blocks at every step until the prompt is answered', () => {
    const { everyStep } = replay('agent-permission-send')
    const asked = everyStep.findIndex(([label]) => label === 'PermissionRequest')
    const answered = everyStep.findIndex(
      ([label], index) => index > asked && label === 'PostToolUse'
    )
    expect(asked).toBeGreaterThan(-1)
    expect(answered).toBeGreaterThan(asked)
    const between = everyStep.slice(asked, answered)
    expect(between.map(([label]) => label)).toContain('Stop')
    for (const [, state] of between) expect(state).toBe('awaitingPermission')
    // The answer really does end it, so voice isn't stuck.
    expect(everyStep[answered]?.[1]).toBe('idle')
  })

  it('still blocks when the Stop came first by only 77 ms, in the other recording', () => {
    const { everyStep } = replay('subagent-asked-foreground')
    const stop = everyStep.find(([label]) => label === 'Stop')
    expect(stop?.[1]).toBe('awaitingPermission')
  })
})

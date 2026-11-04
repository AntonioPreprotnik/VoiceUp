import { describe, expect, it } from 'vitest'
import type { HookEvent } from '../../shared/hooks'
import {
  INITIAL_STATE,
  reduce,
  type ClaudeState,
  type PendingPermission,
  type StateContext,
  type StateEvent
} from './reducer'

const ALL_STATES: readonly ClaudeState[] = [
  'starting',
  'idle',
  'busy',
  'awaitingPermission',
  'awaitingInput',
  'exited',
  'unknown'
]
const LIVE_STATES = ALL_STATES.filter((state) => state !== 'exited')

const hook = (body: HookEvent): StateEvent => ({ type: 'hook', hook: body })
const AGENT = 'a1'
const start = (source: string): StateEvent => hook({ hook_event_name: 'SessionStart', source })
const PROMPT = hook({ hook_event_name: 'UserPromptSubmit', prompt: 'x' })
const STOP = hook({ hook_event_name: 'Stop' })
const FAILURE = hook({ hook_event_name: 'StopFailure', error: 'server_error' })
const PRE = hook({ hook_event_name: 'PreToolUse' })
const POST = hook({ hook_event_name: 'PostToolUse' })
const POST_FAILED = hook({ hook_event_name: 'PostToolUseFailure' })
const ASK = hook({ hook_event_name: 'PermissionRequest', tool_name: 'Write' })
const AGENT_ASK = hook({
  hook_event_name: 'PermissionRequest',
  agent_id: AGENT,
  tool_name: 'Write'
})
const AGENT_PRE = hook({ hook_event_name: 'PreToolUse', agent_id: AGENT, tool_name: 'Write' })
const AGENT_POST = hook({ hook_event_name: 'PostToolUse', agent_id: AGENT, tool_name: 'Write' })
const AGENT_FAILED = hook({
  hook_event_name: 'PostToolUseFailure',
  agent_id: AGENT,
  tool_name: 'Write'
})
const AGENT_OTHER_TOOL = hook({
  hook_event_name: 'PostToolUse',
  agent_id: AGENT,
  tool_name: 'Read'
})
const OTHER_AGENT_POST = hook({
  hook_event_name: 'PostToolUse',
  agent_id: 'b2',
  tool_name: 'Write'
})
const notify = (type: string): StateEvent =>
  hook({ hook_event_name: 'Notification', notification_type: type })
const ELICIT = hook({ hook_event_name: 'Elicitation' })
const ELICIT_DONE = hook({ hook_event_name: 'ElicitationResult' })
const ESC: StateEvent = { type: 'userKey', key: 'esc' }
const CTRL_C: StateEvent = { type: 'userKey', key: 'ctrlC' }
const KEY: StateEvent = { type: 'userKey', key: 'other' }
const LOCAL_UI: StateEvent = { type: 'localUiSuspected' }

const PENDING: readonly PendingPermission[] = [{ agentId: AGENT, toolName: 'Write' }]

function at(state: ClaudeState, overrides: Partial<StateContext> = {}): StateContext {
  return { state, turnActive: false, pending: [], ...overrides }
}

function after(from: StateContext, ...events: StateEvent[]): StateContext {
  return events.reduce((context, event) => reduce(context, event).context, from)
}

function stateAfter(state: ClaudeState, event: StateEvent): ClaudeState {
  return after(at(state), event).state
}

describe('the state table', () => {
  it.each<[string, ClaudeState, StateEvent, ClaudeState]>([
    ['start from starting', 'starting', start('startup'), 'idle'],
    ['resume', 'unknown', start('resume'), 'idle'],
    ['clear while busy', 'busy', start('clear'), 'idle'],
    ['an unknown source', 'idle', start('new_source'), 'unknown'],
    ['a prompt from idle', 'idle', PROMPT, 'busy'],
    ['a prompt from unknown', 'unknown', PROMPT, 'busy'],
    ['a prompt while busy', 'busy', PROMPT, 'busy'],
    ['a prompt after a denial with no hook', 'awaitingPermission', PROMPT, 'busy'],
    ['a prompt while starting', 'starting', PROMPT, 'unknown'],
    ['a prompt during a dialog', 'awaitingInput', PROMPT, 'unknown'],
    ['tool start while busy', 'busy', PRE, 'busy'],
    ['tool end while busy', 'busy', POST, 'busy'],
    ['tool failure while busy', 'busy', POST_FAILED, 'busy'],
    ['an agent tool while idle', 'idle', AGENT_PRE, 'idle'],
    ['an agent tool ending while idle', 'idle', AGENT_POST, 'idle'],
    ['an agent tool failing while idle', 'idle', AGENT_FAILED, 'idle'],
    ['an agent tool while unknown', 'unknown', AGENT_PRE, 'unknown'],
    ['an agent tool during a dialog', 'awaitingInput', AGENT_POST, 'awaitingInput'],
    ['a main tool while idle', 'idle', PRE, 'unknown'],
    ['a main tool while unknown', 'unknown', POST, 'unknown'],
    ['a main tool during a dialog', 'awaitingInput', POST, 'unknown'],
    ['a tool while starting', 'starting', PRE, 'unknown'],
    ['asked while busy', 'busy', ASK, 'awaitingPermission'],
    ['asked while idle', 'idle', AGENT_ASK, 'awaitingPermission'],
    ['asked while unknown', 'unknown', ASK, 'awaitingPermission'],
    ['asked again', 'awaitingPermission', ASK, 'awaitingPermission'],
    ['asked while starting', 'starting', ASK, 'unknown'],
    ['asked during a dialog', 'awaitingInput', ASK, 'unknown'],
    ['permission_prompt while idle', 'idle', notify('permission_prompt'), 'awaitingPermission'],
    ['permission_prompt while busy', 'busy', notify('permission_prompt'), 'awaitingPermission'],
    ['permission_prompt while starting', 'starting', notify('permission_prompt'), 'unknown'],
    ['approved, tool ended', 'awaitingPermission', POST, 'busy'],
    ['approved, tool failed', 'awaitingPermission', POST_FAILED, 'busy'],
    ['approved, next tool started', 'awaitingPermission', PRE, 'busy'],
    ['stop while busy', 'busy', STOP, 'idle'],
    ['stop at a main prompt', 'awaitingPermission', STOP, 'idle'],
    ['stop while idle', 'idle', STOP, 'idle'],
    ['stop while unknown', 'unknown', STOP, 'idle'],
    ['stop while starting', 'starting', STOP, 'unknown'],
    ['stop during a dialog', 'awaitingInput', STOP, 'unknown'],
    ['a failed stop while busy', 'busy', FAILURE, 'idle'],
    ['a failed stop while idle', 'idle', FAILURE, 'unknown'],
    ['a dialog while busy', 'busy', ELICIT, 'awaitingInput'],
    ['a dialog while idle', 'idle', notify('elicitation_dialog'), 'awaitingInput'],
    ['a url dialog', 'unknown', notify('elicitation_url_dialog'), 'awaitingInput'],
    ['a dialog answered', 'awaitingInput', ELICIT_DONE, 'busy'],
    ['a dialog answer out of the blue', 'idle', ELICIT_DONE, 'unknown'],
    ['idle_prompt while idle', 'idle', notify('idle_prompt'), 'idle'],
    ['idle_prompt while unknown', 'unknown', notify('idle_prompt'), 'idle'],
    ['idle_prompt while busy', 'busy', notify('idle_prompt'), 'unknown'],
    ['idle_prompt at a prompt', 'awaitingPermission', notify('idle_prompt'), 'unknown'],
    ['Esc while busy', 'busy', ESC, 'unknown'],
    ['Esc at a prompt', 'awaitingPermission', ESC, 'unknown'],
    ['Esc in a dialog', 'awaitingInput', ESC, 'unknown'],
    ['Esc while idle', 'idle', ESC, 'unknown'],
    ['Esc while unknown', 'unknown', ESC, 'unknown'],
    ['Esc while starting', 'starting', ESC, 'starting'],
    ['Ctrl+C while busy', 'busy', CTRL_C, 'unknown'],
    ['Ctrl+C at a prompt', 'awaitingPermission', CTRL_C, 'unknown'],
    ['Ctrl+C in a dialog', 'awaitingInput', CTRL_C, 'unknown'],
    ['Ctrl+C while idle', 'idle', CTRL_C, 'idle'],
    ['Enter unanswered while idle', 'idle', LOCAL_UI, 'unknown'],
    ['Enter unanswered at a prompt', 'awaitingPermission', LOCAL_UI, 'unknown'],
    ['re-arm', 'unknown', { type: 'reArm' }, 'idle'],
    ['re-arm from anywhere else', 'busy', { type: 'reArm' }, 'unknown'],
    [
      'a SessionEnd, which is never registered',
      'idle',
      hook({ hook_event_name: 'SessionEnd', reason: 'other' }),
      'unknown'
    ]
  ])('%s', (_label, from, event, expected) => {
    expect(stateAfter(from, event)).toBe(expected)
  })

  it.each(LIVE_STATES)('compaction and forks leave %s alone', (state) => {
    expect(stateAfter(state, start('compact'))).toBe(state)
    expect(stateAfter(state, start('fork'))).toBe(state)
  })

  it.each(LIVE_STATES)('other keys leave %s alone', (state) => {
    expect(stateAfter(state, KEY)).toBe(state)
  })

  it.each(LIVE_STATES)('an unexpected event moves %s to unknown', (state) => {
    expect(stateAfter(state, { type: 'unexpected' })).toBe('unknown')
    expect(stateAfter(state, { type: 'deliveryTimeout' })).toBe('unknown')
  })

  it.each(LIVE_STATES)('an unlisted notification type moves %s to unknown', (state) => {
    expect(stateAfter(state, notify('agent_needs_input'))).toBe('unknown')
    expect(stateAfter(state, notify('from_the_future'))).toBe('unknown')
  })

  it.each(LIVE_STATES)('a dialog from %s waits for input', (state) => {
    expect(stateAfter(state, ELICIT)).toBe('awaitingInput')
  })

  it.each([
    'auth_success',
    'agent_completed',
    'elicitation_complete',
    'elicitation_response',
    'quota_auto_resume_fired',
    'quota_auto_resume_stale',
    'quota_auto_resume_disabled',
    'plugin_notification'
  ])('%s changes nothing', (type) => {
    for (const state of LIVE_STATES) expect(stateAfter(state, notify(type))).toBe(state)
  })

  it.each(ALL_STATES)('a PTY exit ends %s', (state) => {
    expect(stateAfter(state, { type: 'ptyExit' })).toBe('exited')
  })

  it.each(ALL_STATES)('a restart starts over from %s', (state) => {
    expect(
      reduce(at(state, { pending: [...PENDING] }), { type: 'sessionRestart' }).context
    ).toEqual(INITIAL_STATE)
  })

  it.each<[string, StateEvent]>([
    ['a late Stop', STOP],
    ['a late SessionStart', start('startup')],
    ['a late prompt', PROMPT],
    ['re-arm', { type: 'reArm' }],
    ['an unexpected event', { type: 'unexpected' }],
    ['Esc', ESC],
    ['a timeout', { type: 'deliveryTimeout' }]
  ])('a dead session stays dead after %s', (_label, event) => {
    expect(stateAfter('exited', event)).toBe('exited')
  })

  it('starts in starting', () => {
    expect(INITIAL_STATE.state).toBe('starting')
  })

  it('reports a failed stop, with what went wrong', () => {
    expect(reduce(at('busy'), FAILURE).effects).toEqual([
      { type: 'stopFailure', error: 'server_error' }
    ])
    expect(reduce(at('idle'), FAILURE).effects).toHaveLength(1)
    expect(reduce(at('busy'), STOP).effects).toEqual([])
  })
})

describe('leaving unknown', () => {
  it('never happens by itself: only an event can do it', () => {
    expect(after(at('busy'), ESC).state).toBe('unknown')
    expect(after(at('busy'), ESC, KEY, start('compact')).state).toBe('unknown')
  })

  it('happens through a later turn', () => {
    expect(after(at('busy'), ESC, PROMPT, STOP).state).toBe('idle')
  })

  it('happens through re-arm', () => {
    expect(after(at('busy'), ESC, { type: 'reArm' }).state).toBe('idle')
  })
})

describe('turnActive', () => {
  it.each<[string, StateEvent[], boolean]>([
    ['a prompt', [PROMPT], true],
    ['a Stop', [PROMPT, STOP], false],
    ['a failed stop', [PROMPT, FAILURE], false],
    ['Esc', [PROMPT, ESC], false],
    ['a new session', [PROMPT, start('clear')], false]
  ])('after %s', (_label, events, expected) => {
    expect(after(at('idle'), ...events).turnActive).toBe(expected)
  })
})

// S2.1: a Stop right after a background agent's prompt made the state idle, and voice text sent
// then approved the agent's write. These must all keep blocking.
describe('a background agent prompt on screen', () => {
  const waiting = at('awaitingPermission', { pending: PENDING })

  it('is recorded, from a turn in progress or an idle prompt', () => {
    expect(after(at('busy', { turnActive: true }), AGENT_ASK).pending).toEqual(PENDING)
    expect(after(at('idle'), AGENT_ASK).pending).toEqual(PENDING)
  })

  it('does not record a main prompt, which a turn is blocked on', () => {
    expect(after(at('busy'), ASK).pending).toEqual([])
  })

  it.each<[string, StateEvent]>([
    ['the main turn stopping', STOP],
    ['a new turn, such as another agent finishing', PROMPT],
    ['the main turn using a tool', PRE],
    ['the main turn finishing a tool', POST],
    ['the same agent starting a tool', AGENT_PRE],
    ['the same agent finishing a different tool', AGENT_OTHER_TOOL],
    ['another agent finishing a tool', OTHER_AGENT_POST],
    ['the notification', notify('permission_prompt')],
    ['a harmless notification', notify('agent_completed')],
    ['compaction', start('compact')],
    ['a keystroke', KEY]
  ])('stays blocking after %s', (_label, event) => {
    const { state, pending } = after(waiting, event)
    expect(state).toBe('awaitingPermission')
    expect(pending).toEqual(PENDING)
  })

  it('stays blocking through the whole recorded order', () => {
    const steps = [PROMPT, PRE, POST, AGENT_PRE, AGENT_ASK, STOP, notify('permission_prompt'), KEY]
    let context = at('idle')
    for (const step of steps.slice(4)) {
      context = after(context, step)
      expect(context.state).toBe('awaitingPermission')
    }
  })

  it('ends when that tool finishes, at idle with no turn running', () => {
    const { state, pending } = after(waiting, AGENT_POST)
    expect(state).toBe('idle')
    expect(pending).toEqual([])
  })

  it('ends when that tool fails', () => {
    expect(after(waiting, AGENT_FAILED).state).toBe('idle')
  })

  it('ends at busy with a turn running', () => {
    expect(
      after(at('awaitingPermission', { pending: PENDING, turnActive: true }), AGENT_POST).state
    ).toBe('busy')
  })

  it('waits for every prompt when two agents ask', () => {
    const two = after(
      at('idle'),
      AGENT_ASK,
      hook({
        hook_event_name: 'PermissionRequest',
        agent_id: 'b2',
        tool_name: 'Write'
      })
    )
    const oneAnswered = after(two, AGENT_POST)
    expect(oneAnswered.state).toBe('awaitingPermission')
    expect(after(oneAnswered, STOP).state).toBe('awaitingPermission')
    expect(after(oneAnswered, OTHER_AGENT_POST).state).toBe('idle')
  })

  it('treats Esc as answering the oldest, and still blocks', () => {
    const two = after(
      at('idle'),
      AGENT_ASK,
      hook({
        hook_event_name: 'PermissionRequest',
        agent_id: 'b2',
        tool_name: 'Write'
      })
    )
    const denied = after(two, ESC)
    expect(denied.state).toBe('unknown')
    expect(denied.pending).toEqual([{ agentId: 'b2', toolName: 'Write' }])
  })

  it('does not reach idle from unknown while another prompt is open', () => {
    const two = after(
      at('idle'),
      AGENT_ASK,
      hook({
        hook_event_name: 'PermissionRequest',
        agent_id: 'b2',
        tool_name: 'Write'
      })
    )
    expect(after(two, ESC, STOP).state).toBe('awaitingPermission')
    expect(after(two, ESC, PROMPT).state).toBe('awaitingPermission')
    expect(after(two, ESC, notify('idle_prompt')).state).toBe('awaitingPermission')
  })

  it('does not get stuck: Esc with one prompt, then a later turn, reaches idle', () => {
    expect(after(waiting, ESC, PROMPT, STOP).state).toBe('idle')
  })

  it('does not get stuck: an unanswered Enter drops the prompt too', () => {
    const denied = after(waiting, LOCAL_UI)
    expect(denied.state).toBe('unknown')
    expect(denied.pending).toEqual([])
  })

  it('returns to the prompt after a dialog, not to busy', () => {
    expect(after(waiting, ELICIT, ELICIT_DONE).state).toBe('awaitingPermission')
  })

  it('is cleared by a new session and by re-arm, where the user confirms the prompt is ready', () => {
    expect(after(waiting, start('clear')).pending).toEqual([])
    expect(after(waiting, ESC, { type: 'reArm' }).pending).toEqual([])
    expect(after(waiting, { type: 'ptyExit' }).pending).toEqual([])
  })

  it('accepts a request or a tool with no tool name, and matches by agent', () => {
    const named = after(at('idle'), hook({ hook_event_name: 'PermissionRequest', agent_id: AGENT }))
    expect(after(named, hook({ hook_event_name: 'PostToolUse', agent_id: AGENT })).state).toBe(
      'idle'
    )
  })
})

describe('the invariant, over many random sequences', () => {
  const EVENTS: readonly StateEvent[] = [
    start('startup'),
    start('clear'),
    start('compact'),
    PROMPT,
    STOP,
    FAILURE,
    PRE,
    POST,
    POST_FAILED,
    ASK,
    AGENT_ASK,
    AGENT_PRE,
    AGENT_POST,
    AGENT_FAILED,
    AGENT_OTHER_TOOL,
    OTHER_AGENT_POST,
    hook({ hook_event_name: 'PermissionRequest', agent_id: 'b2', tool_name: 'Write' }),
    ELICIT,
    ELICIT_DONE,
    notify('permission_prompt'),
    notify('idle_prompt'),
    notify('elicitation_dialog'),
    notify('agent_completed'),
    notify('from_the_future'),
    ESC,
    CTRL_C,
    KEY,
    LOCAL_UI,
    { type: 'deliveryTimeout' },
    { type: 'unexpected' },
    { type: 'reArm' },
    { type: 'ptyExit' },
    { type: 'sessionRestart' }
  ]

  // A fixed-seed generator, so a failure repeats.
  function randomSequences(count: number, length: number): StateEvent[][] {
    let seed = 20261104
    const next = (limit: number): number => {
      seed = (seed * 1664525 + 1013904223) % 4294967296
      return seed % limit
    }
    return Array.from({ length: count }, () =>
      Array.from({ length }, () => EVENTS[next(EVENTS.length)] ?? KEY)
    )
  }

  it('never reaches idle or busy with an agent prompt pending', () => {
    for (const sequence of randomSequences(2000, 60)) {
      let context = INITIAL_STATE
      for (const event of sequence) {
        context = reduce(context, event).context
        if (context.pending.length > 0) {
          expect(['awaitingPermission', 'awaitingInput', 'unknown']).toContain(context.state)
        }
      }
    }
  })

  it('reaches idle from an open agent prompt only through its answer, a new session or re-arm', () => {
    for (const sequence of randomSequences(2000, 60)) {
      let context = INITIAL_STATE
      for (const event of sequence) {
        const next = reduce(context, event).context
        if (context.pending.length > 0 && next.state === 'idle') {
          const answered = next.pending.length < context.pending.length
          expect(answered).toBe(true)
          expect(next.pending).toEqual([])
        }
        context = next
      }
    }
  })

  it('always ends in a known state, with no event leaving a dead session except a restart', () => {
    for (const sequence of randomSequences(500, 60)) {
      let context = INITIAL_STATE
      for (const event of sequence) {
        const next = reduce(context, event).context
        expect(ALL_STATES).toContain(next.state)
        if (context.state === 'exited' && event.type !== 'sessionRestart') {
          expect(next.state).toBe('exited')
        }
        context = next
      }
    }
  })
})

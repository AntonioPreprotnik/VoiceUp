import type { HookEvent } from '../../shared/hooks'

// Claude's state, from hooks and keys alone (TECH_SPEC §4.3). Anything not listed moves to unknown,
// which blocks sending. Never guesses idle, and nothing here runs on a timer.

export type ClaudeState =
  'starting' | 'idle' | 'busy' | 'awaitingPermission' | 'awaitingInput' | 'exited' | 'unknown'

export interface PendingPermission {
  readonly agentId: string
  /** Same agent, other tool: a parallel auto-approved tool finishing doesn't answer the prompt. */
  readonly toolName: string | undefined
}

export interface StateContext {
  readonly state: ClaudeState
  /** From UserPromptSubmit until Stop, StopFailure or an Esc. */
  readonly turnActive: boolean
  /** Background agents' prompts on screen. **While any are here, never idle or busy.** */
  readonly pending: readonly PendingPermission[]
}

export type StateEvent =
  | { readonly type: 'hook'; readonly hook: HookEvent }
  | { readonly type: 'unexpected' }
  | { readonly type: 'userKey'; readonly key: 'esc' | 'ctrlC' | 'other' }
  | { readonly type: 'ptyExit' }
  | { readonly type: 'sessionRestart' }
  | { readonly type: 'localUiSuspected' }
  | { readonly type: 'deliveryTimeout' }
  | { readonly type: 'reArm' }

export type StateEffect = { readonly type: 'stopFailure'; readonly error: string | undefined }

export interface Reduced {
  readonly context: StateContext
  readonly effects: readonly StateEffect[]
}

export const INITIAL_STATE: StateContext = { state: 'starting', turnActive: false, pending: [] }

/** Harmless: they leave the state alone. Any other value, including future ones, means unknown. */
const HARMLESS_NOTIFICATIONS: ReadonlySet<string> = new Set([
  'auth_success',
  'agent_completed',
  'elicitation_complete',
  'elicitation_response',
  'quota_auto_resume_fired',
  'quota_auto_resume_stale',
  'quota_auto_resume_disabled',
  'plugin_notification'
])

function to(context: StateContext, state: ClaudeState): StateContext {
  return { ...context, state }
}

/** The one way to reach idle or busy from a hook, which is what keeps an open prompt blocking. */
function settle(context: StateContext, state: 'idle' | 'busy'): StateContext {
  return to(context, context.pending.length > 0 ? 'awaitingPermission' : state)
}

/** One prompt has been dealt with, and no hook says which: prompts show oldest first. */
function dropOldest(context: StateContext): StateContext {
  return context.state === 'awaitingPermission'
    ? { ...context, pending: context.pending.slice(1) }
    : context
}

function removeAnswered(
  pending: readonly PendingPermission[],
  agentId: string,
  toolName: string | undefined
): readonly PendingPermission[] {
  const at = pending.findIndex(
    (entry) =>
      entry.agentId === agentId &&
      (entry.toolName === undefined || toolName === undefined || entry.toolName === toolName)
  )
  return at === -1 ? pending : pending.filter((_entry, index) => index !== at)
}

function reduceTool(
  context: StateContext,
  hook: Extract<HookEvent, { hook_event_name: 'PreToolUse' | 'PostToolUse' | 'PostToolUseFailure' }>
): StateContext {
  const { state } = context
  const { agent_id: agentId, tool_name: toolName } = hook
  if (state === 'busy') return context
  if (state === 'awaitingPermission') {
    if (agentId === undefined) return settle(context, 'busy')
    // An agent starting a tool answers nothing.
    if (hook.hook_event_name === 'PreToolUse') return context
    const pending = removeAnswered(context.pending, agentId, toolName)
    // Some other agent working, with this prompt still open.
    if (pending.length === context.pending.length) return context
    const next = { ...context, pending }
    return settle(next, context.turnActive ? 'busy' : 'idle')
  }
  // A background agent works while the main prompt is ready, or while a dialog waits.
  if (
    agentId !== undefined &&
    (state === 'idle' || state === 'unknown' || state === 'awaitingInput')
  ) {
    return context
  }
  return to(context, 'unknown')
}

function reduceNotification(context: StateContext, type: string): StateContext {
  const { state } = context
  if (HARMLESS_NOTIFICATIONS.has(type)) return context
  if (type === 'elicitation_dialog' || type === 'elicitation_url_dialog') {
    return to(context, 'awaitingInput')
  }
  if (
    type === 'permission_prompt' &&
    (state === 'idle' || state === 'busy' || state === 'awaitingPermission' || state === 'unknown')
  ) {
    return to(context, 'awaitingPermission')
  }
  if (type === 'idle_prompt' && (state === 'idle' || state === 'unknown')) {
    return settle(context, 'idle')
  }
  return to(context, 'unknown')
}

function reduceStop(context: StateContext): StateContext {
  const { state } = context
  const ended = { ...context, turnActive: false }
  if (
    state === 'busy' ||
    state === 'awaitingPermission' ||
    state === 'idle' ||
    state === 'unknown'
  ) {
    return settle(ended, 'idle')
  }
  return to(ended, 'unknown')
}

function reduceHook(context: StateContext, hook: HookEvent): Reduced {
  const { state } = context
  const only = (next: StateContext): Reduced => ({ context: next, effects: [] })
  switch (hook.hook_event_name) {
    case 'SessionStart':
      // Auto-compaction can fire in the middle of a turn, so these say nothing about the state.
      if (hook.source === 'compact' || hook.source === 'fork') return only(context)
      if (hook.source === 'startup' || hook.source === 'resume' || hook.source === 'clear') {
        return only({ state: 'idle', turnActive: false, pending: [] })
      }
      return only(to(context, 'unknown'))
    case 'UserPromptSubmit': {
      const started = { ...context, turnActive: true }
      if (
        state === 'idle' ||
        state === 'unknown' ||
        state === 'busy' ||
        state === 'awaitingPermission'
      ) {
        return only(settle(started, 'busy'))
      }
      return only(to(started, 'unknown'))
    }
    case 'PreToolUse':
    case 'PostToolUse':
    case 'PostToolUseFailure':
      return only(reduceTool(context, hook))
    case 'PermissionRequest': {
      if (
        state !== 'idle' &&
        state !== 'busy' &&
        state !== 'awaitingPermission' &&
        state !== 'unknown'
      ) {
        return only(to(context, 'unknown'))
      }
      const { agent_id: agentId, tool_name: toolName } = hook
      return only({
        ...context,
        state: 'awaitingPermission',
        pending:
          agentId === undefined ? context.pending : [...context.pending, { agentId, toolName }]
      })
    }
    case 'Notification':
      return only(reduceNotification(context, hook.notification_type))
    case 'Elicitation':
      return only(to(context, 'awaitingInput'))
    case 'ElicitationResult':
      return only(state === 'awaitingInput' ? settle(context, 'busy') : to(context, 'unknown'))
    case 'Stop':
      return only(reduceStop(context))
    case 'StopFailure': {
      const ended = { ...context, turnActive: false }
      return {
        context: state === 'busy' ? settle(ended, 'idle') : to(ended, 'unknown'),
        effects: [{ type: 'stopFailure', error: hook.error }]
      }
    }
    case 'SessionEnd':
      // Not registered (§4.2), so this should never arrive.
      return only(to(context, 'unknown'))
  }
}

function reduceKey(context: StateContext, key: 'esc' | 'ctrlC' | 'other'): StateContext {
  if (key === 'other') return context
  const { state } = context
  if (state === 'busy' || state === 'awaitingPermission' || state === 'awaitingInput') {
    return { ...dropOldest(context), state: 'unknown', turnActive: false }
  }
  // Double-Esc opens a menu that no hook reports.
  if (state === 'idle' && key === 'esc') return to(context, 'unknown')
  return context
}

export function reduce(context: StateContext, event: StateEvent): Reduced {
  const only = (next: StateContext): Reduced => ({ context: next, effects: [] })
  if (event.type === 'sessionRestart') return only(INITIAL_STATE)
  if (event.type === 'ptyExit') return only({ state: 'exited', turnActive: false, pending: [] })
  // A dead session stays dead: a late hook must not offer "Re-arm voice" on it.
  if (context.state === 'exited') return only(context)
  switch (event.type) {
    case 'hook':
      return reduceHook(context, event.hook)
    case 'userKey':
      return only(reduceKey(context, event.key))
    case 'localUiSuspected':
      return only({ ...dropOldest(context), state: 'unknown' })
    case 'reArm':
      return only(
        context.state === 'unknown'
          ? { state: 'idle', turnActive: false, pending: [] }
          : to(context, 'unknown')
      )
    case 'unexpected':
    case 'deliveryTimeout':
      return only(to(context, 'unknown'))
  }
}

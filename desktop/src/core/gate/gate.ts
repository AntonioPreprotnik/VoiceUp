import type { ClaudeState } from '../state/reducer'

// Decides what happens to a transcript (TECH_SPEC §4.4). The only way voice text reaches Claude is
// through a `send` from here, and that needs Claude idle with an empty prompt.

export type BlockReason =
  'unsentText' | 'busy' | 'queueFull' | 'waitingForYou' | 'starting' | 'exited' | 'unknown'

export type GateDecision =
  | { readonly action: 'send' }
  | { readonly action: 'queue' }
  | { readonly action: 'block'; readonly reason: BlockReason }

export interface GateInput {
  readonly state: ClaudeState
  /** The user has typed something at Claude's prompt and not sent it. */
  readonly promptDirty: boolean
  /** Text written, UserPromptSubmit not seen yet. */
  readonly deliveryPending: boolean
  readonly queueLength: number
  readonly queueEnabled: boolean
  readonly maxQueue: number
}

/** What the overlay shows for a block: each says why, in words the user can act on. */
export const BLOCK_MESSAGES: Readonly<Record<BlockReason, string>> = {
  unsentText:
    'Your prompt may have unsent text. If it is empty or only shows a grey suggestion, press Ctrl+C once in the terminal. Otherwise send or clear it.',
  busy: 'Claude is busy',
  queueFull: 'The queue is full',
  waitingForYou: 'Claude is waiting for you. Answer it in the terminal.',
  starting: 'Claude is starting',
  exited: 'The Claude session has ended. Restart it in the terminal.',
  unknown: "Can't tell if Claude is ready. Check the terminal, then Re-arm voice."
}

function block(reason: BlockReason): GateDecision {
  return { action: 'block', reason }
}

/** Queued text waits for a clean prompt too, so a dirty prompt doesn't change this. */
function whileBusy({ queueEnabled, queueLength, maxQueue }: GateInput): GateDecision {
  if (!queueEnabled) return block('busy')
  return queueLength < maxQueue ? { action: 'queue' } : block('queueFull')
}

export function gate(input: GateInput): GateDecision {
  const { state, promptDirty, deliveryPending } = input
  switch (state) {
    case 'idle':
      // Two sends can never overlap: until Claude confirms the last one, it counts as busy.
      if (deliveryPending) return whileBusy(input)
      return promptDirty ? block('unsentText') : { action: 'send' }
    case 'busy':
      return whileBusy(input)
    case 'awaitingPermission':
    case 'awaitingInput':
      return block('waitingForYou')
    case 'starting':
    case 'exited':
    case 'unknown':
      return block(state)
  }
}

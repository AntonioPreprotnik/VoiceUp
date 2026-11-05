import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HookMessage } from '../shared/hooks'
import { SignInStep, TEST_PROMPT } from './signInStep'

const deliver = vi.fn<(text: string) => void>()
const discard = vi.fn()
const promptDirty = vi.fn<() => boolean>()
const onChange = vi.fn()
let timeout: (() => void) | undefined
const cancelTimer = vi.fn()
let step: SignInStep

function hook(hook_event_name: string, extra: object = {}): HookMessage {
  return { kind: 'hook', hook: { hook_event_name, ...extra } } as unknown as HookMessage
}

beforeEach(() => {
  vi.resetAllMocks()
  promptDirty.mockReturnValue(false)
  timeout = undefined
  step = new SignInStep({
    deliver,
    discard,
    promptDirty,
    onChange,
    schedule: (callback) => {
      timeout = callback
      return cancelTimer
    }
  })
})

function testing(): void {
  step.onClaudeState('idle')
  step.test()
}

describe('before the test', () => {
  it('waits while Claude is at a trust or login screen, which send no hooks', () => {
    expect(step.status).toEqual({ status: 'waiting' })
    step.test()
    expect(deliver).not.toHaveBeenCalled()
  })

  it.each(['busy', 'awaitingPermission', 'awaitingInput', 'unknown', 'exited'] as const)(
    'does not send while Claude is %s',
    (state) => {
      step.onClaudeState(state)
      step.test()
      expect(deliver).not.toHaveBeenCalled()
      expect(step.status).toEqual({ status: 'waiting' })
    }
  )

  it('is ready once Claude is idle, and tells the page', () => {
    step.onClaudeState('idle')
    expect(step.status).toEqual({ status: 'ready' })
    expect(onChange).toHaveBeenCalledOnce()
  })

  it('never sends anything on its own', () => {
    step.onClaudeState('idle')
    expect(deliver).not.toHaveBeenCalled()
  })

  it('does not count a Stop from a prompt the user typed', () => {
    step.onClaudeState('idle')
    step.onHook(hook('UserPromptSubmit'))
    step.onHook(hook('Stop'))
    expect(step.isDone).toBe(false)
  })
})

describe('the test', () => {
  it('sends the prompt once, however often it is pressed', () => {
    testing()
    step.test()
    expect(deliver).toHaveBeenCalledOnce()
    expect(deliver).toHaveBeenCalledWith(TEST_PROMPT)
    expect(step.status).toEqual({ status: 'testing' })
  })

  it('is done when the prompt gets a Stop', () => {
    testing()
    step.onHook(hook('UserPromptSubmit'))
    step.onHook(hook('Stop'))
    expect(step.isDone).toBe(true)
    expect(step.status).toEqual({ status: 'done' })
    expect(cancelTimer).toHaveBeenCalledOnce()
  })

  it('ignores a Stop that arrives before the prompt was accepted', () => {
    testing()
    step.onHook(hook('Stop'))
    expect(step.status).toEqual({ status: 'testing' })
  })

  it('does not send over text typed at the prompt', () => {
    promptDirty.mockReturnValue(true)
    testing()
    expect(deliver).not.toHaveBeenCalled()
    expect(step.status).toMatchObject({ status: 'failed', canTest: true })
  })

  it('says Claude is not signed in on an authentication failure', () => {
    testing()
    step.onHook(hook('UserPromptSubmit'))
    step.onHook(hook('StopFailure', { error: 'authentication_failed' }))
    expect(step.status).toMatchObject({ status: 'failed', title: "Claude isn't signed in" })
    expect(step.isDone).toBe(false)
  })

  it('shows another failure by its code', () => {
    testing()
    step.onHook(hook('UserPromptSubmit'))
    step.onHook(hook('StopFailure', { error: 'rate_limit' }))
    expect(JSON.stringify(step.status)).toContain('rate_limit')
  })

  it('shows nothing from an error that is not a short code', () => {
    testing()
    step.onHook(hook('UserPromptSubmit'))
    step.onHook(hook('StopFailure', { error: 'Secret text from the prompt' }))
    expect(JSON.stringify(step.status)).not.toContain('Secret')
  })

  it('gives up after a while, dropping a test the gate may be holding', () => {
    testing()
    timeout?.()
    expect(discard).toHaveBeenCalledOnce()
    expect(step.status).toMatchObject({ status: 'failed', canTest: true })
  })

  it('fails if Claude closes, and can not test until it is back', () => {
    testing()
    step.onClaudeState('exited')
    expect(step.status).toMatchObject({ status: 'failed', canTest: false })
    step.onClaudeState('idle')
    expect(step.status).toMatchObject({ status: 'failed', canTest: true })
  })

  it('says so straight away if the prompt is lost and the state becomes unknown', () => {
    testing()
    step.onClaudeState('unknown')
    expect(step.status).toMatchObject({
      status: 'failed',
      title: 'Claude didn’t take the test',
      canTest: false
    })
    expect(JSON.stringify(step.status)).toContain('Re-arm voice')
    expect(cancelTimer).toHaveBeenCalledOnce()
    step.onClaudeState('idle')
    expect(step.status).toMatchObject({ status: 'failed', canTest: true })
  })

  it('can be tried again after a failure', () => {
    testing()
    timeout?.()
    step.test()
    step.onHook(hook('UserPromptSubmit'))
    step.onHook(hook('Stop'))
    expect(deliver).toHaveBeenCalledTimes(2)
    expect(step.isDone).toBe(true)
  })

  it('stays done whatever Claude does next', () => {
    testing()
    step.onHook(hook('UserPromptSubmit'))
    step.onHook(hook('Stop'))
    step.onClaudeState('exited')
    step.test()
    expect(step.status).toEqual({ status: 'done' })
    expect(deliver).toHaveBeenCalledOnce()
  })
})

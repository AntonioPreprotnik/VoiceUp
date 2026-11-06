import { beforeEach, describe, expect, it, vi } from 'vitest'
import { parseHook } from '../shared/hooks'
import { BROWSER_TEST_PROMPT, BrowserTest, CHROME_MIN_CLAUDE_VERSION } from './browserTest'
import { isTooOld, MIN_CLAUDE_VERSION } from './claudeVersion'

const startWithBrowser = vi.fn<() => 'fresh' | 'restart' | 'running'>()
const deliver = vi.fn<(text: string) => void>()
const discard = vi.fn()
const promptDirty = vi.fn<() => boolean>()
const onChange = vi.fn()
let timers: { callback: () => void; ms: number; cancelled: boolean }[]

function makeTest(): BrowserTest {
  return new BrowserTest({
    startWithBrowser,
    deliver,
    discard,
    promptDirty,
    onChange,
    schedule: (callback, ms) => {
      const timer = { callback, ms, cancelled: false }
      timers.push(timer)
      return () => {
        timer.cancelled = true
      }
    }
  })
}

const fire = (timer: { callback: () => void; cancelled: boolean } | undefined): void => {
  if (timer !== undefined && !timer.cancelled) timer.callback()
}

beforeEach(() => {
  vi.resetAllMocks()
  timers = []
  startWithBrowser.mockReturnValue('running')
  promptDirty.mockReturnValue(false)
})

/** Claude already runs with browser control, and is ready. */
function readyTest(): BrowserTest {
  const test = makeTest()
  test.onClaudeState('idle')
  return test
}

describe('BrowserTest', () => {
  it('does not count a navigate that did not open the page', () => {
    const test = readyTest()
    test.start()
    test.onHook(parseHook('UserPromptSubmit', '{"hook_event_name":"UserPromptSubmit"}'))
    test.onHook(
      parseHook(
        'PostToolUse',
        JSON.stringify({
          hook_event_name: 'PostToolUse',
          tool_name: 'mcp__claude-in-chrome__navigate',
          tool_response: [{ type: 'text', text: 'Browser extension is not connected.' }]
        })
      )
    )
    expect(test.status).toEqual({ status: 'testing' })
    test.onHook(parseHook('Stop', '{"hook_event_name":"Stop"}'))
    expect(test.status.status).toBe('failed')
  })

  it('ignores hooks from before its own prompt', () => {
    const test = readyTest()
    test.start()
    test.onHook(parseHook('Stop', '{"hook_event_name":"Stop"}'))
    expect(test.status).toEqual({ status: 'testing' })
  })

  it('first waits for Claude to start again with browser control, then sends', () => {
    startWithBrowser.mockReturnValue('restart')
    const test = readyTest()
    test.start()
    expect(test.status).toEqual({ status: 'starting' })
    // The session from before the restart is still idle: not that one.
    test.onClaudeState('idle')
    expect(deliver).not.toHaveBeenCalled()
    test.onClaudeState('exited')
    test.onClaudeState('starting')
    test.onClaudeState('idle')
    expect(deliver).toHaveBeenCalledExactlyOnceWith(BROWSER_TEST_PROMPT)
    expect(timers[0]?.cancelled).toBe(true)
  })

  it('after a fresh start, sends once Claude is first ready', () => {
    startWithBrowser.mockReturnValue('fresh')
    const test = makeTest()
    test.start()
    expect(test.status).toEqual({ status: 'starting' })
    test.onClaudeState('idle')
    expect(deliver).toHaveBeenCalledExactlyOnceWith(BROWSER_TEST_PROMPT)
  })

  it('fails when Claude does not start, or does not answer, in time', () => {
    startWithBrowser.mockReturnValue('restart')
    const test = readyTest()
    test.start()
    fire(timers[0])
    expect(test.status).toMatchObject({ status: 'failed', title: 'Claude didn’t start' })

    startWithBrowser.mockReturnValue('running')
    test.start()
    fire(timers.at(-1))
    expect(discard).toHaveBeenCalledOnce()
    expect(test.status).toMatchObject({
      status: 'failed',
      title: 'Claude couldn’t use your browser'
    })
  })

  it('refuses to type over text, or into a Claude that is not ready', () => {
    promptDirty.mockReturnValue(true)
    const test = readyTest()
    test.start()
    expect(test.status).toMatchObject({ title: 'There is text in the terminal' })
    const busy = makeTest()
    busy.onClaudeState('busy')
    busy.start()
    expect(busy.status).toMatchObject({ title: 'Claude isn’t ready' })
    expect(deliver).not.toHaveBeenCalled()
  })

  it('fails when Claude closes during the test, and can be run again', () => {
    const test = readyTest()
    test.start()
    test.onClaudeState('exited')
    expect(test.status).toMatchObject({ status: 'failed', title: 'Claude closed' })
    expect(discard).toHaveBeenCalledOnce()
    test.onClaudeState('idle')
    test.start()
    expect(deliver).toHaveBeenCalledTimes(2)
  })

  it('needs no newer Claude than VoiceUp already does', () => {
    // Every Claude that passes the S6.3 check is new enough for --chrome.
    expect(isTooOld(CHROME_MIN_CLAUDE_VERSION)).toBe(true)
    expect(MIN_CLAUDE_VERSION).not.toBe(CHROME_MIN_CLAUDE_VERSION)
  })
})

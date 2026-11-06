import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { BROWSER_TEST_PROMPT, BrowserTest } from '../../src/core/browserTest'
import { parseHook, type HookMessage } from '../../src/shared/hooks'

// The two real claude --chrome runs recorded in S6.9, through the real hook parser and the test.

/** The hooks of a recorded run, as the hook server hands them over. */
function recorded(name: string): HookMessage[] {
  const file = join(__dirname, '../scenarios', `${name}.json`)
  const { events } = JSON.parse(readFileSync(file, 'utf8')) as {
    events: { event?: string; body?: unknown }[]
  }
  return events
    .filter((step) => step.event !== undefined && step.event !== 'SessionStart')
    .map((step) => parseHook(String(step.event), JSON.stringify(step.body)))
}

const deliver = vi.fn<(text: string) => void>()

function readyTest(): BrowserTest {
  const test = new BrowserTest({
    startWithBrowser: () => 'running',
    deliver,
    discard: () => undefined,
    promptDirty: () => false,
    onChange: () => undefined,
    schedule: () => () => undefined
  })
  test.onClaudeState('idle')
  return test
}

describe('the browser test on recorded runs', () => {
  it('passes on the real run where the page opened', () => {
    const test = readyTest()
    test.start()
    expect(deliver).toHaveBeenCalledExactlyOnceWith(BROWSER_TEST_PROMPT)
    expect(test.status).toEqual({ status: 'testing' })
    for (const message of recorded('browser-navigate')) test.onHook(message)
    expect(test.status).toEqual({ status: 'passed' })
    expect(test.passed).toBe(true)
  })

  it('fails on the real run where the extension was not connected, and says how to fix it', () => {
    const test = readyTest()
    test.start()
    for (const message of recorded('browser-not-connected')) test.onHook(message)
    expect(test.passed).toBe(false)
    expect(test.status).toMatchObject({
      status: 'failed',
      title: 'Claude couldn’t use your browser'
    })
    expect(test.status).toHaveProperty('detail', expect.stringContaining('Reconnect extension'))
  })
})

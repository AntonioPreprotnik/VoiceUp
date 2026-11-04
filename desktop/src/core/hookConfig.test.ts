import { describe, expect, it } from 'vitest'
import {
  buildHookSettings,
  hooksBlockedBy,
  hookUrl,
  REGISTERED_HOOKS,
  type HookPolicies
} from './hookConfig'

const NONE: HookPolicies = { managed: {}, local: {}, project: {}, user: {} }
const PORT = 51234

interface Handler {
  type: string
  url?: string
  command?: string
  args?: string[]
  headers?: Record<string, string>
  allowedEnvVars?: string[]
  timeout: number
}

function handlers(): Record<string, Handler | undefined> {
  const { hooks } = buildHookSettings({
    port: PORT,
    curlPath: 'C:\\Windows\\System32\\curl.exe',
    headerFile: 'C:\\Users\\Ana Maria\\run\\hook-header-1.txt'
  }) as { hooks: Record<string, { hooks: Handler[] }[]> }
  return Object.fromEntries(
    Object.entries(hooks).map(([event, groups]) => {
      const handler = groups.at(0)?.hooks.at(0)
      if (handler === undefined) throw new Error(`No handler for ${event}`)
      return [event, handler]
    })
  )
}

describe('buildHookSettings', () => {
  it('registers every event the state machine needs', () => {
    expect(Object.keys(handlers()).sort()).toEqual([...REGISTERED_HOOKS].sort())
    expect(REGISTERED_HOOKS).toContain('Stop')
  })

  // Regression: with this hook, closing the packaged app took 9.6 s and was force-killed.
  it('does not register SessionEnd', () => {
    expect(Object.keys(handlers())).not.toContain('SessionEnd')
  })

  it('uses curl in exec form for SessionStart, with the token only in a file', () => {
    const { SessionStart } = handlers()
    expect(SessionStart?.type).toBe('command')
    expect(SessionStart?.command).toBe('C:\\Windows\\System32\\curl.exe')
    expect(SessionStart?.args).toContain('@C:\\Users\\Ana Maria\\run\\hook-header-1.txt')
    expect(SessionStart?.args).toContain('--noproxy')
    expect(SessionStart?.args?.at(-1)).toBe(hookUrl(PORT, 'SessionStart'))
    expect(SessionStart?.timeout).toBe(5)
  })

  it.each(REGISTERED_HOOKS.filter((name) => name !== 'SessionStart'))(
    'uses an http hook for %s, with the token from the environment',
    (name) => {
      expect(handlers()[name]).toEqual({
        type: 'http',
        url: `http://127.0.0.1:51234/hooks/${name}`,
        headers: { 'X-VoiceUp-Token': '$VOICEUP_HOOK_TOKEN' },
        allowedEnvVars: ['VOICEUP_HOOK_TOKEN'],
        timeout: 5
      })
    }
  )

  it('never blocks Claude: no hook asks to on failure', () => {
    expect(JSON.stringify(handlers())).not.toContain('onFailure')
  })
})

describe('hooksBlockedBy', () => {
  it('allows hooks when no setting mentions them', () => {
    expect(hooksBlockedBy(NONE, PORT)).toBeNull()
  })

  it.each(['managed', 'local', 'project', 'user'] as const)(
    'sees disableAllHooks at the %s level',
    (level) => {
      expect(hooksBlockedBy({ ...NONE, [level]: { disableAllHooks: true } }, PORT)).toBe(
        'disableAllHooks'
      )
    }
  )

  it('lets a higher level turn disableAllHooks back off', () => {
    const policies = {
      ...NONE,
      local: { disableAllHooks: false },
      user: { disableAllHooks: true }
    }
    expect(hooksBlockedBy(policies, PORT)).toBeNull()
  })

  it('does not let a lower level override a managed disableAllHooks', () => {
    const policies = {
      ...NONE,
      managed: { disableAllHooks: true },
      local: { disableAllHooks: false }
    }
    expect(hooksBlockedBy(policies, PORT)).toBe('disableAllHooks')
  })

  it('honours allowManagedHooksOnly only from managed settings', () => {
    expect(hooksBlockedBy({ ...NONE, managed: { allowManagedHooksOnly: true } }, PORT)).toBe(
      'allowManagedHooksOnly'
    )
    expect(hooksBlockedBy({ ...NONE, user: { allowManagedHooksOnly: true } }, PORT)).toBeNull()
  })

  it.each([
    ['an empty list', [], 'allowedHttpHookUrls'],
    ['another host', ['https://example.com/*'], 'allowedHttpHookUrls'],
    ['another port', ['http://127.0.0.1:1/hooks/*'], 'allowedHttpHookUrls'],
    ['only some events', ['http://127.0.0.1:*/hooks/Stop'], 'allowedHttpHookUrls'],
    ['a dot that is not a wildcard', ['http://127a0a0a1:*/hooks/*'], 'allowedHttpHookUrls'],
    ['a wildcard for any port', ['http://127.0.0.1:*/hooks/*'], null],
    ['everything', ['*'], null]
  ])('with allowedHttpHookUrls as %s', (_label, list, expected) => {
    expect(hooksBlockedBy({ ...NONE, user: { allowedHttpHookUrls: list } }, PORT)).toBe(expected)
  })

  it('merges allowedHttpHookUrls across levels', () => {
    const policies = {
      ...NONE,
      managed: { allowedHttpHookUrls: ['https://example.com/*'] },
      project: { allowedHttpHookUrls: ['http://127.0.0.1:*/*'] }
    }
    expect(hooksBlockedBy(policies, PORT)).toBeNull()
  })

  it('treats a pattern with regex characters as plain text', () => {
    const policies = { ...NONE, user: { allowedHttpHookUrls: ['(((['] } }
    expect(hooksBlockedBy(policies, PORT)).toBe('allowedHttpHookUrls')
  })
})

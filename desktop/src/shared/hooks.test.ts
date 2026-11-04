import { describe, expect, it } from 'vitest'
import { parseHook } from './hooks'

const body = (fields: Record<string, unknown>): string => JSON.stringify(fields)

describe('parseHook', () => {
  it('accepts a valid event', () => {
    expect(
      parseHook('SessionStart', body({ hook_event_name: 'SessionStart', source: 'startup' }))
    ).toEqual({ kind: 'hook', hook: { hook_event_name: 'SessionStart', source: 'startup' } })
  })

  it('keeps an agent_id', () => {
    expect(
      parseHook('PermissionRequest', body({ hook_event_name: 'PermissionRequest', agent_id: 'a1' }))
    ).toEqual({ kind: 'hook', hook: { hook_event_name: 'PermissionRequest', agent_id: 'a1' } })
  })

  it('drops everything the state machine does not read', () => {
    const message = parseHook(
      'PreToolUse',
      body({
        hook_event_name: 'PreToolUse',
        tool_input: { content: 'a secret' },
        cwd: 'C:/private',
        transcript_path: 'C:/private/log.jsonl'
      })
    )
    expect(message).toEqual({ kind: 'hook', hook: { hook_event_name: 'PreToolUse' } })
  })

  it('takes any notification type: judging it is the state machine job', () => {
    expect(
      parseHook(
        'Notification',
        body({ hook_event_name: 'Notification', notification_type: 'from_the_future' })
      )
    ).toEqual({
      kind: 'hook',
      hook: { hook_event_name: 'Notification', notification_type: 'from_the_future' }
    })
  })

  it.each([
    ['an unknown event', 'NewEvent', body({ hook_event_name: 'NewEvent' }), 'unknown event'],
    ['a name from Object.prototype', 'constructor', '{}', 'unknown event'],
    ['broken JSON', 'Stop', '{not json', 'invalid JSON'],
    ['an empty body', 'Stop', '', 'invalid JSON'],
    ['JSON that is not an object', 'Stop', '[1]', 'invalid body'],
    ['no event name in the body', 'Stop', '{}', 'invalid body'],
    [
      'SessionStart with no source',
      'SessionStart',
      body({ hook_event_name: 'SessionStart' }),
      'invalid body'
    ],
    [
      'SessionEnd with no reason',
      'SessionEnd',
      body({ hook_event_name: 'SessionEnd' }),
      'invalid body'
    ],
    [
      'a Notification with no type',
      'Notification',
      body({ hook_event_name: 'Notification' }),
      'invalid body'
    ],
    [
      'a wrong field type',
      'Stop',
      body({ hook_event_name: 'Stop', background_tasks: 1 }),
      'invalid body'
    ],
    ['a body for another event', 'Stop', body({ hook_event_name: 'PreToolUse' }), 'name mismatch']
  ])('reports %s as unexpected', (_label, name, raw, reason) => {
    expect(parseHook(name, raw)).toEqual({ kind: 'unexpected', name, reason })
  })
})

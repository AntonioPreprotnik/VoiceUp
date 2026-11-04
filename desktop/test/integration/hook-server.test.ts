import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, request } from 'node:http'
import { connect, type AddressInfo } from 'node:net'
import { networkInterfaces, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { parseClaudeOverride } from '../../src/core/claudeCommand'
import { buildHookSettings, REGISTERED_HOOKS } from '../../src/core/hookConfig'
import { HookServer } from '../../src/main/hooks/server'
import { HOOK_NAMES, parseHook, type HookMessage } from '../../src/shared/hooks'
import fakeLog from '../fakes/electronLog'

vi.mock('electron', () => import('../fakes/electron'))
vi.mock('electron-log/main', () => import('../fakes/electronLog'))

const DESKTOP = join(__dirname, '../..')
const SCENARIOS = join(DESKTOP, 'test/scenarios')
const CURL = join(process.env['SystemRoot'] ?? 'C:/Windows', 'System32/curl.exe')
const registered = (event: string): boolean =>
  (REGISTERED_HOOKS as readonly string[]).includes(event)

interface Step {
  event?: string
  body?: unknown
  ptyExit?: number
}

function scenario(name: string): Step[] {
  const raw = readFileSync(join(SCENARIOS, `${name}.json`), 'utf8')
  return (JSON.parse(raw) as { events: Step[] }).events
}

const SCENARIO_NAMES = readdirSync(SCENARIOS).map((file) => file.replace(/\.json$/, ''))

let server: HookServer
let port: number
let received: HookMessage[]
let dir: string

interface Reply {
  status: number | undefined
  body: string
}

function send(
  path: string,
  body: string,
  options: { token?: string | null; method?: string } = {}
): Promise<Reply> {
  const { method = 'POST' } = options
  const token = options.token === undefined ? server.token : options.token
  return new Promise((resolve, reject) => {
    const outgoing = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method,
        headers: token === null ? {} : { 'X-VoiceUp-Token': token }
      },
      (response) => {
        const chunks: Buffer[] = []
        response.on('data', (chunk: Buffer) => chunks.push(chunk))
        response.on('end', () => {
          resolve({
            status: response.statusCode,
            body: Buffer.concat(chunks).toString('utf8')
          })
        })
      }
    )
    outgoing.on('error', reject)
    outgoing.end(body)
  })
}

beforeEach(async () => {
  fakeLog.reset()
  received = []
  dir = mkdtempSync(join(tmpdir(), 'voiceup-hooks-'))
  server = new HookServer({ onMessage: (message) => received.push(message) })
  port = await server.start()
})

afterEach(async () => {
  await server.stop()
  rmSync(dir, { recursive: true, force: true })
})

describe('the token', () => {
  it.each([
    ['no token', null],
    ['a wrong token', 'wrong'],
    ['a wrong token of the right length', 'x'.repeat(64)]
  ])('rejects %s with a 401, a log line and no event', async (_label, token) => {
    const body = JSON.stringify({ hook_event_name: 'Stop' })
    expect(await send('/hooks/Stop', body, { token })).toEqual({ status: 401, body: '' })
    expect(received).toEqual([])
    expect(fakeLog.messages('warn').flat().join()).toContain('bad token')
  })

  it('is different for each server, and long enough', async () => {
    const other = new HookServer({ onMessage: vi.fn() })
    expect(other.token).not.toBe(server.token)
    expect(other.token).toHaveLength(64)
    await other.stop()
  })

  it('never appears in the log', async () => {
    await send('/hooks/Stop', '{}')
    await send('/hooks/Stop', '{}', { token: 'wrong' })
    expect(JSON.stringify(fakeLog.messages('warn'))).not.toContain(server.token)
    expect(JSON.stringify(fakeLog.messages('debug'))).not.toContain(server.token)
  })
})

describe('after a valid token', () => {
  const STOP = JSON.stringify({ hook_event_name: 'Stop' })

  it('delivers a valid event, with an empty 200', async () => {
    expect(await send('/hooks/Stop', STOP)).toEqual({ status: 200, body: '' })
    expect(received).toEqual([{ kind: 'hook', hook: { hook_event_name: 'Stop' } }])
  })

  it.each([
    ['broken JSON', '/hooks/Stop', '{nope', 'POST', { name: 'Stop', reason: 'invalid JSON' }],
    ['an empty body', '/hooks/Stop', '', 'POST', { name: 'Stop', reason: 'invalid JSON' }],
    ['a bad body', '/hooks/Stop', '{"a":1}', 'POST', { name: 'Stop', reason: 'invalid body' }],
    [
      'an unknown event',
      '/hooks/NewEvent',
      '{}',
      'POST',
      { name: 'NewEvent', reason: 'unknown event' }
    ],
    ['another path', '/other', STOP, 'POST', { name: '<invalid>', reason: 'bad request' }],
    [
      'a query string',
      '/hooks/Stop?x=1',
      STOP,
      'POST',
      { name: '<invalid>', reason: 'bad request' }
    ],
    ['a traversal', '/hooks/../Stop', STOP, 'POST', { name: '<invalid>', reason: 'bad request' }],
    ['a GET', '/hooks/Stop', '', 'GET', { name: 'Stop', reason: 'bad request' }]
  ])(
    'answers 200 to %s, and reports it as unexpected',
    async (_label, path, body, method, expected) => {
      expect(await send(path, body, { method })).toEqual({ status: 200, body: '' })
      expect(received).toEqual([{ kind: 'unexpected', ...expected }])
      expect(fakeLog.messages('warn').flat().join()).toContain(expected.reason)
    }
  )

  it('answers 200 to a body over 1 MB, without keeping it', async () => {
    const huge = 'x'.repeat(1024 * 1024 + 1)
    expect(await send('/hooks/Stop', huge)).toEqual({ status: 200, body: '' })
    expect(received).toEqual([{ kind: 'unexpected', name: 'Stop', reason: 'body too large' }])
  })

  it('accepts a body of exactly 1 MB', async () => {
    const padded = JSON.stringify({ hook_event_name: 'Stop', pad: '' })
    const body = padded.replace('"pad":""', `"pad":"${'x'.repeat(1024 * 1024 - padded.length)}"`)
    expect(Buffer.byteLength(body)).toBe(1024 * 1024)
    await send('/hooks/Stop', body)
    expect(received).toEqual([{ kind: 'hook', hook: { hook_event_name: 'Stop' } }])
  })

  it('still answers 200 when handling the event throws, and logs it', async () => {
    await server.stop()
    server = new HookServer({
      onMessage: () => {
        throw new Error('reducer bug')
      }
    })
    port = await server.start()
    expect(await send('/hooks/Stop', STOP)).toEqual({ status: 200, body: '' })
    expect(fakeLog.messages('error').flat().join()).toContain('reducer bug')
  })

  it('never logs a body, even at debug', async () => {
    const secret = 'delete-the-production-database'
    await send(
      '/hooks/UserPromptSubmit',
      JSON.stringify({ hook_event_name: 'UserPromptSubmit', prompt: secret })
    )
    await send('/hooks/Stop', `{"broken": "${secret}`)
    for (const level of ['error', 'warn', 'info', 'debug'] as const) {
      expect(JSON.stringify(fakeLog.messages(level))).not.toContain(secret)
    }
  })
})

describe('listening', () => {
  it('takes a different port each time', async () => {
    const other = new HookServer({ onMessage: vi.fn() })
    const otherPort = await other.start()
    expect(otherPort).not.toBe(port)
    await other.stop()
  })

  // A real connection through this machine's own network address, which a server on 0.0.0.0 accepts.
  const lanAddress = Object.values(networkInterfaces())
    .flat()
    .find((address) => address?.family === 'IPv4' && !address.internal)?.address

  it.skipIf(lanAddress === undefined)('refuses a connection from the network', async () => {
    const outcome = await new Promise<string>((resolve) => {
      const socket = connect({ host: lanAddress, port, timeout: 3000 })
      socket.on('connect', () => {
        socket.destroy()
        resolve('connected')
      })
      socket.on('timeout', () => {
        socket.destroy()
        resolve('timeout')
      })
      socket.on('error', (error: NodeJS.ErrnoException) => {
        resolve(error.code ?? 'error')
      })
    })
    expect(outcome).not.toBe('connected')
    await expect(send('/hooks/Stop', '{}')).resolves.toMatchObject({ status: 200 })
  })

  it('can be stopped twice, and frees the port', async () => {
    await server.stop()
    await server.stop()
    const taken = createServer()
    await new Promise<void>((resolve) => taken.listen(port, '127.0.0.1', resolve))
    expect((taken.address() as AddressInfo).port).toBe(port)
    await new Promise((resolve) => taken.close(resolve))
  })

  it('stops with a connection still open', async () => {
    const pending = request({ host: '127.0.0.1', port, path: '/hooks/Stop', method: 'POST' })
    pending.on('error', () => {
      // Expected: closing the server cuts this request off.
    })
    pending.write('{')
    await expect(server.stop()).resolves.toBeUndefined()
    pending.destroy()
  })
})

describe('the recorded fixtures', () => {
  it('cover every hook the app listens to', () => {
    const seen = new Set(SCENARIO_NAMES.flatMap((name) => scenario(name).map(({ event }) => event)))
    for (const name of HOOK_NAMES) {
      expect(seen).toContain(name)
    }
  })

  it.each(SCENARIO_NAMES)('%s parses cleanly', (name) => {
    for (const { event, body } of scenario(name)) {
      if (event === undefined) continue
      expect(parseHook(event, JSON.stringify(body)).kind).toBe('hook')
    }
  })

  it.each(SCENARIO_NAMES)('%s holds nothing private', (name) => {
    const raw = readFileSync(join(SCENARIOS, `${name}.json`), 'utf8')
    expect(raw).not.toMatch(/Users|\\\\|"cwd"|"transcript_path"|"tool_input"|"session_id"/)
  })
})

describe('the fake Claude, through VOICEUP_CLAUDE_CMD', () => {
  // The real generated config, with a space in its folder as on many PCs.
  function writeSettings(token: string): string {
    const folder = join(dir, 'Ana Maria')
    mkdirSync(folder, { recursive: true })
    const headerFile = join(folder, 'header.txt')
    writeFileSync(headerFile, `X-VoiceUp-Token: ${token}\n`)
    const path = join(folder, 'hooks.json')
    writeFileSync(path, JSON.stringify(buildHookSettings({ port, curlPath: CURL, headerFile })))
    return path
  }

  function run(
    name: string,
    token = server.token
  ): Promise<{ code: number | null; output: string }> {
    const command = parseClaudeOverride('["node", "test/fake-claude.mjs"]')
    if (command === null) throw new Error('The override did not parse')
    const child = spawn(command.file, [...command.args, '--settings', writeSettings(token)], {
      cwd: DESKTOP,
      env: {
        ...process.env,
        VOICEUP_HOOK_TOKEN: token,
        VOICEUP_FAKE_SCENARIO: name,
        VOICEUP_FAKE_SPEED: '0'
      }
    })
    let output = ''
    child.stdout.on('data', (chunk: Buffer) => {
      output += chunk.toString('utf8')
      // Scenarios that don't crash stay alive until their terminal closes, as Claude does.
      if (output.includes('scenario finished')) child.stdin.end()
    })
    return new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => {
        resolve({ code, output })
      })
    })
  }

  it.each(SCENARIO_NAMES)(
    'replays %s in order, with no hook errors',
    async (name) => {
      const steps = scenario(name)
      const { output, code } = await run(name)
      expect(output).not.toContain('hook error')
      const names = received.map((message) =>
        message.kind === 'hook' ? message.hook.hook_event_name : message
      )
      expect(names).toEqual(
        steps.flatMap(({ event }) => (event !== undefined && registered(event) ? [event] : []))
      )
      const exit = steps.find((step) => step.ptyExit !== undefined)?.ptyExit
      if (name === 'crash-mid-turn') expect(code).toBe(exit)
    },
    30000
  )

  it('shows Claude a hook error when the token is wrong, as a real one would', async () => {
    const { output, code } = await run('plain', 'wrong-token')
    expect(output).toContain('hook error')
    expect(code).toBe(3)
    expect(received).toEqual([])
  }, 30000)
})

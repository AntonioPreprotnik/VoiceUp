import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { request } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import type { HookPolicies } from '../../core/hookConfig'
import fakeLog from '../../../test/fakes/electronLog'
import type { HookMessage } from '../../shared/hooks'
import { HookLink } from './link'
import { readHookPolicies } from './policy'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const NONE: HookPolicies = { managed: {}, local: {}, project: {}, user: {} }

let root: string
let runDir: string
let link: HookLink | undefined
let onUnavailable: Mock
let onStartingSlow: Mock
let messages: HookMessage[]
let policies: HookPolicies

function makeLink(): HookLink {
  link = new HookLink({
    runDir,
    curlPath: 'C:\\Windows\\System32\\curl.exe',
    readPolicies: () => policies,
    onMessage: (message) => messages.push(message),
    onUnavailable,
    onStartingSlow
  })
  return link
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voiceup-link-'))
  runDir = join(root, 'run')
  onUnavailable = vi.fn()
  onStartingSlow = vi.fn()
  messages = []
  policies = NONE
  fakeLog.reset()
})

afterEach(async () => {
  vi.useRealTimers()
  await link?.stopServer()
  link = undefined
  rmSync(root, { recursive: true, force: true })
})

describe('the files', () => {
  it('deletes hook files left by a crashed run, and nothing else', async () => {
    mkdirSync(runDir)
    writeFileSync(join(runDir, 'hooks-999.json'), 'stale')
    writeFileSync(join(runDir, 'hook-header-999.txt'), 'stale token')
    writeFileSync(join(runDir, 'other.txt'), 'keep')
    await makeLink().prepareLaunch('C:\\project')
    const names = readdirSync(runDir)
    expect(names).not.toContain('hooks-999.json')
    expect(names).not.toContain('hook-header-999.txt')
    expect(names).toContain('other.txt')
  })

  it('passes the settings file, and the token only through the environment and a file', async () => {
    const created = makeLink()
    const { args, env } = await created.prepareLaunch('C:\\project')
    expect(args[0]).toBe('--settings')
    const path = args[1] ?? ''
    expect(env).toEqual({ VOICEUP_HOOK_TOKEN: created['server'].token })
    expect(args.join(' ')).not.toContain(created['server'].token)
    expect(readFileSync(path, 'utf8')).not.toContain(created['server'].token)
    const names = readdirSync(runDir)
    const header = names.find((name) => name.startsWith('hook-header-')) ?? ''
    expect(readFileSync(join(runDir, header), 'utf8')).toContain(created['server'].token)
  })

  it('writes only inside its run folder', async () => {
    await makeLink().prepareLaunch('C:\\project')
    expect(readdirSync(root)).toEqual(['run'])
  })

  it('removes its files on request', async () => {
    const created = makeLink()
    const { args } = await created.prepareLaunch('C:\\project')
    created.removeFiles()
    expect(existsSync(args[1] ?? '')).toBe(false)
    expect(readdirSync(runDir)).toEqual([])
  })
})

describe('the hooks in the file reach the server', () => {
  it('passes messages on, using the port and token it wrote', async () => {
    const created = makeLink()
    const { args, env } = await created.prepareLaunch('C:\\project')
    const { hooks } = JSON.parse(readFileSync(args[1] ?? '', 'utf8')) as {
      hooks: { Stop: { hooks: { url: string }[] }[] }
    }
    const url = new URL(hooks.Stop[0]?.hooks[0]?.url ?? '')
    await new Promise<void>((resolve, reject) => {
      const outgoing = request(
        {
          host: url.hostname,
          port: url.port,
          path: url.pathname,
          method: 'POST',
          headers: { 'X-VoiceUp-Token': env['VOICEUP_HOOK_TOKEN'] }
        },
        (response) => {
          response.resume()
          response.on('end', resolve)
        }
      )
      outgoing.on('error', reject)
      outgoing.end(JSON.stringify({ hook_event_name: 'Stop' }))
    })
    expect(messages).toEqual([{ kind: 'hook', hook: { hook_event_name: 'Stop' } }])
  })
})

describe('when Claude settings stop the hooks', () => {
  beforeEach(() => {
    policies = { ...NONE, user: { disableAllHooks: true } }
  })

  it('passes no hooks, reports it and turns voice off', async () => {
    const created = makeLink()
    expect(await created.prepareLaunch('C:\\project')).toEqual({ args: [], env: {} })
    expect(onUnavailable).toHaveBeenCalledWith('HOOKS_BLOCKED', 'disableAllHooks')
    expect(created.voiceBlock).toBe('HOOKS_BLOCKED')
  })

  it('turns voice back on when a later launch is allowed', async () => {
    const created = makeLink()
    await created.prepareLaunch('C:\\blocked')
    policies = NONE
    await created.prepareLaunch('C:\\fine')
    expect(created.voiceBlock).toBeNull()
  })

  it('shows no slow start hint, since no SessionStart can arrive', async () => {
    const created = makeLink()
    await created.prepareLaunch('C:\\project')
    vi.useFakeTimers()
    created.launched()
    vi.advanceTimersByTime(60000)
    expect(onStartingSlow).not.toHaveBeenCalled()
  })
})

describe('when the server cannot start', () => {
  it('still lets Claude start, with voice off', async () => {
    // A file where the run folder should be, so preparing fails.
    writeFileSync(runDir, 'in the way')
    const created = makeLink()
    expect(await created.prepareLaunch('C:\\project')).toEqual({ args: [], env: {} })
    expect(onUnavailable).toHaveBeenCalledWith('HOOKS_FAILED', null)
    expect(created.voiceBlock).toBe('HOOKS_FAILED')
    expect(fakeLog.messages('error').flat().join()).toContain('HOOKS_FAILED')
  })
})

describe('the slow start hint', () => {
  async function launched(): Promise<HookLink> {
    const created = makeLink()
    await created.prepareLaunch('C:\\project')
    vi.useFakeTimers()
    created.launched()
    return created
  }

  it('fires after 30 s with no SessionStart', async () => {
    await launched()
    vi.advanceTimersByTime(29999)
    expect(onStartingSlow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(onStartingSlow).toHaveBeenCalledOnce()
  })

  it('does not fire once SessionStart arrives', async () => {
    const created = await launched()
    created['server']['options'].onMessage({
      kind: 'hook',
      hook: { hook_event_name: 'SessionStart', source: 'startup' }
    })
    vi.advanceTimersByTime(60000)
    expect(onStartingSlow).not.toHaveBeenCalled()
  })

  it('does not fire when Claude exits first', async () => {
    const created = await launched()
    created.exited()
    vi.advanceTimersByTime(60000)
    expect(onStartingSlow).not.toHaveBeenCalled()
  })

  it('restarts with a new launch, so a restart gets its own 30 s', async () => {
    const created = await launched()
    vi.advanceTimersByTime(20000)
    created.launched()
    vi.advanceTimersByTime(20000)
    expect(onStartingSlow).not.toHaveBeenCalled()
    vi.advanceTimersByTime(10000)
    expect(onStartingSlow).toHaveBeenCalledOnce()
  })
})

describe('reading Claude settings', () => {
  const secret = 'do-not-log-this-value'

  function write(path: string, content: string): void {
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, content)
  }

  function read(): HookPolicies {
    return readHookPolicies({
      projectDir: join(root, 'project'),
      userDir: join(root, 'user'),
      managedDir: join(root, 'managed')
    })
  }

  it('finds nothing when no files exist, without complaint', () => {
    expect(read()).toEqual(NONE)
    expect(fakeLog.messages('warn')).toEqual([])
  })

  it('reads each level', () => {
    write(join(root, 'user/settings.json'), '{"disableAllHooks":true}')
    write(join(root, 'project/.claude/settings.json'), '{"allowedHttpHookUrls":["a"]}')
    write(join(root, 'project/.claude/settings.local.json'), '{"allowedHttpHookUrls":["b"]}')
    write(join(root, 'managed/managed-settings.json'), '{"allowManagedHooksOnly":true}')
    expect(read()).toEqual({
      user: { disableAllHooks: true },
      project: { allowedHttpHookUrls: ['a'] },
      local: { allowedHttpHookUrls: ['b'] },
      managed: { allowManagedHooksOnly: true }
    })
  })

  it('keeps only the keys that can stop hooks', () => {
    write(
      join(root, 'user/settings.json'),
      JSON.stringify({ disableAllHooks: false, apiKeyHelper: secret, env: { TOKEN: secret } })
    )
    expect(JSON.stringify(read())).not.toContain(secret)
  })

  it('merges managed drop-in files', () => {
    write(join(root, 'managed/managed-settings.json'), '{"allowedHttpHookUrls":["a"]}')
    write(
      join(root, 'managed/managed-settings.d/10-x.json'),
      '{"allowedHttpHookUrls":["b"],"disableAllHooks":true}'
    )
    write(join(root, 'managed/managed-settings.d/readme.txt'), 'ignored')
    expect(read().managed).toEqual({ allowedHttpHookUrls: ['a', 'b'], disableAllHooks: true })
  })

  it.each([
    ['broken JSON', `{"x":"${secret}`],
    ['the wrong shape', `["${secret}"]`]
  ])('survives %s, and logs nothing from the file', (_label, content) => {
    write(join(root, 'user/settings.json'), content)
    expect(read().user).toEqual({})
    const logged = JSON.stringify(fakeLog.messages('warn'))
    expect(logged).toContain('user')
    expect(logged).not.toContain(secret)
  })

  it('ignores a value of the wrong type', () => {
    write(join(root, 'user/settings.json'), '{"disableAllHooks":"yes"}')
    expect(read().user).toEqual({})
  })
})

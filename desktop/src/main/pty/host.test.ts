import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { PAUSE_ABOVE_CHARS } from '../../core/terminalFlow'
import { TERMINAL_RESET } from '../../shared/ipcChannels'
import fakeLog from '../../../test/fakes/electronLog'
import { FakePty, lastPty, resetFakePty, spawned } from '../../../test/fakes/nodePty'
import { PtyHost } from './host'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))
vi.mock('node-pty', () => import('../../../test/fakes/nodePty'))

const claude = { file: 'claude.exe', args: ['--flag'] }

function createHost(command: typeof claude | null = claude): {
  host: PtyHost
  sent: string[]
  exits: (number | null)[]
} {
  const sent: string[] = []
  const exits: (number | null)[] = []
  const host = new PtyHost({
    send: (data) => sent.push(data),
    onExit: (exitCode) => exits.push(exitCode),
    resolveCommand: () => Promise.resolve(command),
    resolveCwd: () => Promise.resolve('C:\\work')
  })
  return { host, sent, exits }
}

async function started(host: PtyHost, cols = 100, rows = 30): Promise<FakePty> {
  host.resize({ cols, rows })
  await vi.advanceTimersByTimeAsync(0)
  await vi.waitFor(() => {
    expect(spawned).toHaveLength(1)
  })
  return lastPty()
}

beforeEach(() => {
  vi.useFakeTimers()
  resetFakePty()
  fakeLog.reset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('starting', () => {
  it('does not start until the renderer reports a size', async () => {
    createHost()
    await vi.advanceTimersByTimeAsync(100)
    expect(spawned).toEqual([])
  })

  it('starts at the first size, with the command and folder it was given', async () => {
    const { host } = createHost()
    const pty = await started(host, 120, 40)
    expect(pty.file).toBe('claude.exe')
    expect(pty.args).toEqual(['--flag'])
    expect(pty.options).toMatchObject({
      name: 'xterm-256color',
      cols: 120,
      rows: 40,
      cwd: 'C:\\work'
    })
  })

  it('starts only once, however many sizes arrive', async () => {
    const { host } = createHost()
    host.resize({ cols: 80, rows: 24 })
    host.resize({ cols: 81, rows: 24 })
    await started(host)
    expect(spawned).toHaveLength(1)
  })

  it('removes the nested-session variables from the environment', async () => {
    vi.stubEnv('CLAUDECODE', '1')
    vi.stubEnv('CLAUDE_CODE_ENTRYPOINT', 'cli')
    vi.stubEnv('VOICEUP_TEST_VAR', 'kept')
    const { host } = createHost()
    const pty = await started(host)
    const env = pty.options['env'] as Record<string, string>
    expect(env['CLAUDECODE']).toBeUndefined()
    expect(env['CLAUDE_CODE_ENTRYPOINT']).toBeUndefined()
    expect(env['VOICEUP_TEST_VAR']).toBe('kept')
  })

  it('shows a message and a next step when Claude is not installed', async () => {
    const { host, sent } = createHost(null)
    host.resize({ cols: 80, rows: 24 })
    await vi.waitFor(() => {
      expect(sent.join('')).toContain("Claude Code isn't installed")
    })
    expect(sent.join('')).toContain('Install Claude Code')
    expect(spawned).toEqual([])
    expect(fakeLog.messages('error')).toEqual([['CLAUDE_NOT_FOUND']])
  })

  it('reports an exit with no code when the spawn fails', async () => {
    const exits: (number | null)[] = []
    const host = new PtyHost({
      send: () => undefined,
      onExit: (exitCode) => exits.push(exitCode),
      resolveCommand: () => Promise.reject(new Error('boom')),
      resolveCwd: () => Promise.resolve('C:\\work')
    })
    host.resize({ cols: 80, rows: 24 })
    await vi.waitFor(() => {
      expect(exits).toEqual([null])
    })
    expect(fakeLog.messages('error')).toHaveLength(1)
  })
})

describe('input and output', () => {
  it('writes input to the PTY', async () => {
    const { host } = createHost()
    const pty = await started(host)
    host.write('hello\r')
    expect(pty.written).toEqual(['hello\r'])
  })

  it('ignores input before Claude has started', () => {
    const { host } = createHost()
    expect(() => {
      host.write('early')
    }).not.toThrow()
  })

  it('batches output per 16 ms', async () => {
    const { host, sent } = createHost()
    const pty = await started(host)
    pty.emitData('a')
    pty.emitData('b')
    expect(sent).toEqual([])
    await vi.advanceTimersByTimeAsync(16)
    expect(sent).toEqual(['ab'])
  })

  it('logs the time to the first visible text, not to the first setup codes', async () => {
    const { host } = createHost()
    const pty = await started(host)
    pty.emitData('\x1b[2J\x1b[H')
    expect(JSON.stringify(fakeLog.messages('info'))).not.toContain('First Claude text')
    pty.emitData('Welcome')
    pty.emitData('more')
    const timings = fakeLog
      .messages('info')
      .filter(([message]) => String(message).includes('First'))
    expect(timings).toHaveLength(1)
  })

  it('never logs what Claude printed', async () => {
    const { host } = createHost()
    const pty = await started(host)
    pty.emitData('secret-output')
    await vi.advanceTimersByTimeAsync(16)
    expect(JSON.stringify(fakeLog.messages('info'))).not.toContain('secret-output')
  })

  it('pauses above 1 MB unacknowledged, and resumes on acknowledgement', async () => {
    const { host } = createHost()
    const pty = await started(host)
    pty.emitData('x'.repeat(PAUSE_ABOVE_CHARS + 1))
    await vi.advanceTimersByTimeAsync(16)
    expect(pty.pauseCount).toBe(1)
    expect(pty.resumeCount).toBe(0)
    host.acknowledge(PAUSE_ABOVE_CHARS + 1)
    expect(pty.resumeCount).toBe(1)
  })
})

describe('resizing', () => {
  it('debounces by 50 ms and applies only the last size', async () => {
    const { host } = createHost()
    const pty = await started(host)
    host.resize({ cols: 90, rows: 30 })
    host.resize({ cols: 95, rows: 31 })
    await vi.advanceTimersByTimeAsync(49)
    expect(pty.resizes).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(pty.resizes).toEqual([[95, 31]])
  })

  it('clamps an out-of-range size', async () => {
    const { host } = createHost()
    const pty = await started(host)
    host.resize({ cols: 5000, rows: 1 })
    await vi.advanceTimersByTimeAsync(50)
    expect(pty.resizes).toEqual([[1000, 5]])
  })

  it('skips a resize to the size it already has', async () => {
    const { host } = createHost()
    const pty = await started(host, 100, 30)
    host.resize({ cols: 100, rows: 30 })
    await vi.advanceTimersByTimeAsync(50)
    expect(pty.resizes).toEqual([])
  })
})

describe('restarting', () => {
  it('kills the old session and starts a new one at the current size', async () => {
    const { host, exits } = createHost()
    const first = await started(host, 90, 30)
    const restarted = host.restart()
    expect(first.killCount).toBe(1)
    first.emitExit(0)
    await restarted
    expect(spawned).toHaveLength(2)
    expect(lastPty().options).toMatchObject({ cols: 90, rows: 30 })
    expect(exits).toEqual([])
  })

  it('starts a new session even if the old one will not exit', async () => {
    const { host } = createHost()
    await started(host)
    const restarted = host.restart()
    await vi.advanceTimersByTimeAsync(2000)
    await restarted
    expect(spawned).toHaveLength(2)
  })

  it('ignores a late exit and late output from the replaced session', async () => {
    const { host, sent, exits } = createHost()
    const first = await started(host)
    const restarted = host.restart()
    await vi.advanceTimersByTimeAsync(2000)
    await restarted
    const second = lastPty()

    first.emitData('old output')
    first.emitExit(1)
    await vi.advanceTimersByTimeAsync(16)
    expect(sent.join('')).not.toContain('old output')
    expect(exits).toEqual([])

    host.write('still connected')
    expect(second.written).toEqual(['still connected'])
  })

  it('does not begin a second start during a restart', async () => {
    const { host } = createHost()
    const first = await started(host)
    const restarted = host.restart()
    host.resize({ cols: 70, rows: 20 })
    first.emitExit(0)
    await restarted
    expect(spawned).toHaveLength(2)
    expect(lastPty().options).toMatchObject({ cols: 70, rows: 20 })
  })

  it('joins a restart already in progress, so two requests make one session', async () => {
    const { host } = createHost()
    const first = await started(host)
    const restarts = [host.restart(), host.restart()]
    first.emitExit(0)
    await Promise.all(restarts)
    expect(first.killCount).toBe(1)
    expect(spawned).toHaveLength(2)
  })

  it('can restart again after a restart has finished', async () => {
    const { host } = createHost()
    const first = await started(host)
    const once = host.restart()
    first.emitExit(0)
    await once
    const second = lastPty()
    const twice = host.restart()
    second.emitExit(0)
    await twice
    expect(spawned).toHaveLength(3)
  })

  it('starts a new session after Claude has already exited', async () => {
    const { host } = createHost()
    const first = await started(host, 88, 22)
    first.emitExit(1)
    await host.restart()
    expect(spawned).toHaveLength(2)
    expect(lastPty().options).toMatchObject({ cols: 88, rows: 22 })
  })

  it('sends the screen reset as its own message, which the banner relies on', async () => {
    const { host, sent } = createHost()
    const first = await started(host)
    first.emitData('old output')
    const restarted = host.restart()
    first.emitExit(0)
    await restarted
    expect(sent).toContain(TERMINAL_RESET)
  })

  it('does nothing beyond clearing when no size has arrived yet', async () => {
    const { host } = createHost()
    await host.restart()
    expect(spawned).toEqual([])
  })
})

describe('exit and stop', () => {
  it('flushes output and reports the exit code when Claude exits', async () => {
    const { host, sent, exits } = createHost()
    const pty = await started(host)
    pty.emitData('last words')
    pty.emitExit(3)
    expect(sent[0]).toBe('last words')
    expect(exits).toEqual([3])
  })

  it('kills and waits for exit on stop, with no exit report', async () => {
    const { host, exits } = createHost()
    const pty = await started(host)
    const stopped = host.stop()
    expect(pty.killCount).toBe(1)
    pty.emitExit(0)
    await stopped
    expect(exits).toEqual([])
  })

  it('gives up waiting after 2 s if Claude does not exit', async () => {
    const { host } = createHost()
    await started(host)
    let finished = false
    void host.stop().then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(1999)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(finished).toBe(true)
  })

  it('stops cleanly when Claude never started', async () => {
    const { host } = createHost()
    await expect(host.stop()).resolves.toBeUndefined()
  })

  it('does not start Claude if stop comes first', async () => {
    const { host } = createHost()
    host.resize({ cols: 80, rows: 24 })
    await host.stop()
    await vi.advanceTimersByTimeAsync(10)
    expect(spawned).toEqual([])
  })

  it('ignores input after Claude has exited', async () => {
    const { host } = createHost()
    const pty = await started(host)
    pty.emitExit(0)
    host.write('late')
    expect(pty.written).toEqual([])
  })
})

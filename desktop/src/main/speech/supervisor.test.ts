import type { WebContents } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakes, utilityProcess } from '../../../test/fakes/electron'
import fakeLog from '../../../test/fakes/electronLog'
import { Channels } from '../../shared/ipcChannels'
import type { WorkerEvent, WorkerInit } from '../../shared/worker'
import { SpeechSupervisor } from './supervisor'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const init: WorkerInit = {
  type: 'init',
  modelId: null,
  modelPaths: null,
  sileroPath: 'silero.onnx',
  vad: { endSilenceSec: 1.2, minSpeechSec: 0.25, maxRecordingSec: 60, noSpeechTimeoutSec: 8 },
  numThreads: 4
}

let events: WorkerEvent[]
let gaveUp: number
let clock: number

function create(): SpeechSupervisor {
  return new SpeechSupervisor({
    onEvent: (event) => events.push(event),
    onGaveUp: () => {
      gaveUp++
    },
    now: () => clock
  })
}

function latest(): (typeof utilityProcess.children)[number] {
  const child = utilityProcess.children.at(-1)
  if (child === undefined) throw new Error('No worker was forked')
  return child
}

function fakeRecorder(): { contents: WebContents; sent: { channel: string; ports: unknown[] }[] } {
  const sent: { channel: string; ports: unknown[] }[] = []
  const contents = {
    isDestroyed: () => false,
    postMessage: (channel: string, _message: unknown, ports: unknown[]) => {
      sent.push({ channel, ports })
    }
  } as unknown as WebContents
  return { contents, sent }
}

beforeEach(() => {
  resetFakes()
  events = []
  gaveUp = 0
  clock = 0
})

afterEach(() => {
  vi.useRealTimers()
})

describe('starting', () => {
  it('forks the worker and sends it init', () => {
    create().start(init)
    expect(utilityProcess.children).toHaveLength(1)
    expect(latest().modulePath).toMatch(/speechWorker\.js$/)
    expect(latest().messages).toEqual([{ message: init, ports: undefined }])
  })
})

describe('messages from the worker', () => {
  it('passes on a valid event', () => {
    create().start(init)
    latest().emit('message', { type: 'speechStart', recordingId: 'r1' })
    expect(events).toEqual([{ type: 'speechStart', recordingId: 'r1' }])
  })

  it.each([
    ['an unknown type', { type: 'nonsense' }],
    ['a missing field', { type: 'transcript', recordingId: 'r1' }],
    ['a wrong field type', { type: 'level', recordingId: 'r1', rms: 'loud' }],
    ['an unknown error code', { type: 'error', code: 'WHATEVER', message: 'x' }],
    ['not an object', 'hello']
  ])('drops and logs %s', (_label, raw) => {
    create().start(init)
    latest().emit('message', raw)
    expect(events).toEqual([])
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })

  it('never logs what was transcribed', () => {
    create().start(init)
    latest().emit('message', {
      type: 'transcript',
      recordingId: 'r1',
      text: 'a private sentence',
      decodeMs: 'bad'
    })
    expect(JSON.stringify(fakeLog.messages('warn'))).not.toContain('private')
  })
})

describe('commands', () => {
  it('sends them to the worker', () => {
    const supervisor = create()
    supervisor.start(init)
    supervisor.send({ type: 'start', recordingId: 'r1' })
    expect(latest().messages.at(-1)?.message).toEqual({ type: 'start', recordingId: 'r1' })
  })
})

describe('after a crash', () => {
  it('restarts and sends init again', () => {
    create().start(init)
    const first = latest()
    first.emit('exit', 1)
    expect(utilityProcess.children).toHaveLength(2)
    expect(latest()).not.toBe(first)
    expect(latest().messages[0]?.message).toEqual(init)
    expect(fakeLog.messages('error')).toHaveLength(1)
  })

  it('gives up on the third crash within 60 s', () => {
    create().start(init)
    latest().emit('exit', 1)
    latest().emit('exit', 1)
    expect(gaveUp).toBe(0)
    latest().emit('exit', 1)
    expect(gaveUp).toBe(1)
    expect(utilityProcess.children).toHaveLength(3)
  })

  it('does not count crashes older than 60 s', () => {
    create().start(init)
    latest().emit('exit', 1)
    clock += 30000
    latest().emit('exit', 1)
    clock += 40000
    latest().emit('exit', 1)
    expect(gaveUp).toBe(0)
    expect(utilityProcess.children).toHaveLength(4)
  })

  it('ignores an exit from a worker already replaced', () => {
    create().start(init)
    const first = latest()
    first.emit('exit', 1)
    first.emit('exit', 1)
    expect(utilityProcess.children).toHaveLength(2)
  })

  it('reconnects the recorder to the new worker', () => {
    const supervisor = create()
    const { contents, sent } = fakeRecorder()
    supervisor.start(init)
    supervisor.connectRecorder(contents)
    expect(sent).toHaveLength(1)
    latest().emit('exit', 1)
    expect(sent).toHaveLength(2)
    expect(sent[1]?.channel).toBe(Channels.recorderPort)
    expect(latest().messages.at(-1)?.ports).toHaveLength(1)
  })
})

describe('crash reporting', () => {
  it('reports every unexpected exit, even one it restarts from', () => {
    const crashes: number[] = []
    const supervisor = new SpeechSupervisor({
      onEvent: () => undefined,
      onGaveUp: () => undefined,
      onCrash: (code) => crashes.push(code)
    })
    supervisor.start(init)
    latest().emit('exit', 7)
    expect(crashes).toEqual([7])
  })

  it('sends what the worker prints to the log, since a crash explains itself only there', () => {
    create().start(init)
    latest().stderr.emit('data', Buffer.from('TypeError: something broke'))
    expect(JSON.stringify(fakeLog.messages('error'))).toContain('TypeError: something broke')
  })
})

describe('connecting the recorder', () => {
  it('gives one end of a port to each, so audio skips main', () => {
    const supervisor = create()
    const { contents, sent } = fakeRecorder()
    supervisor.start(init)
    supervisor.connectRecorder(contents)
    expect(sent[0]?.channel).toBe(Channels.recorderPort)
    expect(sent[0]?.ports).toHaveLength(1)
    const toWorker = latest().messages.at(-1)
    expect(toWorker?.ports).toHaveLength(1)
    expect(toWorker?.ports?.[0]).not.toBe(sent[0]?.ports[0])
  })
})

describe('restarting with a new model', () => {
  it('sends the new init to a new worker, and the old exit is not a crash', () => {
    const onCrash = vi.fn()
    const supervisor = new SpeechSupervisor({ onEvent: vi.fn(), onGaveUp: vi.fn(), onCrash })
    supervisor.start(init)
    const old = latest()
    const next = { ...init, modelId: 'moonshine-base-en' }
    supervisor.restart(next)
    expect(old.killed).toBe(true)
    expect(latest()).not.toBe(old)
    expect(latest().messages[0]?.message).toEqual(next)
    expect(onCrash).not.toHaveBeenCalled()
    expect(utilityProcess.children).toHaveLength(2)
  })
})

describe('stopping', () => {
  it('kills the worker, and a stop is not a crash', async () => {
    const supervisor = create()
    supervisor.start(init)
    const child = latest()
    await supervisor.stop()
    expect(child.killed).toBe(true)
    expect(utilityProcess.children).toHaveLength(1)
    expect(gaveUp).toBe(0)
    expect(fakeLog.messages('error')).toEqual([])
  })

  it('gives up waiting after 1 s', async () => {
    vi.useFakeTimers()
    const supervisor = create()
    supervisor.start(init)
    latest().exitsWhenKilled = false
    let finished = false
    void supervisor.stop().then(() => {
      finished = true
    })
    await vi.advanceTimersByTimeAsync(999)
    expect(finished).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(finished).toBe(true)
  })

  it('stops cleanly when it never started', async () => {
    await expect(create().stop()).resolves.toBeUndefined()
  })
})

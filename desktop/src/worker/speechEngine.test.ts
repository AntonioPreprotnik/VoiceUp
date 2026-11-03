import { beforeEach, describe, expect, it } from 'vitest'
import type { WorkerEvent, WorkerInit } from '../shared/worker'
import { SpeechEngine, type Recognizer, type SherpaApi, type Vad } from './speechEngine'

class FakeVad implements Vad {
  accepted = 0
  flushed = false
  segments: Float32Array[] = []
  detected = false

  acceptWaveform(): void {
    this.accepted++
  }

  isDetected(): boolean {
    return this.detected
  }

  isEmpty(): boolean {
    return this.segments.length === 0
  }

  /** Like the real one in Electron: the default call throws. */
  front(enableExternalBuffer?: boolean): { samples: Float32Array } {
    if (enableExternalBuffer !== false) throw new Error('External buffers are not allowed')
    const samples = this.segments.at(0)
    if (samples === undefined) throw new Error('front on an empty queue')
    return { samples }
  }

  pop(): void {
    this.segments.shift()
  }

  flush(): void {
    this.flushed = true
  }
}

const FRAME = new Float32Array(512).fill(0.5)
const SECOND_OF_SPEECH = new Float32Array(16000)

let events: WorkerEvent[]
let vads: FakeVad[]
let vadConfigs: unknown[]
let recognizerConfigs: unknown[]
let decode: (text?: string) => Promise<{ text: string }>
let loadFails: boolean
let clock: number

const fakeSherpa: SherpaApi = {
  createVad(config) {
    vadConfigs.push(config)
    const vad = new FakeVad()
    vads.push(vad)
    return vad
  },
  createRecognizer(config) {
    recognizerConfigs.push(config)
    if (loadFails) return Promise.reject(new Error('corrupt model'))
    const recognizer: Recognizer = {
      createStream: () => ({ acceptWaveform: () => undefined }),
      decodeAsync: () => decode()
    }
    return Promise.resolve(recognizer)
  }
}

const moonshine = {
  type: 'moonshine',
  preprocessor: 'p',
  encoder: 'e',
  uncachedDecoder: 'u',
  cachedDecoder: 'c',
  tokens: 't'
} as const

const init: WorkerInit = {
  type: 'init',
  modelId: 'moonshine-base-en',
  modelPaths: moonshine,
  sileroPath: 'silero.onnx',
  vad: { endSilenceSec: 1.2, minSpeechSec: 0.25, maxRecordingSec: 60, noSpeechTimeoutSec: 8 },
  numThreads: 4
}

function currentVad(): FakeVad {
  const vad = vads.at(-1)
  if (vad === undefined) throw new Error('No VAD was created')
  return vad
}

async function ready(config: WorkerInit = init): Promise<SpeechEngine> {
  const engine = new SpeechEngine(
    fakeSherpa,
    (event) => events.push(event),
    () => clock
  )
  await engine.initialize(config)
  events.length = 0
  return engine
}

const ofType = <T extends WorkerEvent['type']>(type: T): Extract<WorkerEvent, { type: T }>[] =>
  events.filter((event): event is Extract<WorkerEvent, { type: T }> => event.type === type)

const settled = (): Promise<void> => new Promise((resolve) => setImmediate(resolve))

beforeEach(() => {
  events = []
  vads = []
  vadConfigs = []
  recognizerConfigs = []
  decode = () => Promise.resolve({ text: ' run the tests ' })
  loadFails = false
  clock = 0
})

describe('initialize', () => {
  it('reports ready with the model and how long it took', async () => {
    const engine = new SpeechEngine(
      fakeSherpa,
      (event) => events.push(event),
      () => {
        clock += 100
        return clock
      }
    )
    await engine.initialize(init)
    expect(events).toEqual([{ type: 'ready', modelId: 'moonshine-base-en', loadMs: 100 }])
  })

  it('configures Moonshine and the thread count', async () => {
    await ready()
    expect(recognizerConfigs[0]).toMatchObject({
      featConfig: { sampleRate: 16000, featureDim: 80 },
      decodingMethod: 'greedy_search',
      modelConfig: {
        tokens: 't',
        numThreads: 4,
        provider: 'cpu',
        moonshine: { preprocessor: 'p', encoder: 'e', uncachedDecoder: 'u', cachedDecoder: 'c' }
      }
    })
  })

  it('configures Parakeet as a NeMo transducer', async () => {
    await ready({
      ...init,
      modelPaths: { type: 'nemo_transducer', encoder: 'e', decoder: 'd', joiner: 'j', tokens: 't' }
    })
    expect(recognizerConfigs[0]).toMatchObject({
      modelConfig: {
        modelType: 'nemo_transducer',
        transducer: { encoder: 'e', decoder: 'd', joiner: 'j' }
      }
    })
  })

  it('is ready with no model when none is downloaded yet', async () => {
    const engine = new SpeechEngine(fakeSherpa, (event) => events.push(event))
    await engine.initialize({ ...init, modelId: null, modelPaths: null })
    expect(recognizerConfigs).toEqual([])
    expect(events[0]).toMatchObject({ type: 'ready', modelId: null })
  })

  it('reports a failed load, and is still ready for VAD', async () => {
    loadFails = true
    const engine = new SpeechEngine(fakeSherpa, (event) => events.push(event))
    await engine.initialize(init)
    expect(events[0]).toMatchObject({
      type: 'error',
      code: 'WORKER_ERROR',
      message: 'corrupt model'
    })
    expect(events[1]).toMatchObject({ type: 'ready', modelId: null })
  })
})

describe('a recording', () => {
  it('configures the VAD from the settings', async () => {
    const engine = await ready()
    engine.start('r1')
    expect(vadConfigs[0]).toMatchObject({
      sileroVad: {
        model: 'silero.onnx',
        threshold: 0.5,
        windowSize: 512,
        minSilenceDuration: 1.2,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 60
      },
      sampleRate: 16000
    })
  })

  it('uses a new VAD each time', async () => {
    const engine = await ready()
    engine.start('r1')
    engine.start('r2')
    expect(vads).toHaveLength(2)
  })

  it('reports speech starting, once', async () => {
    const engine = await ready()
    engine.start('r1')
    engine.frame(FRAME)
    expect(ofType('speechStart')).toEqual([])
    currentVad().detected = true
    engine.frame(FRAME)
    engine.frame(FRAME)
    expect(ofType('speechStart')).toEqual([{ type: 'speechStart', recordingId: 'r1' }])
  })

  it('reports levels at no more than 20 per second', async () => {
    const engine = await ready()
    engine.start('r1')
    const framesInOneSecond = Math.ceil(16000 / 512)
    for (let i = 0; i < framesInOneSecond; i++) engine.frame(FRAME)
    const levels = ofType('level')
    expect(levels.length).toBeLessThanOrEqual(20)
    expect(levels.length).toBeGreaterThan(0)
    expect(levels[0]?.rms).toBeCloseTo(0.5)
  })

  it('ends speech and reports the transcript when the VAD finishes a segment', async () => {
    const engine = await ready()
    engine.start('r1')
    currentVad().segments.push(SECOND_OF_SPEECH)
    engine.frame(FRAME)
    await settled()
    expect(ofType('speechEnd')).toEqual([
      { type: 'speechEnd', recordingId: 'r1', durationMs: 1000 }
    ])
    expect(ofType('transcript')).toEqual([
      { type: 'transcript', recordingId: 'r1', text: 'run the tests', decodeMs: 0 }
    ])
  })

  it('ignores frames after the recording has ended', async () => {
    const engine = await ready()
    engine.start('r1')
    const vad = currentVad()
    vad.segments.push(SECOND_OF_SPEECH)
    engine.frame(FRAME)
    const accepted = vad.accepted
    engine.frame(FRAME)
    expect(vad.accepted).toBe(accepted)
  })

  it('ignores frames before any recording', async () => {
    const engine = await ready()
    engine.frame(FRAME)
    expect(events).toEqual([])
  })

  it('rejects a frame of the wrong size', async () => {
    const engine = await ready()
    engine.start('r1')
    engine.frame(new Float32Array(10))
    expect(events[0]).toMatchObject({ type: 'error', code: 'WORKER_ERROR', recordingId: 'r1' })
  })

  it('reports no speech once the timeout passes', async () => {
    const engine = await ready()
    engine.start('r1')
    const framesInTimeout = Math.ceil((8 * 16000) / 512)
    for (let i = 0; i < framesInTimeout; i++) engine.frame(FRAME)
    expect(ofType('error')).toEqual([])
    engine.frame(FRAME)
    expect(ofType('error')).toEqual([
      { type: 'error', recordingId: 'r1', code: 'NO_SPEECH', message: 'No speech detected' }
    ])
  })

  it('does not time out once speech has started', async () => {
    const engine = await ready()
    engine.start('r1')
    currentVad().detected = true
    for (let i = 0; i < 300; i++) engine.frame(FRAME)
    expect(ofType('error')).toEqual([])
  })

  it('still times out after a click or cough that the VAD rejects as too short', async () => {
    const engine = await ready()
    engine.start('r1')
    currentVad().detected = true
    engine.frame(FRAME)
    expect(ofType('speechStart')).toHaveLength(1)
    currentVad().detected = false
    const framesInTimeout = Math.ceil((8 * 16000) / 512)
    for (let i = 0; i < framesInTimeout; i++) engine.frame(FRAME)
    expect(ofType('error')).toEqual([])
    engine.frame(FRAME)
    expect(ofType('error')[0]).toMatchObject({ code: 'NO_SPEECH', recordingId: 'r1' })
  })

  it('counts the timeout from the last speech heard, not from the start', async () => {
    const engine = await ready()
    engine.start('r1')
    const framesInTimeout = Math.ceil((8 * 16000) / 512)
    for (let i = 0; i < framesInTimeout - 5; i++) engine.frame(FRAME)
    currentVad().detected = true
    engine.frame(FRAME)
    currentVad().detected = false
    for (let i = 0; i < framesInTimeout; i++) engine.frame(FRAME)
    expect(ofType('error')).toEqual([])
  })

  it('reports a missing model once speech ends', async () => {
    const engine = await ready({ ...init, modelId: null, modelPaths: null })
    engine.start('r1')
    currentVad().segments.push(SECOND_OF_SPEECH)
    engine.frame(FRAME)
    await settled()
    expect(ofType('error')[0]).toMatchObject({ code: 'MODEL_MISSING', recordingId: 'r1' })
  })

  it('reports a failed decode', async () => {
    decode = () => Promise.reject(new Error('decode failed'))
    const engine = await ready()
    engine.start('r1')
    currentVad().segments.push(SECOND_OF_SPEECH)
    engine.frame(FRAME)
    await settled()
    expect(ofType('error')[0]).toMatchObject({
      code: 'WORKER_ERROR',
      recordingId: 'r1',
      message: 'decode failed'
    })
  })

  it('reports an error before init rather than crashing', () => {
    const engine = new SpeechEngine(fakeSherpa, (event) => events.push(event))
    engine.start('r1')
    expect(events[0]).toMatchObject({ type: 'error', code: 'WORKER_ERROR', recordingId: 'r1' })
  })

  it('reports an external-buffer error from the VAD, not a crash', async () => {
    const engine = await ready()
    engine.start('r1')
    const vad = currentVad()
    vad.acceptWaveform = () => {
      throw new Error('External buffers are not allowed')
    }
    engine.frame(FRAME)
    expect(events[0]).toMatchObject({
      type: 'error',
      message: 'External buffers are not allowed'
    })
  })
})

describe('stop', () => {
  it('flushes the VAD and transcribes what was said', async () => {
    const engine = await ready()
    engine.start('r1')
    const vad = currentVad()
    vad.flush = () => {
      vad.flushed = true
      vad.segments.push(SECOND_OF_SPEECH)
    }
    engine.stop('r1')
    await settled()
    expect(vad.flushed).toBe(true)
    expect(ofType('transcript')).toHaveLength(1)
  })

  it('reports no speech when nothing was said', async () => {
    const engine = await ready()
    engine.start('r1')
    engine.stop('r1')
    expect(ofType('error')[0]).toMatchObject({ code: 'NO_SPEECH' })
  })

  it('ignores a stop for a different recording', async () => {
    const engine = await ready()
    engine.start('r2')
    engine.stop('r1')
    expect(currentVad().flushed).toBe(false)
    expect(events).toEqual([])
  })
})

describe('cancel', () => {
  it('drops a recording in progress', async () => {
    const engine = await ready()
    engine.start('r1')
    const vad = currentVad()
    engine.cancel('r1')
    engine.frame(FRAME)
    expect(vad.accepted).toBe(0)
    expect(events).toEqual([])
  })

  it('drops the transcript of a recording already being decoded', async () => {
    let finishDecode: (result: { text: string }) => void = () => undefined
    decode = () =>
      new Promise((resolve) => {
        finishDecode = resolve
      })
    const engine = await ready()
    engine.start('r1')
    currentVad().segments.push(SECOND_OF_SPEECH)
    engine.frame(FRAME)
    engine.cancel('r1')
    finishDecode({ text: 'too late' })
    await settled()
    expect(ofType('transcript')).toEqual([])
  })
})

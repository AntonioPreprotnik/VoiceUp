import { FRAME_SAMPLES, SAMPLE_RATE } from '../shared/worker'
import type { ModelPaths, WorkerEvent, WorkerInit } from '../shared/worker'

// The parts of sherpa-onnx-node this uses. Taking them as an argument keeps the logic testable
// without the addon, and the fake can enforce Electron's external-buffer rule.

export interface Vad {
  acceptWaveform(samples: Float32Array): void
  isDetected(): boolean
  isEmpty(): boolean
  /** Electron forbids external buffers, so this must always be called with false. */
  front(enableExternalBuffer: false): { samples: Float32Array }
  pop(): void
  flush(): void
}

interface RecognizerStream {
  acceptWaveform(wave: { sampleRate: number; samples: Float32Array }): void
}

export interface Recognizer {
  createStream(): RecognizerStream
  decodeAsync(stream: RecognizerStream): Promise<{ text: string }>
}

export interface SherpaApi {
  createVad(config: unknown, bufferSeconds: number): Vad
  createRecognizer(config: unknown): Promise<Recognizer>
}

export type Emit = (event: WorkerEvent) => void

// Every second frame is 15.6 per second, under the limit of 20 in TECH_SPEC §6.2.
const FRAMES_PER_LEVEL = 2
const SILERO_THRESHOLD = 0.5

function modelConfig(paths: ModelPaths, numThreads: number): unknown {
  const shared = { tokens: paths.tokens, numThreads, provider: 'cpu', debug: false }
  if (paths.type === 'moonshine') {
    const { preprocessor, encoder, uncachedDecoder, cachedDecoder } = paths
    return { ...shared, moonshine: { preprocessor, encoder, uncachedDecoder, cachedDecoder } }
  }
  const { encoder, decoder, joiner } = paths
  return { ...shared, transducer: { encoder, decoder, joiner }, modelType: 'nemo_transducer' }
}

function rms(samples: Float32Array): number {
  let sum = 0
  for (const sample of samples) sum += sample * sample
  return Math.sqrt(sum / samples.length)
}

interface Recording {
  readonly id: string
  readonly vad: Vad
  frames: number
  speechStarted: boolean
}

/** One recording at a time: VAD on incoming frames, then recognition of the first segment. */
export class SpeechEngine {
  private init: WorkerInit | undefined
  private recognizer: Recognizer | undefined
  private recording: Recording | undefined
  private readonly cancelled = new Set<string>()

  constructor(
    private readonly sherpa: SherpaApi,
    private readonly emit: Emit,
    private readonly now: () => number = () => performance.now()
  ) {}

  /** Keeps working on a failed model load, so the user gets MODEL_MISSING and not silence. */
  async initialize(init: WorkerInit): Promise<void> {
    this.init = init
    const started = this.now()
    if (init.modelPaths !== null) {
      try {
        this.recognizer = await this.sherpa.createRecognizer({
          featConfig: { sampleRate: SAMPLE_RATE, featureDim: 80 },
          modelConfig: modelConfig(init.modelPaths, init.numThreads),
          decodingMethod: 'greedy_search'
        })
      } catch (error: unknown) {
        this.reportError(undefined, 'WORKER_ERROR', error)
      }
    }
    this.emit({
      type: 'ready',
      modelId: this.recognizer === undefined ? null : init.modelId,
      loadMs: Math.round(this.now() - started)
    })
  }

  /** A new VAD per recording, so nothing from the last one can leak into this one. */
  start(recordingId: string): void {
    if (this.init === undefined) {
      this.reportError(recordingId, 'WORKER_ERROR', new Error('start before init'))
      return
    }
    const { sileroPath, vad } = this.init
    this.recording = {
      id: recordingId,
      frames: 0,
      speechStarted: false,
      vad: this.sherpa.createVad(
        {
          sileroVad: {
            model: sileroPath,
            threshold: SILERO_THRESHOLD,
            windowSize: FRAME_SAMPLES,
            minSilenceDuration: vad.endSilenceSec,
            minSpeechDuration: vad.minSpeechSec,
            maxSpeechDuration: vad.maxRecordingSec
          },
          sampleRate: SAMPLE_RATE,
          numThreads: 1,
          provider: 'cpu',
          debug: false
        },
        vad.maxRecordingSec + 10 // the buffer must exceed the longest recording
      )
    }
  }

  frame(samples: Float32Array): void {
    const { recording, init } = this
    if (recording === undefined || init === undefined) return
    try {
      if (samples.length !== FRAME_SAMPLES) throw new Error(`bad frame: ${String(samples.length)}`)
      recording.vad.acceptWaveform(samples)
      recording.frames++
      if (recording.frames % FRAMES_PER_LEVEL === 0) {
        this.emit({ type: 'level', recordingId: recording.id, rms: rms(samples) })
      }
      if (!recording.speechStarted && recording.vad.isDetected()) {
        recording.speechStarted = true
        this.emit({ type: 'speechStart', recordingId: recording.id })
      }
      if (!recording.vad.isEmpty()) {
        this.finishWithSegment(recording)
      } else if (!recording.speechStarted && this.timedOut(recording, init)) {
        this.endWithNoSpeech(recording)
      }
    } catch (error: unknown) {
      this.recording = undefined
      this.reportError(recording.id, 'WORKER_ERROR', error)
    }
  }

  /** The user ended it: whatever was said so far counts. */
  stop(recordingId: string): void {
    const { recording } = this
    if (recording?.id !== recordingId) return
    try {
      recording.vad.flush()
      if (recording.vad.isEmpty()) this.endWithNoSpeech(recording)
      else this.finishWithSegment(recording)
    } catch (error: unknown) {
      this.recording = undefined
      this.reportError(recordingId, 'WORKER_ERROR', error)
    }
  }

  /** Drops the recording, including one that is already being transcribed. */
  cancel(recordingId: string): void {
    if (this.recording?.id === recordingId) this.recording = undefined
    else this.cancelled.add(recordingId)
  }

  private timedOut(recording: Recording, init: WorkerInit): boolean {
    const seconds = (recording.frames * FRAME_SAMPLES) / SAMPLE_RATE
    return seconds > init.vad.noSpeechTimeoutSec
  }

  private endWithNoSpeech(recording: Recording): void {
    this.recording = undefined
    this.emit({
      type: 'error',
      recordingId: recording.id,
      code: 'NO_SPEECH',
      message: 'No speech detected'
    })
  }

  private finishWithSegment(recording: Recording): void {
    this.recording = undefined
    const { samples } = recording.vad.front(false)
    const durationMs = Math.round((samples.length / SAMPLE_RATE) * 1000)
    this.emit({ type: 'speechEnd', recordingId: recording.id, durationMs })

    this.decode(recording.id, samples).catch((error: unknown) => {
      this.reportError(recording.id, 'WORKER_ERROR', error)
    })
  }

  private async decode(recordingId: string, samples: Float32Array): Promise<void> {
    if (this.recognizer === undefined) {
      this.emit({
        type: 'error',
        recordingId,
        code: 'MODEL_MISSING',
        message: 'No speech model is loaded'
      })
      return
    }
    const stream = this.recognizer.createStream()
    stream.acceptWaveform({ sampleRate: SAMPLE_RATE, samples })
    const started = this.now()
    const { text } = await this.recognizer.decodeAsync(stream)
    if (this.cancelled.delete(recordingId)) return
    this.emit({
      type: 'transcript',
      recordingId,
      text: text.trim(),
      decodeMs: Math.round(this.now() - started)
    })
  }

  private reportError(recordingId: string | undefined, code: 'WORKER_ERROR', error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    this.emit({
      type: 'error',
      ...(recordingId === undefined ? {} : { recordingId }),
      code,
      message
    })
  }
}

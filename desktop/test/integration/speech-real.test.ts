import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { WorkerEvent } from '../../src/shared/worker'
import {
  SpeechEngine,
  type SherpaApi,
  type Vad,
  type Recognizer
} from '../../src/worker/speechEngine'

// Runs the real engine with the real addon and model on a real recording, when a developer has them:
//   VOICEUP_TEST_MODELS=<folder> VOICEUP_TEST_RECORDINGS=<folder> npm test
// CI has neither, so it skips this. Recordings stay out of the repo.
const modelsDir = process.env['VOICEUP_TEST_MODELS']
const recordingsDir = process.env['VOICEUP_TEST_RECORDINGS']

interface Sherpa {
  Vad: new (config: unknown, bufferSeconds: number) => Vad
  OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> }
  readWave(path: string, enableExternalBuffer: false): { samples: Float32Array }
}

interface Clip {
  file: string
  reference: string
}

const SAMPLE_RATE = 16000
const FRAME_SAMPLES = 512

async function loadEngine(
  models: string
): Promise<{ sherpa: Sherpa; engine: SpeechEngine; events: WorkerEvent[] }> {
  const sherpa = createRequire(import.meta.url)('sherpa-onnx-node') as Sherpa
  const api: SherpaApi = {
    createVad: (config, seconds) => new sherpa.Vad(config, seconds),
    createRecognizer: (config) => sherpa.OfflineRecognizer.createAsync(config)
  }
  const dir = join(models, 'sherpa-onnx-moonshine-base-en-int8')
  const events: WorkerEvent[] = []
  const engine = new SpeechEngine(api, (event) => events.push(event))
  await engine.initialize({
    type: 'init',
    modelId: 'moonshine-base-en',
    modelPaths: {
      type: 'moonshine',
      preprocessor: join(dir, 'preprocess.onnx'),
      encoder: join(dir, 'encode.int8.onnx'),
      uncachedDecoder: join(dir, 'uncached_decode.int8.onnx'),
      cachedDecoder: join(dir, 'cached_decode.int8.onnx'),
      tokens: join(dir, 'tokens.txt')
    },
    sileroPath: join(models, 'silero_vad.onnx'),
    vad: { endSilenceSec: 1.2, minSpeechSec: 0.25, maxRecordingSec: 60, noSpeechTimeoutSec: 8 },
    numThreads: 4
  })
  expect(events.at(-1)).toMatchObject({ type: 'ready', modelId: 'moonshine-base-en' })
  return { sherpa, engine, events }
}

/** Trailing silence, as after real speech, so the VAD ends the segment by itself. */
function sendFrames(engine: SpeechEngine, samples: Float32Array): void {
  const withSilence = new Float32Array(samples.length + SAMPLE_RATE * 2)
  withSilence.set(samples)
  for (let at = 0; at + FRAME_SAMPLES <= withSilence.length; at += FRAME_SAMPLES) {
    engine.frame(withSilence.slice(at, at + FRAME_SAMPLES))
  }
}

function clipsIn(recordings: string): Clip[] {
  return readFileSync(join(recordings, 'live-results.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .map((line) => JSON.parse(line) as Clip)
}

describe.skipIf(modelsDir === undefined || recordingsDir === undefined)('the real engine', () => {
  it('transcribes a recording through VAD and Moonshine, frame by frame', async () => {
    if (modelsDir === undefined || recordingsDir === undefined) return
    const { sherpa, engine, events } = await loadEngine(modelsDir)
    const clip = clipsIn(recordingsDir).find(({ file }) => file === 'command-05.wav')
    if (clip === undefined) throw new Error('No command-05.wav in the recordings')

    const { samples } = sherpa.readWave(join(recordingsDir, clip.file), false)
    engine.start('real')
    sendFrames(engine, samples)

    await expect
      .poll(() => events.find((event) => event.type === 'transcript'), { timeout: 20000 })
      .toBeDefined()
    expect(events.map((event) => event.type)).toContain('speechStart')
    expect(events.map((event) => event.type)).toContain('speechEnd')
    expect(events.map((event) => event.type)).not.toContain('error')
    const transcript = events.find((event) => event.type === 'transcript')
    expect(transcript?.text.toLowerCase()).toContain('function')
  }, 60000)

  // A real 11 s sentence once came back empty, and the recordings only go up to 4 s. Stitched
  // commands, with pauses shorter than the end-of-speech silence, stay one segment.
  it('keeps every part of a long recording, through the VAD, as one segment', async () => {
    if (modelsDir === undefined || recordingsDir === undefined) return
    const { sherpa, engine, events } = await loadEngine(modelsDir)
    const pause = new Float32Array(SAMPLE_RATE * 0.4)
    const parts = clipsIn(recordingsDir)
      .slice(13, 18)
      .flatMap(({ file }) => [sherpa.readWave(join(recordingsDir, file), false).samples, pause])
    const samples = new Float32Array(parts.reduce((sum, part) => sum + part.length, 0))
    let at = 0
    for (const part of parts) {
      samples.set(part, at)
      at += part.length
    }
    expect(samples.length / SAMPLE_RATE).toBeGreaterThan(11)

    engine.start('long')
    sendFrames(engine, samples)

    await expect
      .poll(() => events.find((event) => event.type === 'transcript'), { timeout: 20000 })
      .toBeDefined()
    const ended = events.filter((event) => event.type === 'speechEnd')
    expect(ended).toHaveLength(1)
    expect(ended[0]?.durationMs).toBeGreaterThan(10000)
    const transcript = events.find((event) => event.type === 'transcript')
    expect(transcript?.text.split(/\s+/).length).toBeGreaterThan(15)
  }, 60000)
})

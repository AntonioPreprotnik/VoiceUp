// Speech benchmark: word error rate and decode time per model over a folder of recordings.
// Usage: npm run bench:speech -- <recordings folder> <models folder>
// The recordings folder holds WAVs and a live-results.jsonl with { file, reference } per line. It
// stays out of the repo unless the speaker agrees. Not part of CI, which has no models or voices.
import console from 'node:console'
import { existsSync, readFileSync } from 'node:fs'
import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { performance } from 'node:perf_hooks'
import process from 'node:process'
import { createRequire } from 'node:module'
import { wordErrors } from './wer.mjs'

const sherpa = createRequire(import.meta.url)('sherpa-onnx-node')
const [recordingsDir, modelsDir] = process.argv.slice(2)
if (recordingsDir === undefined || modelsDir === undefined) {
  console.error('Usage: npm run bench:speech -- <recordings folder> <models folder>')
  process.exit(2)
}

const threads = Math.max(1, Math.min(4, availableParallelism() - 1))
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]

const MODELS = [
  {
    id: 'parakeet-tdt-0.6b-v2-int8',
    folder: 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
    config: (dir) => ({
      transducer: {
        encoder: join(dir, 'encoder.int8.onnx'),
        decoder: join(dir, 'decoder.int8.onnx'),
        joiner: join(dir, 'joiner.int8.onnx')
      },
      tokens: join(dir, 'tokens.txt'),
      modelType: 'nemo_transducer'
    })
  },
  {
    id: 'moonshine-base-en',
    folder: 'sherpa-onnx-moonshine-base-en-int8',
    config: (dir) => ({
      moonshine: {
        preprocessor: join(dir, 'preprocess.onnx'),
        encoder: join(dir, 'encode.int8.onnx'),
        uncachedDecoder: join(dir, 'uncached_decode.int8.onnx'),
        cachedDecoder: join(dir, 'cached_decode.int8.onnx')
      },
      tokens: join(dir, 'tokens.txt')
    })
  },
  {
    id: 'whisper-base.en',
    folder: 'sherpa-onnx-whisper-base.en',
    config: (dir) => ({
      whisper: {
        encoder: join(dir, 'base.en-encoder.int8.onnx'),
        decoder: join(dir, 'base.en-decoder.int8.onnx'),
        language: 'en',
        task: 'transcribe'
      },
      tokens: join(dir, 'base.en-tokens.txt')
    })
  }
]

// A redone command appears twice in the file. The last line is the take on disk.
const clips = new Map()
for (const line of readFileSync(join(recordingsDir, 'live-results.jsonl'), 'utf8').split('\n')) {
  if (line.trim() !== '') {
    const clip = JSON.parse(line)
    clips.set(clip.file, clip)
  }
}

async function benchmark(model) {
  const dir = join(modelsDir, model.folder)
  if (!existsSync(dir)) return { id: model.id, skipped: `no folder ${model.folder}` }

  const loadStarted = performance.now()
  const recognizer = await sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { ...model.config(dir), numThreads: threads, provider: 'cpu', debug: false },
    decodingMethod: 'greedy_search'
  })
  const loadMs = performance.now() - loadStarted

  const decodes = []
  const rtfs = []
  const misses = []
  let errors = 0
  let words = 0
  for (const { file, reference } of clips.values()) {
    // false = copy: Electron forbids external buffers, so the tooling uses the same call.
    const wave = sherpa.readWave(join(recordingsDir, file), false)
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
    const started = performance.now()
    const { text } = await recognizer.decodeAsync(stream)
    const ms = performance.now() - started
    decodes.push(ms)
    rtfs.push(ms / 1000 / (wave.samples.length / wave.sampleRate))
    const clip = wordErrors(reference, text)
    errors += clip.errors
    words += clip.words
    if (clip.errors > 0) misses.push({ file, reference, heard: text.trim() })
  }
  return {
    id: model.id,
    clips: clips.size,
    wer: `${((errors / words) * 100).toFixed(1)}%`,
    errors: `${errors} of ${words} words`,
    loadMs: Math.round(loadMs),
    medianDecodeMs: Math.round(median(decodes)),
    worstDecodeMs: Math.round(Math.max(...decodes)),
    medianRtf: Math.round(median(rtfs) * 1000) / 1000,
    misses
  }
}

for (const model of MODELS) {
  const result = await benchmark(model)
  const { misses, ...summary } = result
  console.log(JSON.stringify(summary))
  for (const miss of misses ?? []) {
    console.log(`  ${miss.file}: "${miss.reference}" -> "${miss.heard}"`)
  }
}

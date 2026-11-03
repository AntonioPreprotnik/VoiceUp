// S4.1 throwaway: runs in an Electron utilityProcess. Checks the external-buffer rule, VAD and each
// recognizer on the test clips that ship inside the model archives.
const { existsSync, readdirSync } = require('node:fs')
const { availableParallelism } = require('node:os')
const { join } = require('node:path')

const modelsDir = process.argv[process.argv.length - 1]
const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]
const round = (value) => Math.round(value * 1000) / 1000
const threads = Math.max(1, Math.min(4, availableParallelism() - 1))

const MODELS = {
  'parakeet-tdt-0.6b-v2-int8': (dir) => ({
    transducer: {
      encoder: join(dir, 'encoder.int8.onnx'),
      decoder: join(dir, 'decoder.int8.onnx'),
      joiner: join(dir, 'joiner.int8.onnx')
    },
    tokens: join(dir, 'tokens.txt'),
    modelType: 'nemo_transducer'
  }),
  'moonshine-base-en': (dir) => ({
    moonshine: {
      preprocessor: join(dir, 'preprocess.onnx'),
      encoder: join(dir, 'encode.int8.onnx'),
      uncachedDecoder: join(dir, 'uncached_decode.int8.onnx'),
      cachedDecoder: join(dir, 'cached_decode.int8.onnx')
    },
    tokens: join(dir, 'tokens.txt')
  }),
  'whisper-base.en': (dir) => ({
    whisper: {
      encoder: join(dir, 'base.en-encoder.int8.onnx'),
      decoder: join(dir, 'base.en-decoder.int8.onnx'),
      language: 'en',
      task: 'transcribe'
    },
    tokens: join(dir, 'base.en-tokens.txt')
  })
}

const FOLDERS = {
  'parakeet-tdt-0.6b-v2-int8': 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8',
  'moonshine-base-en': 'sherpa-onnx-moonshine-base-en-int8',
  'whisper-base.en': 'sherpa-onnx-whisper-base.en'
}

function outcome(action) {
  try {
    action()
    return 'no error'
  } catch (error) {
    return String(error.message ?? error).slice(0, 80)
  }
}

async function benchmark(sherpa, id, clipPath) {
  const dir = join(modelsDir, FOLDERS[id])
  if (!existsSync(dir)) return { skipped: `no folder ${FOLDERS[id]}` }

  const config = {
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: { ...MODELS[id](dir), numThreads: threads, provider: 'cpu', debug: false },
    decodingMethod: 'greedy_search'
  }
  let started = performance.now()
  const recognizer = await sherpa.OfflineRecognizer.createAsync(config)
  const loadMs = performance.now() - started

  const wave = sherpa.readWave(clipPath, false)
  const clipSeconds = wave.samples.length / wave.sampleRate
  const decodes = []
  let text = ''
  for (let run = 0; run < 5; run++) {
    const stream = recognizer.createStream()
    stream.acceptWaveform({ sampleRate: wave.sampleRate, samples: wave.samples })
    started = performance.now()
    text = (await recognizer.decodeAsync(stream)).text
    decodes.push(performance.now() - started)
  }
  return {
    loadMs: Math.round(loadMs),
    clipSeconds: round(clipSeconds),
    medianDecodeMs: Math.round(median(decodes)),
    rtf: round(median(decodes) / 1000 / clipSeconds),
    rssMb: Math.round(process.memoryUsage().rss / 1048576),
    text: text.trim()
  }
}

async function run() {
  const result = { threads, electron: process.versions.electron }
  const sherpa = require('sherpa-onnx-node')
  result.load = 'ok'

  const sileroPath = join(modelsDir, 'silero_vad.onnx')
  const clipDir = join(modelsDir, FOLDERS['moonshine-base-en'], 'test_wavs')
  const clipPath = join(clipDir, readdirSync(clipDir).find((name) => name.endsWith('.wav')))

  // The rule from TECH_SPEC 5.3: the default variants must throw here, and the copying ones work.
  result.externalBuffers = {
    'readWave(path)': outcome(() => sherpa.readWave(clipPath)),
    'readWave(path, false)': outcome(() => sherpa.readWave(clipPath, false))
  }

  const wave = sherpa.readWave(clipPath, false)
  const vad = new sherpa.Vad(
    {
      sileroVad: {
        model: sileroPath,
        threshold: 0.5,
        windowSize: 512,
        minSilenceDuration: 1.2,
        minSpeechDuration: 0.25,
        maxSpeechDuration: 60
      },
      sampleRate: 16000,
      numThreads: 1,
      provider: 'cpu',
      debug: false
    },
    70
  )
  // Trailing silence is what makes the VAD end the segment, as it does after real speech.
  const samples = new Float32Array(wave.samples.length + 16000 * 2)
  samples.set(wave.samples)
  let detected = false
  let frames = 0
  const started = performance.now()
  for (let offset = 0; offset + 512 <= samples.length; offset += 512) {
    vad.acceptWaveform(samples.subarray(offset, offset + 512))
    frames++
    detected = detected || vad.isDetected()
  }
  const segments = []
  result.externalBuffers['vad.front()'] = vad.isEmpty()
    ? 'no segment to test'
    : outcome(() => vad.front())
  while (!vad.isEmpty()) {
    segments.push(vad.front(false).samples.length / 16000)
    vad.pop()
  }
  result.vad = {
    detected,
    frames,
    segmentsSeconds: segments.map(round),
    usPerFrame: Math.round(((performance.now() - started) * 1000) / frames)
  }

  result.models = {}
  for (const id of Object.keys(MODELS)) {
    try {
      result.models[id] = await benchmark(sherpa, id, clipPath)
    } catch (error) {
      result.models[id] = { failed: String(error.message ?? error).slice(0, 160) }
    }
  }
  return result
}

run()
  .then((result) => process.parentPort.postMessage(result))
  .catch((error) =>
    process.parentPort.postMessage({ failed: String(error.stack ?? error).slice(0, 400) })
  )

// S4.1 throwaway: runs in an Electron utilityProcess. Silero VAD and Parakeet on live mic frames.
// Saves each recognized clip as a WAV with its reference text, for the benchmark. Spike only:
// production audio is never written to disk.
const { appendFileSync, mkdirSync, writeFileSync } = require('node:fs')
const { availableParallelism } = require('node:os')
const { join } = require('node:path')

const [modelsDir, outDir] = process.argv.slice(-2)
const sherpa = require('sherpa-onnx-node')
const dir = join(modelsDir, 'sherpa-onnx-nemo-parakeet-tdt-0.6b-v2-int8')
const NO_SPEECH_FRAMES = Math.ceil((8 * 16000) / 512)

mkdirSync(outDir, { recursive: true })

function wavBytes(samples) {
  const data = Buffer.alloc(samples.length * 2)
  samples.forEach((sample, i) => {
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2)
  })
  const header = Buffer.alloc(44)
  header.write('RIFF', 0)
  header.writeUInt32LE(36 + data.length, 4)
  header.write('WAVEfmt ', 8)
  header.writeUInt32LE(16, 16)
  header.writeUInt16LE(1, 20)
  header.writeUInt16LE(1, 22)
  header.writeUInt32LE(16000, 24)
  header.writeUInt32LE(32000, 28)
  header.writeUInt16LE(2, 32)
  header.writeUInt16LE(16, 34)
  header.write('data', 36)
  header.writeUInt32LE(data.length, 40)
  return Buffer.concat([header, data])
}

function createVad() {
  return new sherpa.Vad(
    {
      sileroVad: {
        model: join(modelsDir, 'silero_vad.onnx'),
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
}

let recognizer = null
let loadMs = 0
let port = null
let current = null
let vad = null
let frames = 0
let started = false
let framesSeen = 0

async function finish(samples) {
  const recording = current
  current = null
  port.postMessage({ type: 'speechEnd' })
  const stream = recognizer.createStream()
  stream.acceptWaveform({ sampleRate: 16000, samples })
  const begin = performance.now()
  const { text } = await recognizer.decodeAsync(stream)
  const decodeMs = Math.round(performance.now() - begin)
  const name = `command-${String(recording.index + 1).padStart(2, '0')}.wav`
  writeFileSync(join(outDir, name), wavBytes(samples))
  appendFileSync(
    join(outDir, 'live-results.jsonl'),
    `${JSON.stringify({
      file: name,
      reference: recording.text,
      heard: text.trim(),
      seconds: samples.length / 16000,
      decodeMs,
      framesSeen
    })}\n`
  )
  port.postMessage({ type: 'transcript', text: text.trim(), decodeMs })
}

function onMessage({ data }) {
  if (data.type === 'hello') {
    // Only a loaded engine is ready: the page keeps Record disabled until it hears this.
    if (recognizer !== null) port.postMessage({ type: 'ready', loadMs })
  } else if (data.type === 'start') {
    current = { index: data.index, text: data.text }
    vad = createVad()
    frames = 0
    started = false
    framesSeen = 0
  } else if (data.type === 'frame' && current !== null) {
    frames++
    framesSeen++
    vad.acceptWaveform(data.samples)
    if (vad.isDetected() && !started) {
      started = true
      port.postMessage({ type: 'speechStart' })
    }
    if (!vad.isEmpty()) {
      const segment = vad.front(false) // false = copy: Electron forbids external buffers
      vad.pop()
      finish(segment.samples).catch((error) => {
        port.postMessage({ type: 'error', message: String(error.message ?? error) })
      })
    } else if (!started && frames > NO_SPEECH_FRAMES) {
      current = null
      port.postMessage({ type: 'noSpeech' })
    }
  }
}

process.parentPort.on('message', (event) => {
  port = event.ports[0]
  port.on('message', (message) => {
    try {
      onMessage(message)
    } catch (error) {
      port.postMessage({ type: 'error', message: String(error.message ?? error) })
    }
  })
  port.start()
  const loadStarted = performance.now()
  sherpa.OfflineRecognizer.createAsync({
    featConfig: { sampleRate: 16000, featureDim: 80 },
    modelConfig: {
      transducer: {
        encoder: join(dir, 'encoder.int8.onnx'),
        decoder: join(dir, 'decoder.int8.onnx'),
        joiner: join(dir, 'joiner.int8.onnx')
      },
      tokens: join(dir, 'tokens.txt'),
      modelType: 'nemo_transducer',
      numThreads: Math.max(1, Math.min(4, availableParallelism() - 1)),
      provider: 'cpu',
      debug: false
    },
    decodingMethod: 'greedy_search'
  })
    .then((created) => {
      recognizer = created
      loadMs = Math.round(performance.now() - loadStarted)
      port.postMessage({ type: 'ready', loadMs })
    })
    .catch((error) => {
      port.postMessage({ type: 'error', message: String(error.message ?? error) })
    })
})

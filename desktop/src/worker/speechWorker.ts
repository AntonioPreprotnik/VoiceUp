import { WorkerCommand } from '../shared/worker'
import addon from 'sherpa-onnx-node'
import { SpeechEngine, type Recognizer, type SherpaApi, type Vad } from './speechEngine'

// The entry point of the speech utilityProcess. Only this process ever loads the addon.

// The addon has no types, so this is the one place its shape is stated.
const sherpa = addon as {
  Vad: new (config: unknown, bufferSeconds: number) => Vad
  OfflineRecognizer: { createAsync(config: unknown): Promise<Recognizer> }
}

const api: SherpaApi = {
  createVad: (config, bufferSeconds) => new sherpa.Vad(config, bufferSeconds),
  createRecognizer: (config) => sherpa.OfflineRecognizer.createAsync(config)
}

const { parentPort } = process
const engine = new SpeechEngine(api, (event) => {
  parentPort.postMessage(event)
})

function handle(raw: unknown): void {
  const parsed = WorkerCommand.safeParse(raw)
  if (!parsed.success) {
    parentPort.postMessage({
      type: 'error',
      code: 'WORKER_ERROR',
      message: 'Dropped an invalid command'
    })
    return
  }
  const command = parsed.data
  switch (command.type) {
    case 'init':
      void engine.initialize(command)
      break
    case 'start':
      engine.start(command.recordingId)
      break
    case 'stop':
      engine.stop(command.recordingId)
      break
    case 'cancel':
      engine.cancel(command.recordingId)
      break
  }
}

// Held here, not in the handler: a port with nothing referencing it can be garbage collected, and
// the frames then stop with no error at all.
let framePort: Electron.MessagePortMain | undefined

parentPort.on(
  'message',
  ({ data, ports }: { data: unknown; ports: Electron.MessagePortMain[] }) => {
    // A message carrying a port is the recorder's direct line for audio frames (TECH_SPEC §5.1).
    const port = ports.at(0)
    if (port === undefined) {
      handle(data)
      return
    }
    framePort?.close()
    framePort = port
    let reportedBadFrame = false
    port.on('message', ({ data: frame }: { data: unknown }) => {
      // Not instanceof: a frame comes from another JavaScript realm, with its own Float32Array.
      if (Object.prototype.toString.call(frame) === '[object Float32Array]') {
        engine.frame(frame as Float32Array)
      } else if (!reportedBadFrame) {
        // Reported, once: a silent drop here means a recording that just never ends.
        reportedBadFrame = true
        parentPort.postMessage({
          type: 'error',
          code: 'WORKER_ERROR',
          message: 'An audio frame arrived in an unusable form'
        })
      }
    })
    port.start()
  }
)

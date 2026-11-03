import type { RecorderApi, RecorderErrorCode } from '../../shared/ipcChannels'

// The hidden recorder window: microphone to 16 kHz frames to the speech worker. No speech
// processing happens here (TECH_SPEC §5.1), and the mic is open only while recording.

declare global {
  interface Window {
    readonly voiceupRecorder: RecorderApi
  }
}

const api = window.voiceupRecorder

interface Capture {
  readonly recordingId: string
  readonly stream: MediaStream
  readonly context: AudioContext
}

let framePort: MessagePort | undefined
let capture: Capture | undefined

// Set first and cleared on stop, so a stop during the async setup below can't leave the mic open.
let wanted: string | undefined

function release(active: Capture): void {
  for (const track of active.stream.getTracks()) track.stop()
  active.context.close().catch((error: unknown) => {
    console.warn('Could not close the audio context', error)
  })
}

function errorCode(error: unknown): RecorderErrorCode {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return 'MIC_DENIED'
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError')
      return 'MIC_MISSING'
  }
  return 'MIC_FAILED'
}

async function start(recordingId: string, deviceId: string | null): Promise<void> {
  wanted = recordingId
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: {
      ...(deviceId === null ? {} : { deviceId }),
      channelCount: 1,
      echoCancellation: false,
      noiseSuppression: true,
      autoGainControl: true
    }
  })
  const context = new AudioContext({ sampleRate: 16000 })
  const active: Capture = { recordingId, stream, context }
  try {
    await context.audioWorklet.addModule('/frames-worklet.js')
  } catch (error: unknown) {
    release(active)
    throw error
  }
  if (wanted !== recordingId) {
    release(active)
    return
  }
  const node = new AudioWorkletNode(context, 'frames')
  node.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
    // A copy, not a transfer: a transferred buffer reaches a utilityProcess as null (found in S3.2).
    framePort?.postMessage(data)
  }
  context.createMediaStreamSource(stream).connect(node)
  // A hidden window can start suspended, with no user gesture to wake it.
  await context.resume()
  capture = active
}

function stop(recordingId: string): void {
  if (wanted === recordingId) wanted = undefined
  if (capture?.recordingId === recordingId) {
    release(capture)
    capture = undefined
  }
}

api.onStart(({ recordingId, deviceId }) => {
  start(recordingId, deviceId).catch((error: unknown) => {
    console.warn('Could not start recording', error)
    if (wanted === recordingId) {
      wanted = undefined
      api.reportError(recordingId, errorCode(error))
    }
  })
})

api.onStop(({ recordingId }) => {
  stop(recordingId)
})

// The port arrives as a window message, because contextBridge can't carry one. It's checked by
// origin: event.source is no use, because the preload posts from its own isolated world. Only this
// window's preload can post here anyway, since the page loads nothing else.
window.addEventListener('message', (event) => {
  const port = event.ports.at(0)
  if (event.origin === location.origin && event.data === 'recorder-port' && port !== undefined) {
    framePort = port
  }
})

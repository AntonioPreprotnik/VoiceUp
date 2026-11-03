/* global AudioWorkletProcessor, registerProcessor */
// Emits mono frames of 512 samples, 32 ms at 16 kHz, which is Silero's window (TECH_SPEC §5.1).
// A plain file in public/, because a worklet is loaded by URL and isn't bundled.
const FRAME_SAMPLES = 512

class FramesProcessor extends AudioWorkletProcessor {
  buffer = new Float32Array(FRAME_SAMPLES)
  filled = 0

  process(inputs) {
    const channel = inputs[0]?.[0]
    if (channel === undefined) return true
    for (const sample of channel) {
      this.buffer[this.filled++] = sample
      if (this.filled === FRAME_SAMPLES) {
        const frame = this.buffer
        this.buffer = new Float32Array(FRAME_SAMPLES)
        this.filled = 0
        this.port.postMessage(frame, [frame.buffer])
      }
    }
    return true
  }
}

registerProcessor('frames', FramesProcessor)

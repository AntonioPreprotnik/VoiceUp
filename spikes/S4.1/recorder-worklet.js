// Emits frames of 512 samples (32 ms at 16 kHz), Silero's window, as TECH_SPEC 5.1 specifies.
class Frames extends AudioWorkletProcessor {
  constructor() {
    super()
    this.buffer = new Float32Array(512)
    this.filled = 0
  }

  process(inputs) {
    const input = inputs[0]?.[0]
    if (input === undefined) return true
    for (const sample of input) {
      this.buffer[this.filled++] = sample
      if (this.filled === 512) {
        this.port.postMessage(this.buffer.slice())
        this.filled = 0
      }
    }
    return true
  }
}

registerProcessor('frames', Frames)

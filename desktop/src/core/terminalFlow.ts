// Terminal output policy from TECH_SPEC §4.1: batching, flow control and size limits.

const MIN_COLS = 10
const MAX_COLS = 1000
const MIN_ROWS = 5
const MAX_ROWS = 500

export const PAUSE_ABOVE_CHARS = 1024 * 1024

export function clampTermSize(size: { cols: number; rows: number }): {
  cols: number
  rows: number
} {
  return {
    cols: Math.min(MAX_COLS, Math.max(MIN_COLS, size.cols)),
    rows: Math.min(MAX_ROWS, Math.max(MIN_ROWS, size.rows))
  }
}

/** Collects output and hands it over once per scheduled tick. */
export class OutputBatcher {
  private buffer = ''
  private scheduled = false

  constructor(
    private readonly deliver: (data: string) => void,
    private readonly schedule: (callback: () => void) => void
  ) {}

  push(data: string): void {
    this.buffer += data
    if (this.scheduled) return
    this.scheduled = true
    this.schedule(() => {
      this.flush()
    })
  }

  flush(): void {
    this.scheduled = false
    if (this.buffer === '') return
    const data = this.buffer
    this.buffer = ''
    this.deliver(data)
  }
}

/** Says when to pause the PTY: when the renderer has too much output it hasn't acknowledged. */
export class FlowControl {
  private unacknowledged = 0
  private paused = false

  /** Returns true when the PTY should pause now. */
  sent(chars: number): boolean {
    this.unacknowledged += chars
    if (this.paused || this.unacknowledged <= PAUSE_ABOVE_CHARS) return false
    this.paused = true
    return true
  }

  /** Returns true when the PTY should resume now. */
  acknowledged(chars: number): boolean {
    this.unacknowledged = Math.max(0, this.unacknowledged - chars)
    if (!this.paused || this.unacknowledged > PAUSE_ABOVE_CHARS) return false
    this.paused = false
    return true
  }
}

// A fake of node-pty. Use it with vi.mock('node-pty', () => import('<path to this file>')).
// The packaged smoke test covers the real module.

export class FakePty {
  written: string[] = []
  resizes: [number, number][] = []
  killCount = 0
  pauseCount = 0
  resumeCount = 0
  cols: number
  rows: number
  private dataListener: ((data: string) => void) | undefined
  private exitListener: ((event: { exitCode: number }) => void) | undefined

  constructor(
    readonly file: string,
    readonly args: string[],
    readonly options: Record<string, unknown>
  ) {
    this.cols = options['cols'] as number
    this.rows = options['rows'] as number
  }

  onData(listener: (data: string) => void): void {
    this.dataListener = listener
  }

  onExit(listener: (event: { exitCode: number }) => void): void {
    this.exitListener = listener
  }

  write(data: string): void {
    this.written.push(data)
  }

  resize(cols: number, rows: number): void {
    this.cols = cols
    this.rows = rows
    this.resizes.push([cols, rows])
  }

  kill(): void {
    this.killCount++
  }

  pause(): void {
    this.pauseCount++
  }

  resume(): void {
    this.resumeCount++
  }

  emitData(data: string): void {
    this.dataListener?.(data)
  }

  emitExit(exitCode: number): void {
    this.exitListener?.({ exitCode })
  }
}

export const spawned: FakePty[] = []

export function spawn(file: string, args: string[], options: Record<string, unknown>): FakePty {
  const pty = new FakePty(file, args, options)
  spawned.push(pty)
  return pty
}

export function lastPty(): FakePty {
  const pty = spawned.at(-1)
  if (pty === undefined) throw new Error('No PTY was spawned')
  return pty
}

export function resetFakePty(): void {
  spawned.length = 0
}

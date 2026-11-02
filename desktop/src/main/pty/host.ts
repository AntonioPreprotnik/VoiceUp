import type { IPty } from 'node-pty'
import { childEnv, type ClaudeCommand } from '../../core/claudeCommand'
import { MESSAGES } from '../../core/messages'
import { clampTermSize, FlowControl, OutputBatcher } from '../../core/terminalFlow'
import type { TermResize } from '../../shared/ipc'
import { log } from '../log'

const BATCH_MS = 16
const RESIZE_DEBOUNCE_MS = 50
const STOP_TIMEOUT_MS = 2000

export interface PtyHostOptions {
  /** Sends output to the terminal window. */
  readonly send: (data: string) => void
  readonly resolveCommand: () => Promise<ClaudeCommand | null>
  readonly cwd: string
}

/** Owns the Claude PTY (TECH_SPEC §4.1). Only the main process writes to it. */
export class PtyHost {
  private pty: IPty | undefined
  private starting = false
  private stopping = false
  private latestSize: TermResize | undefined
  private resizeTimer: ReturnType<typeof setTimeout> | undefined
  private exited: Promise<void> | undefined
  private readonly flow = new FlowControl()
  private readonly batcher: OutputBatcher

  constructor(private readonly options: PtyHostOptions) {
    this.batcher = new OutputBatcher(
      (data) => {
        if (this.flow.sent(data.length)) this.pty?.pause()
        options.send(data)
      },
      (callback) => {
        setTimeout(callback, BATCH_MS)
      }
    )
  }

  /** The renderer's first size starts Claude, so it never draws at the wrong size. */
  resize(raw: TermResize): void {
    const size = clampTermSize(raw)
    this.latestSize = size
    if (this.pty === undefined) {
      if (!this.starting) void this.start(size)
      return
    }
    clearTimeout(this.resizeTimer)
    this.resizeTimer = setTimeout(() => {
      this.applyLatestSize()
    }, RESIZE_DEBOUNCE_MS)
  }

  write(data: string): void {
    this.pty?.write(data)
  }

  acknowledge(chars: number): void {
    if (this.flow.acknowledged(chars)) this.pty?.resume()
  }

  /** Kills Claude and waits for it to exit, up to the §3 budget. */
  async stop(): Promise<void> {
    this.stopping = true
    clearTimeout(this.resizeTimer)
    const { pty, exited } = this
    if (pty === undefined || exited === undefined) return
    pty.kill()
    await Promise.race([
      exited,
      new Promise((resolve) => {
        setTimeout(resolve, STOP_TIMEOUT_MS)
      })
    ])
  }

  /** A method, because stop() can run during an await and TypeScript can't see that. */
  private isStopping(): boolean {
    return this.stopping
  }

  private applyLatestSize(): void {
    if (this.pty === undefined || this.latestSize === undefined) return
    if (this.pty.cols === this.latestSize.cols && this.pty.rows === this.latestSize.rows) return
    this.pty.resize(this.latestSize.cols, this.latestSize.rows)
  }

  private showMessage(code: keyof typeof MESSAGES, extra = ''): void {
    const { title, detail } = MESSAGES[code]
    this.options.send(`\r\n\x1b[1m${title}\x1b[0m${extra}\r\n${detail}\r\n`)
  }

  private async start(size: TermResize): Promise<void> {
    this.starting = true
    try {
      const command = await this.options.resolveCommand()
      if (this.stopping) return
      if (command === null) {
        log.error('CLAUDE_NOT_FOUND')
        this.showMessage('CLAUDE_NOT_FOUND')
        return
      }
      // Loaded here so a native module failure is reported, not fatal at startup.
      const { spawn } = await import('node-pty')
      if (this.isStopping()) return
      this.launch(spawn, command, size)
    } catch (error: unknown) {
      log.error('Could not start Claude Code', error)
      this.showMessage('CLAUDE_EXITED')
    } finally {
      this.starting = false
    }
  }

  private launch(
    spawn: (typeof import('node-pty'))['spawn'],
    command: ClaudeCommand,
    size: TermResize
  ): void {
    const pty = spawn(command.file, [...command.args], {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd: this.options.cwd,
      env: childEnv(process.env)
    })
    this.pty = pty

    let sawOutput = false
    pty.onData((data) => {
      if (!sawOutput) {
        sawOutput = true
        log.info(
          `First Claude output ${String(Math.round(process.uptime() * 1000))} ms after start`
        )
      }
      this.batcher.push(data)
    })
    this.exited = new Promise((resolve) => {
      pty.onExit(({ exitCode }) => {
        this.batcher.flush()
        this.pty = undefined
        log.info(`CLAUDE_EXITED with code ${String(exitCode)}`)
        if (!this.stopping) this.showMessage('CLAUDE_EXITED', ` (exit code ${String(exitCode)})`)
        resolve()
      })
    })

    // The window may have resized while Claude was being found.
    this.applyLatestSize()
  }
}

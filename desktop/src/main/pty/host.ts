import type { IPty } from 'node-pty'
import { childEnv, ptyArgs, type ClaudeCommand } from '../../core/claudeCommand'
import { MESSAGES } from '../../core/messages'
import { clampTermSize, FlowControl, OutputBatcher } from '../../core/terminalFlow'
import type { TermResize } from '../../shared/ipc'
import { TERMINAL_RESET } from '../../shared/ipcChannels'
import { hasVisibleText } from '../../shared/terminalText'
import type { LaunchExtras } from '../hooks/link'
import { log } from '../log'

const BATCH_MS = 16
const RESIZE_DEBOUNCE_MS = 50
const STOP_TIMEOUT_MS = 2000

export interface PtyHostOptions {
  /** Sends output to the terminal window. */
  readonly send: (data: string) => void
  readonly resolveCommand: () => Promise<ClaudeCommand | null>
  /** Claude ended or failed to start, and not because we stopped it. Null: no exit code. */
  readonly onExit: (exitCode: number | null) => void
  /** Claude Code isn't installed. */
  readonly onNotFound: () => void
  /** The folder to run in, which may ask the user. Null means they declined. */
  readonly resolveCwd: () => Promise<string | null>
  /** What this launch adds for the hooks, which depends on the folder. */
  readonly prepareLaunch: (cwd: string) => Promise<LaunchExtras>
  /** Claude was started. */
  readonly onLaunched: () => void
}

/** Owns the Claude PTY (TECH_SPEC §4.1). Only the main process writes to it. */
export class PtyHost {
  private pty: IPty | undefined
  private hasStarted = false
  private stopping = false
  private latestSize: TermResize | undefined
  private resizeTimer: ReturnType<typeof setTimeout> | undefined
  private exited: Promise<void> | undefined
  private startup: Promise<void> | undefined
  private restarting: Promise<void> | undefined
  private flow = new FlowControl()
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

  /**
   * The renderer's first size starts Claude, so it never draws at the wrong size. Only the first:
   * after that, a session starts only on request, or resizing the window would restart Claude.
   */
  resize(raw: TermResize): void {
    const size = clampTermSize(raw)
    this.latestSize = size
    if (this.pty === undefined) {
      if (!this.hasStarted && !this.stopping) this.startup = this.start(size)
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
    // If it outlived the wait, this retires it: its late events are then ignored.
    this.pty = undefined
  }

  /**
   * Replaces the session with a new one, at the current size, on a cleared screen. A second call
   * while one is in progress joins it, so a double click can't start two sessions.
   */
  restart(): Promise<void> {
    this.restarting ??= this.replaceSession().finally(() => {
      this.restarting = undefined
    })
    return this.restarting
  }

  private async replaceSession(): Promise<void> {
    await this.stop()
    await this.startup // a start in progress gives up when it sees stopping
    this.batcher.flush()
    this.flow = new FlowControl()
    this.stopping = false
    this.options.send(TERMINAL_RESET)
    if (this.latestSize !== undefined) {
      this.startup = this.start(this.latestSize)
      await this.startup
    }
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
    this.hasStarted = true
    try {
      const cwd = await this.options.resolveCwd()
      if (this.isStopping()) return
      if (cwd === null) {
        log.warn('NO_PROJECT_FOLDER')
        this.showMessage('NO_PROJECT_FOLDER')
        return
      }
      const command = await this.options.resolveCommand()
      if (this.isStopping()) return
      if (command === null) {
        log.error('CLAUDE_NOT_FOUND')
        this.options.onNotFound()
        return
      }
      const extras = await this.options.prepareLaunch(cwd)
      if (this.isStopping()) return
      // Loaded here so a native module failure is reported, not fatal at startup.
      const { spawn } = await import('node-pty')
      if (this.isStopping()) return
      this.launch(spawn, command, size, cwd, extras)
    } catch (error: unknown) {
      log.error('Could not start Claude Code', error)
      this.options.onExit(null)
    }
  }

  private launch(
    spawn: (typeof import('node-pty'))['spawn'],
    command: ClaudeCommand,
    size: TermResize,
    cwd: string,
    extras: LaunchExtras
  ): void {
    const pty = spawn(command.file, ptyArgs(command, extras.args), {
      name: 'xterm-256color',
      cols: size.cols,
      rows: size.rows,
      cwd,
      env: { ...childEnv(process.env), ...extras.env }
    })
    this.pty = pty
    this.options.onLaunched()

    let sawText = false
    pty.onData((data) => {
      if (this.pty !== pty) return
      if (!sawText && hasVisibleText(data)) {
        sawText = true
        log.info(`First Claude text ${String(Math.round(process.uptime() * 1000))} ms after start`)
      }
      this.batcher.push(data)
    })
    this.exited = new Promise((resolve) => {
      pty.onExit(({ exitCode }) => {
        log.info(`CLAUDE_EXITED with code ${String(exitCode)}`)
        // A session already replaced by a restart must not touch the new one.
        if (this.pty === pty) {
          this.batcher.flush()
          this.pty = undefined
          if (!this.stopping) this.options.onExit(exitCode)
        }
        resolve()
      })
    })

    // The window may have resized while Claude was being found.
    this.applyLatestSize()
  }
}

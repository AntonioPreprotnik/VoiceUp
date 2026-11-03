import { join } from 'node:path'
import {
  MessageChannelMain,
  utilityProcess,
  type MessagePortMain,
  type UtilityProcess,
  type WebContents
} from 'electron'
import { Channels } from '../../shared/ipcChannels'
import { WorkerEvent, type WorkerCommand, type WorkerInit } from '../../shared/worker'
import { log } from '../log'

const MAX_CRASHES = 3
const CRASH_WINDOW_MS = 60000
const STOP_TIMEOUT_MS = 1000

export interface SupervisorOptions {
  readonly onEvent: (event: WorkerEvent) => void
  /** The worker crashed too often and won't be restarted (WORKER_CRASHED). */
  readonly onGaveUp: () => void
  readonly now?: () => number
}

/**
 * Runs the speech worker in a utilityProcess: restarts it after a crash, up to 3 times in 60 s, and
 * kills it on quit. Main never loads the addon itself (TECH_SPEC §3), which lint enforces.
 */
export class SpeechSupervisor {
  private child: UtilityProcess | undefined
  private init: WorkerInit | undefined
  private recorder: WebContents | undefined
  private stopping = false
  private crashes: number[] = []
  private readonly now: () => number

  constructor(private readonly options: SupervisorOptions) {
    this.now = options.now ?? Date.now
  }

  start(init: WorkerInit): void {
    this.init = init
    this.spawn()
  }

  send(command: WorkerCommand): void {
    this.child?.postMessage(command)
  }

  /** Gives the worker a direct port for audio frames, so audio never passes through main. */
  attachFramePort(port: MessagePortMain): void {
    this.child?.postMessage({ type: 'framePort' }, [port])
  }

  /** Connects the recorder window to the worker, again after every restart (TECH_SPEC §5.1). */
  connectRecorder(recorder: WebContents): void {
    this.recorder = recorder
    this.wireRecorder()
  }

  /** Kills the worker and waits for it to go, up to a limit, for the shutdown order in §3. */
  async stop(): Promise<void> {
    this.stopping = true
    const { child } = this
    if (child === undefined) return
    const exited = new Promise((resolve) => {
      child.once('exit', resolve)
    })
    child.kill()
    await Promise.race([
      exited,
      new Promise((resolve) => {
        setTimeout(resolve, STOP_TIMEOUT_MS)
      })
    ])
  }

  private spawn(): void {
    const { init } = this
    if (init === undefined) return
    const child = utilityProcess.fork(join(__dirname, 'speechWorker.js'), [], {
      serviceName: 'VoiceUp Speech'
    })
    this.child = child
    child.on('message', (raw: unknown) => {
      this.receive(raw)
    })
    child.on('exit', (code: number) => {
      this.onExit(child, code)
    })
    child.postMessage(init)
    this.wireRecorder()
  }

  private wireRecorder(): void {
    const { recorder } = this
    if (recorder === undefined || recorder.isDestroyed() || this.child === undefined) return
    const { port1, port2 } = new MessageChannelMain()
    recorder.postMessage(Channels.recorderPort, null, [port1])
    this.attachFramePort(port2)
  }

  private receive(raw: unknown): void {
    const parsed = WorkerEvent.safeParse(raw)
    if (!parsed.success) {
      log.warn('Dropped an invalid message from the speech worker')
      return
    }
    this.options.onEvent(parsed.data)
  }

  private onExit(child: UtilityProcess, code: number): void {
    if (this.child !== child) return
    this.child = undefined
    if (this.stopping) return

    log.error(`The speech worker exited with code ${String(code)}`)
    const now = this.now()
    this.crashes = [...this.crashes.filter((at) => now - at < CRASH_WINDOW_MS), now]
    if (this.crashes.length >= MAX_CRASHES) {
      log.error('WORKER_CRASHED: not restarting the speech worker')
      this.options.onGaveUp()
      return
    }
    this.spawn()
  }
}

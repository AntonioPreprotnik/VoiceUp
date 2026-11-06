// Whether the global hotkey listens (S7.1): on once started, off while paused from the tray, and
// moved to a new key from the settings screen. The hotkey itself comes in through the deps.

export interface ListeningDeps {
  /** False when another app has the keys, or Windows refuses them. */
  readonly register: (accelerator: string) => boolean
  readonly unregister: (accelerator: string) => void
  /** The saved hotkey, read each time, since the settings screen can change it. */
  readonly hotkey: () => string
  /** Ends a recording in progress, as pressing the hotkey again would. */
  readonly cancelRecording: () => void
}

export class Listening {
  private started = false
  private registered = false
  private paused = false

  constructor(private readonly deps: ListeningDeps) {}

  /** The hotkey is registered now. False while paused. */
  get hotkeyOn(): boolean {
    return this.registered
  }

  get isPaused(): boolean {
    return this.paused
  }

  /** Once: the wizard's microphone test may have turned it on already. */
  start(): boolean {
    if (this.started) return this.registered
    this.started = true
    if (!this.paused) this.registered = this.deps.register(this.deps.hotkey())
    return this.registered
  }

  /**
   * The new key on, then the old one off. If it can't be had, the old one stays on. While paused,
   * the new key is only tried, so the screen can say whether it is free, and listening stays off.
   */
  change(next: string): boolean {
    if (this.paused) {
      const free = this.deps.register(next)
      if (free) this.deps.unregister(next)
      return free
    }
    const previous = this.deps.hotkey()
    const wasOn = this.registered
    if (wasOn) this.deps.unregister(previous)
    if (this.deps.register(next)) {
      this.started = true
      this.registered = true
      return true
    }
    this.registered = wasOn && this.deps.register(previous)
    return false
  }

  /** The keys go back to Windows, so another app can use them. */
  pause(): void {
    if (this.paused) return
    this.paused = true
    if (this.registered) this.deps.unregister(this.deps.hotkey())
    this.registered = false
    this.deps.cancelRecording()
  }

  /** False when the keys were taken while paused. */
  resume(): boolean {
    if (!this.paused) return this.registered
    this.paused = false
    if (this.started) this.registered = this.deps.register(this.deps.hotkey())
    return this.registered
  }
}

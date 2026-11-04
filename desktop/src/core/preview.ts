// The moment to catch a misheard command before it is sent (TECH_SPEC §4.5). The overlay is
// click-through, so the only controls are the hotkey and Esc.

/** A press this soon after the preview appears was meant for what came before: it can't send. */
export const LATE_PRESS_GUARD_MS = 300
/** However short the text, there is time to read it and react. */
export const MIN_COUNTDOWN_MS = 3500

export interface PreviewSettings {
  /** For each word, so there is time to read it. 0 sends at once, unless alwaysConfirm is on. */
  readonly previewMs: number
  /** Waits for a key instead of counting down. */
  readonly alwaysConfirm: boolean
}

export interface PreviewOptions {
  /** Returns a function that cancels it. Injected so this stays free of timers. */
  readonly schedule: (callback: () => void, ms: number) => () => void
  readonly now: () => number
  /** Fires at most once for each preview. */
  readonly onSend: (text: string) => void
  readonly onCancel: () => void
}

export type PreviewStart =
  { readonly kind: 'sent' } | { readonly kind: 'showing'; readonly countdownMs: number | null }

function wordCount(text: string): number {
  return text.split(/\s+/u).filter((word) => word !== '').length
}

export class PreviewWindow {
  private text: string | undefined
  private startedAt = 0
  private cancelTimer: (() => void) | undefined

  constructor(private readonly options: PreviewOptions) {}

  get active(): boolean {
    return this.text !== undefined
  }

  start(text: string, { previewMs, alwaysConfirm }: PreviewSettings): PreviewStart {
    this.clear()
    if (!alwaysConfirm && previewMs <= 0) {
      this.options.onSend(text)
      return { kind: 'sent' }
    }
    this.text = text
    this.startedAt = this.options.now()
    if (alwaysConfirm) return { kind: 'showing', countdownMs: null }
    const countdownMs = Math.max(MIN_COUNTDOWN_MS, previewMs * wordCount(text))
    this.cancelTimer = this.options.schedule(() => {
      this.finish()
    }, countdownMs)
    return { kind: 'showing', countdownMs }
  }

  /** The hotkey: sends now, except just after the preview appeared. Returns whether it sent. */
  press(): boolean {
    if (!this.active) return false
    if (this.options.now() - this.startedAt < LATE_PRESS_GUARD_MS) return false
    this.finish()
    return true
  }

  /** Esc. It always works, including during the guard. */
  cancel(): void {
    if (!this.active) return
    this.clear()
    this.options.onCancel()
  }

  private finish(): void {
    const { text } = this
    this.clear()
    if (text !== undefined) this.options.onSend(text)
  }

  private clear(): void {
    this.cancelTimer?.()
    this.cancelTimer = undefined
    this.text = undefined
  }
}

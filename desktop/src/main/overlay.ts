import { screen, type BrowserWindow } from 'electron'
import { MESSAGES, type MessageCode } from '../core/messages'
import { overlayBounds } from '../core/overlayPosition'
import { Channels, type OverlaySound, type OverlayState } from '../shared/ipcChannels'
import { log } from './log'

const SIZE = { width: 320, height: 64 }
// Room for three lines of a spoken command, plus the keys and the countdown.
const PREVIEW_SIZE = { width: 560, height: 124 }
const ERROR_SHOW_MS = 4000

export interface OverlayOptions {
  readonly window: BrowserWindow
  readonly sounds: boolean
  readonly now?: () => number
}

/** What a recording looks like on screen. Never takes focus or clicks, and never logs text. */
export class Overlay {
  private hideTimer: ReturnType<typeof setTimeout> | undefined
  private pressedAt: number | undefined
  private shownSize = SIZE
  private readonly now: () => number

  constructor(private readonly options: OverlayOptions) {
    this.now = options.now ?? Date.now
    // Click-through, so it can sit over whatever the user is doing.
    options.window.setIgnoreMouseEvents(true)
    // Above fullscreen apps too, which the normal always-on-top level is not.
    options.window.setAlwaysOnTop(true, 'screen-saver')
  }

  /** The hotkey was pressed. "Listening" waits for real audio, in the first level below. */
  recordingStarted(): void {
    this.pressedAt = this.now()
    this.playSound('start')
    this.show({ phase: 'hidden' })
  }

  level(rms: number): void {
    if (this.pressedAt !== undefined) {
      log.info(`Listening ${String(this.now() - this.pressedAt)} ms after the hotkey`)
      this.pressedAt = undefined
    }
    this.show({ phase: 'listening', level: rms })
  }

  speechEnded(): void {
    this.playSound('stop')
    this.show({ phase: 'transcribing' })
  }

  /** Shown with no sound: the stop sound already played when the speech ended. */
  preview(text: string, countdownMs: number | null): void {
    this.pressedAt = undefined
    this.show({ phase: 'preview', text, countdownMs })
  }

  /** The transcript arrived or the recording was cancelled. */
  finished(): void {
    this.pressedAt = undefined
    this.show({ phase: 'hidden' })
  }

  cancelled(): void {
    this.playSound('stop')
    this.finished()
  }

  failed(code: MessageCode): void {
    this.pressedAt = undefined
    const { title, detail } = MESSAGES[code]
    this.show({ phase: 'error', code, message: `${title}. ${detail}` })
    this.hideTimer = setTimeout(() => {
      this.show({ phase: 'hidden' })
    }, ERROR_SHOW_MS)
  }

  private show(state: OverlayState): void {
    clearTimeout(this.hideTimer)
    const { window } = this.options
    if (window.isDestroyed()) return
    window.webContents.send(Channels.overlayShow, state)
    if (state.phase === 'hidden') {
      window.hide()
      return
    }
    const size = state.phase === 'preview' ? PREVIEW_SIZE : SIZE
    const visible = window.isVisible()
    if (!visible || size !== this.shownSize) {
      this.shownSize = size
      // On the display with the cursor, which is where the user is looking.
      const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
      window.setBounds(overlayBounds(workArea, size))
    }
    // Inactive: taking focus here would pull the user out of what they are typing into.
    if (!visible) window.showInactive()
  }

  private playSound(sound: OverlaySound): void {
    const { window, sounds } = this.options
    if (sounds && !window.isDestroyed()) window.webContents.send(Channels.overlaySound, sound)
  }
}

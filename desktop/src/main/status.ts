import { Menu, nativeImage, Notification, Tray, type BrowserWindow } from 'electron'
import { dotBitmap, noticeFor } from '../core/state/status'
import type { ClaudeState } from '../core/state/reducer'
import { Channels, type StatusView } from '../shared/ipcChannels'
import { log } from './log'

// Twice the tray's 16 px, so it stays sharp on a scaled display.
const ICON_SIZE = 32
const ICON_SCALE = 2

export interface ClaudeStatusOptions {
  readonly window: BrowserWindow
  readonly notifications: boolean
  readonly openSettings: () => void
  readonly reArm: () => void
  /** Ticked: the hotkey is off until it is unticked (S7.1). */
  readonly pauseListening: (paused: boolean) => void
  readonly showWindow: () => void
  readonly quit: () => void
}

/** Shows Claude's state outside the terminal: the status bar, the tray and Windows notifications. */
export class ClaudeStatus {
  private readonly tray: Tray
  private view: StatusView | undefined
  // A notification with nothing holding on to it can be collected before its click arrives.
  private notice: Notification | undefined

  private notifications: boolean
  private paused = false

  constructor(private readonly options: ClaudeStatusOptions) {
    this.notifications = options.notifications
    this.tray = new Tray(nativeImage.createEmpty())
    this.tray.on('click', () => {
      options.showWindow()
    })
  }

  get current(): StatusView | undefined {
    return this.view
  }

  show(view: StatusView): void {
    const previous = this.view
    this.view = view
    if (previous?.color !== view.color) this.tray.setImage(this.icon(view.color))
    if (
      previous?.label === view.label &&
      previous.detail === view.detail &&
      previous.canReArm === view.canReArm &&
      JSON.stringify(previous.queue) === JSON.stringify(view.queue)
    ) {
      return
    }
    this.refreshTray(view)
    const { window } = this.options
    if (!window.isDestroyed()) window.webContents.send(Channels.stateChanged, view)
  }

  setNotifications(on: boolean): void {
    this.notifications = on
  }

  /** The menu's tick and the tooltip follow it, so a paused hotkey is never a mystery. */
  setListeningPaused(paused: boolean): void {
    this.paused = paused
    if (this.view !== undefined) this.refreshTray(this.view)
  }

  /** Once, when the window first goes to the tray, so closing it doesn't look like quitting. */
  stillRunning(): void {
    this.showNotice({
      title: 'VoiceUp is still running',
      body: 'Click the tray icon to open it, or right-click it to quit.'
    })
  }

  /** Only when the user isn't already looking at it. */
  notify(previous: ClaudeState, state: ClaudeState): void {
    const { window } = this.options
    if (!this.notifications || window.isDestroyed() || window.isFocused()) return
    const notice = noticeFor(previous, state)
    if (notice !== null) this.showNotice(notice)
  }

  private showNotice(notice: { title: string; body: string }): void {
    if (!this.notifications || !Notification.isSupported()) return
    try {
      this.notice = new Notification(notice)
      this.notice.on('click', this.options.showWindow)
      this.notice.show()
    } catch (error: unknown) {
      log.warn('Could not show a notification', error)
    }
  }

  private refreshTray(view: StatusView): void {
    const waiting = view.queue.length === 0 ? '' : ` (${String(view.queue.length)} queued)`
    const paused = this.paused ? ', listening paused' : ''
    this.tray.setToolTip(`VoiceUp: ${view.label}${waiting}${paused}`)
    this.tray.setContextMenu(this.menu(view))
  }

  destroy(): void {
    this.tray.destroy()
  }

  private icon(color: string): Electron.NativeImage {
    return nativeImage.createFromBitmap(Buffer.from(dotBitmap(color, ICON_SIZE)), {
      width: ICON_SIZE,
      height: ICON_SIZE,
      scaleFactor: ICON_SCALE
    })
  }

  private menu(view: StatusView): Menu {
    const { reArm, showWindow, quit, openSettings, pauseListening } = this.options
    return Menu.buildFromTemplate([
      { label: this.paused ? `${view.label} (listening paused)` : view.label, enabled: false },
      { type: 'separator' },
      { label: 'Show VoiceUp', click: showWindow },
      {
        label: 'Pause listening',
        type: 'checkbox',
        checked: this.paused,
        click: (item) => {
          pauseListening(item.checked)
        }
      },
      { label: 'Re-arm voice', enabled: view.canReArm, click: reArm },
      { label: 'Settings...', click: openSettings },
      { type: 'separator' },
      { label: 'Quit', click: quit }
    ])
  }
}

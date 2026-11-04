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
  readonly reArm: () => void
  readonly showWindow: () => void
  readonly quit: () => void
}

/** Shows Claude's state outside the terminal: the status bar, the tray and Windows notifications. */
export class ClaudeStatus {
  private readonly tray: Tray
  private view: StatusView | undefined
  // A notification with nothing holding on to it can be collected before its click arrives.
  private notice: Notification | undefined

  constructor(private readonly options: ClaudeStatusOptions) {
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
    if (previous?.label === view.label && previous.detail === view.detail) {
      if (previous.canReArm === view.canReArm) return
    }
    this.tray.setToolTip(`VoiceUp: ${view.label}`)
    this.tray.setContextMenu(this.menu(view))
    const { window } = this.options
    if (!window.isDestroyed()) window.webContents.send(Channels.stateChanged, view)
  }

  /** Only when the user isn't already looking at it. */
  notify(previous: ClaudeState, state: ClaudeState): void {
    const { window, notifications, showWindow } = this.options
    if (!notifications || window.isDestroyed() || window.isFocused()) return
    const notice = noticeFor(previous, state)
    if (notice === null || !Notification.isSupported()) return
    try {
      this.notice = new Notification(notice)
      this.notice.on('click', showWindow)
      this.notice.show()
    } catch (error: unknown) {
      log.warn('Could not show a notification', error)
    }
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
    const { reArm, showWindow, quit } = this.options
    return Menu.buildFromTemplate([
      { label: view.label, enabled: false },
      { type: 'separator' },
      { label: 'Show VoiceUp', click: showWindow },
      { label: 'Re-arm voice', enabled: view.canReArm, click: reArm },
      { type: 'separator' },
      { label: 'Quit', click: quit }
    ])
  }
}

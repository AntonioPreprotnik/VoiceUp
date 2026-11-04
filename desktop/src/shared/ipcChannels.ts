// Channel names only, with no imports: a sandboxed preload can't load zod at runtime, so it must
// not pull in ipc.ts. Payloads are in TECH_SPEC §6.1.
export const Channels = {
  termData: 'term:data',
  termInput: 'term:input',
  termResize: 'term:resize',
  termAck: 'term:ack',
  sessionExited: 'session:exited',
  sessionRestart: 'session:restart',
  stateChanged: 'state:changed',
  stateGet: 'state:get',
  stateReArm: 'state:rearm',
  clipboardWrite: 'clipboard:write',
  clipboardRead: 'clipboard:read',
  linkOpen: 'link:open',
  termContextMenu: 'term:contextMenu',
  termMenuAction: 'term:menuAction',
  termFontSize: 'term:fontSize',
  settingsFontSize: 'settings:fontSize',
  recorderPort: 'recorder:port',
  recorderStart: 'recorder:start',
  recorderStop: 'recorder:stop',
  recorderError: 'recorder:error',
  recorderDevices: 'recorder:devices',
  overlayShow: 'overlay:show',
  overlaySound: 'overlay:sound'
} as const

/** RIS, the terminal's full reset, sent on its own as a session is replaced. */
export const TERMINAL_RESET = '\x1bc'

export type TerminalMenuAction = 'copy' | 'paste'

/** What Claude is doing, ready to show: the status bar and the tray both draw this. */
export interface StatusView {
  readonly state: string
  readonly label: string
  readonly detail: string
  /** As #rrggbb. */
  readonly color: string
  readonly canReArm: boolean
}

/** Why no session is running, in words the terminal window can show as they are. */
export interface SessionExit {
  readonly title: string
  readonly detail: string
  /** The label of the button that tries again. */
  readonly action: string
  /** A command the user can copy, if there is one. */
  readonly command: string | null
  /** Null when Claude never started, so there is no code to show. */
  readonly exitCode: number | null
}

/** What the overlay shows. TECH_SPEC §6.1 adds the preview and blocked phases with their stories. */
export type OverlayState =
  | { readonly phase: 'hidden' }
  | { readonly phase: 'listening'; readonly level: number }
  | { readonly phase: 'transcribing' }
  | { readonly phase: 'blocked'; readonly reason: string }
  /** countdownMs is null in always-confirm mode, which waits for a key. */
  | { readonly phase: 'preview'; readonly text: string; readonly countdownMs: number | null }
  | { readonly phase: 'error'; readonly code: string; readonly message: string }

export type OverlaySound = 'start' | 'stop'

/** What the overlay preload exposes as window.voiceupOverlay. */
export interface OverlayApi {
  onShow(listener: (state: OverlayState) => void): void
  onSound(listener: (sound: OverlaySound) => void): void
}

export interface MicDevice {
  readonly deviceId: string
  readonly label: string
}

export type RecorderErrorCode = 'MIC_DENIED' | 'MIC_MISSING' | 'MIC_FAILED'

/** What the recorder preload exposes as window.voiceupRecorder. */
export interface RecorderApi {
  onStart(listener: (start: { recordingId: string; deviceId: string | null }) => void): void
  onStop(listener: (stop: { recordingId: string }) => void): void
  reportError(recordingId: string, code: RecorderErrorCode): void
  reportDevices(devices: readonly MicDevice[]): void
}

/** What the terminal preload exposes as window.voiceup. */
export interface TerminalApi {
  /** Windows build number, which xterm needs to handle ConPTY's line wrapping. */
  readonly windowsBuild: number
  input(data: string): void
  resize(cols: number, rows: number): void
  ack(chars: number): void
  /** Returns the function that unsubscribes. */
  onData(listener: (data: string) => void): () => void
  /** Returns the function that unsubscribes. */
  onSessionExit(listener: (exit: SessionExit) => void): () => void
  restartSession(): void
  /** The state now. Null or a rejection when no session is running, as in a smoke test. */
  claudeStatus(): Promise<StatusView | null>
  /** Returns the function that unsubscribes. */
  onClaudeStatus(listener: (view: StatusView) => void): () => void
  reArm(): void
  copy(text: string): void
  readClipboard(): Promise<string>
  openLink(url: string): void
  showContextMenu(hasSelection: boolean): void
  /** Returns the function that unsubscribes. */
  onMenuAction(listener: (action: TerminalMenuAction) => void): () => void
  /** The saved size. Rejects when no session is running, as in a smoke test. */
  fontSize(): Promise<number>
  /** Returns the function that unsubscribes. */
  onFontSize(listener: (size: number) => void): () => void
}

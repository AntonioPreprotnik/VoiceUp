import type { EditableSettings, SettingsField } from './settingsFields'

// Channel names only, with no value imports: a sandboxed preload can't load zod at runtime, so it must
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
  queueCancel: 'queue:cancel',
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
  overlaySound: 'overlay:sound',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsReset: 'settings:reset',
  settingsRetryModel: 'settings:retryModel',
  settingsChanged: 'settings:changed',
  wizardGet: 'wizard:get',
  wizardNext: 'wizard:next',
  wizardBack: 'wizard:back',
  wizardClaudeCheck: 'wizard:claudeCheck',
  wizardClaudeInstall: 'wizard:claudeInstall',
  wizardChooseFolder: 'wizard:chooseFolder',
  wizardTestClaude: 'wizard:testClaude',
  wizardRestartClaude: 'wizard:restartClaude',
  wizardRetryModel: 'wizard:retryModel',
  wizardSkipMicTest: 'wizard:skipMicTest',
  wizardChanged: 'wizard:changed',
  wizardOutput: 'wizard:output'
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
  /** Waiting to be sent, oldest first. */
  readonly queue: readonly QueuedPreview[]
}

export interface QueuedPreview {
  readonly id: string
  readonly preview: string
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
  | { readonly phase: 'queued'; readonly position: number }
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

/** One step of the first-run wizard, ready to show. */
export interface WizardStepView {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly done: boolean
}

export interface WizardProgress {
  readonly steps: readonly WizardStepView[]
  /** The step showing now. */
  readonly index: number
}

/** The Claude Code step. A command is one the user can read, or is about to have run for them. */
export type ClaudeStepStatus =
  | { readonly status: 'checking' }
  /** The version is null when it couldn't be read, which doesn't block a start. */
  | { readonly status: 'ready'; readonly version: string | null }
  | { readonly status: 'missing'; readonly command: string }
  | {
      readonly status: 'tooOld'
      readonly version: string
      readonly minimum: string
      readonly command: string
    }
  | { readonly status: 'installing' }
  | { readonly status: 'failed'; readonly command: string }

/** The Project folder step. A saved path is shown even when it's gone, so the user knows which. */
export interface FolderStepStatus {
  readonly path: string | null
  readonly missing: boolean
}

/** The Sign in step. Claude's own screens stay in the terminal: this only watches its hooks. */
export type SignInStatus =
  | { readonly status: 'waiting' }
  | { readonly status: 'ready' }
  | { readonly status: 'testing' }
  | { readonly status: 'done' }
  | {
      readonly status: 'failed'
      readonly title: string
      readonly detail: string
      readonly canTest: boolean
    }

/** The Speech model step. */
export interface ModelStepStatus {
  readonly label: string
  /** As shown, such as "239 MB". */
  readonly size: string
  readonly phase: 'waiting' | 'downloading' | 'unpacking' | 'ready' | 'failed'
  readonly percent: number
}

/** The Microphone and hotkey step. What was heard is shown only here: it never goes to Claude. */
export interface MicStepStatus {
  readonly hotkey: string
  /** Null until the step has tried to turn the hotkey on. */
  readonly hotkeyOn: boolean | null
  readonly heard: string | null
  readonly problem: { readonly title: string; readonly detail: string } | null
  readonly skipped: boolean
}

export interface WizardView extends WizardProgress {
  readonly model: ModelStepStatus
  readonly mic: MicStepStatus
  readonly claude: ClaudeStepStatus
  readonly folder: FolderStepStatus
  readonly signIn: SignInStatus
  /** A warning to show on the Sign in step, never the key itself. */
  readonly apiKeyWarning: { readonly title: string; readonly detail: string } | null
  /** Main refuses Continue when this is false. */
  readonly canContinue: boolean
}

export type WizardResult =
  | { readonly ok: true; readonly data: WizardView }
  | { readonly ok: false; readonly code: 'WIZARD_REFUSED' }

/** What the wizard preload exposes as window.voiceupWizard. */
export interface WizardApi {
  view(): Promise<WizardResult>
  next(): Promise<WizardResult>
  back(): Promise<WizardResult>
  checkClaude(): Promise<WizardResult>
  installClaude(): Promise<WizardResult>
  /** Opens the Windows folder picker. The page can't supply a path. */
  chooseFolder(): Promise<WizardResult>
  /** Sends the fixed test prompt. The page can't choose the text. */
  testClaude(): Promise<WizardResult>
  restartClaude(): Promise<WizardResult>
  retryModel(): Promise<WizardResult>
  skipMicTest(): Promise<WizardResult>
  /** Returns the function that unsubscribes. */
  onChanged(listener: (view: WizardView) => void): () => void
  /** The installer's output, as it arrives. Returns the function that unsubscribes. */
  onOutput(listener: (text: string) => void): () => void
}

/** What the settings screen shows. The microphone is the system default when the saved one is gone. */
export interface SettingsView {
  readonly values: EditableSettings
  readonly microphones: readonly MicDevice[]
  readonly models: readonly {
    readonly id: string
    readonly label: string
    readonly size: string
    readonly installed: boolean
    readonly chosen: boolean
  }[]
  /** The chosen model's download. */
  readonly model: ModelStepStatus
  readonly hotkeyOn: boolean
  readonly canStartWithWindows: boolean
}

/** Data is null only when main refused the request outright. */
export type SettingsResult =
  | { readonly ok: true; readonly data: SettingsView }
  | {
      readonly ok: false
      readonly errors: Partial<Record<SettingsField, string>>
      readonly data: SettingsView | null
    }

/** What the settings preload exposes as window.voiceupSettings. */
export interface SettingsApi {
  get(): Promise<SettingsResult>
  /** Only the fields that changed. */
  set(changes: Partial<EditableSettings>): Promise<SettingsResult>
  reset(): Promise<SettingsResult>
  retryModel(): Promise<SettingsResult>
  /** Returns the function that unsubscribes. */
  onChanged(listener: (view: SettingsView) => void): () => void
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
  cancelQueued(id: string): void
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

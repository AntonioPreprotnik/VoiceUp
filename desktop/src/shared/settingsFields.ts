// What the settings screen can change (S6.6). No imports: the page uses this too. The bounds
// must match the schema in settings.ts, which a test checks.

export const LOG_LEVELS = ['error', 'warn', 'info', 'debug'] as const

/** One flat value per field on the screen. */
export interface EditableSettings {
  readonly hotkey: string
  /** Null is the system default. */
  readonly micDeviceId: string | null
  readonly modelId: string
  readonly endSilenceSec: number
  readonly maxRecordingSec: number
  readonly previewMs: number
  readonly queue: boolean
  readonly sounds: boolean
  readonly notifications: boolean
  readonly startWithWindows: boolean
  readonly logLevel: (typeof LOG_LEVELS)[number]
}

export type SettingsField = keyof EditableSettings

export interface NumberRange {
  readonly min: number
  readonly max: number
  readonly step: number
  readonly unit: string
}

export const RANGES = {
  endSilenceSec: { min: 0.5, max: 3, step: 0.1, unit: 'seconds' },
  maxRecordingSec: { min: 5, max: 120, step: 1, unit: 'seconds' },
  previewMs: { min: 0, max: 5000, step: 50, unit: 'ms' }
} as const satisfies Partial<Record<SettingsField, NumberRange>>

const KEY_NAMES: Readonly<Record<string, string>> = {
  Space: 'Space',
  Enter: 'Enter',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`'
}

function keyName(code: string): string | null {
  const letter = /^Key([A-Z])$/.exec(code)
  if (letter !== null) return letter[1]
  const digit = /^Digit([0-9])$/.exec(code)
  if (digit !== null) return digit[1]
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code
  return KEY_NAMES[code] ?? null
}

export interface KeyPress {
  readonly code: string
  readonly ctrlKey: boolean
  readonly altKey: boolean
  readonly shiftKey: boolean
  readonly metaKey: boolean
}

export type HotkeyCapture =
  | { readonly kind: 'hotkey'; readonly accelerator: string }
  /** Still waiting: only modifiers so far. */
  | { readonly kind: 'waiting' }
  | { readonly kind: 'invalid'; readonly reason: string }

/**
 * An Electron accelerator from a key press. It needs Ctrl, Alt or Windows: with Shift alone, or
 * nothing, every press of that key in any app would start a recording.
 */
export function captureHotkey(press: KeyPress): HotkeyCapture {
  if (/^(Control|Alt|Shift|Meta|OS)(Left|Right)?$/.test(press.code)) return { kind: 'waiting' }
  const key = keyName(press.code)
  if (key === null) return { kind: 'invalid', reason: "That key can't be part of a hotkey." }
  if (!press.ctrlKey && !press.altKey && !press.metaKey) {
    return { kind: 'invalid', reason: 'Add Ctrl, Alt or the Windows key.' }
  }
  const parts = [
    ...(press.ctrlKey ? ['Control'] : []),
    ...(press.altKey ? ['Alt'] : []),
    ...(press.shiftKey ? ['Shift'] : []),
    ...(press.metaKey ? ['Super'] : []),
    key
  ]
  return { kind: 'hotkey', accelerator: parts.join('+') }
}

/** On a Croatian layout Ctrl+Alt is AltGr, which types characters such as @ and {. */
export function clashesWithAltGr(accelerator: string): boolean {
  const parts = accelerator.split('+')
  return parts.includes('Control') && parts.includes('Alt')
}

/** As people say it: Ctrl, not Control, and Win, not Super. */
export function hotkeyLabel(accelerator: string): string {
  return accelerator.replaceAll('Control', 'Ctrl').replaceAll('Super', 'Win')
}

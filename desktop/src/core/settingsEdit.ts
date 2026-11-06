import type { Settings } from '../shared/settings'
import { RANGES, type EditableSettings, type SettingsField } from '../shared/settingsFields'
import { defaultSettings } from './settingsMigrate'

/** The screen's flat view of the settings. */
export function editable(settings: Settings): EditableSettings {
  return {
    hotkey: settings.hotkey,
    micDeviceId: settings.micDeviceId,
    modelId: settings.speech.modelId,
    endSilenceSec: settings.speech.endSilenceSec,
    maxRecordingSec: settings.speech.maxRecordingSec,
    previewMs: settings.delivery.previewMs,
    queue: settings.delivery.queue,
    sounds: settings.ui.sounds,
    notifications: settings.ui.notifications,
    startWithWindows: settings.ui.startWithWindows,
    logLevel: settings.logLevel
  }
}

/**
 * The settings with these changes, unchecked: the caller validates the result against the schema.
 * Nothing outside the screen's fields can be reached from here.
 */
export function withChanges(settings: Settings, changes: Partial<EditableSettings>): Settings {
  const next = { ...editable(settings), ...changes }
  return {
    ...settings,
    hotkey: next.hotkey,
    micDeviceId: next.micDeviceId,
    speech: {
      ...settings.speech,
      modelId: next.modelId as Settings['speech']['modelId'],
      endSilenceSec: next.endSilenceSec,
      maxRecordingSec: next.maxRecordingSec
    },
    delivery: { ...settings.delivery, previewMs: next.previewMs, queue: next.queue },
    ui: {
      ...settings.ui,
      sounds: next.sounds,
      notifications: next.notifications,
      startWithWindows: next.startWithWindows
    },
    logLevel: next.logLevel
  }
}

/** Reset to defaults: the screen's fields only. The folder, setup progress and the rest stay. */
export function defaultEditable(): EditableSettings {
  return editable(defaultSettings())
}

const FIELD_BY_PATH: Readonly<Record<string, SettingsField>> = {
  hotkey: 'hotkey',
  micDeviceId: 'micDeviceId',
  'speech.modelId': 'modelId',
  'speech.endSilenceSec': 'endSilenceSec',
  'speech.maxRecordingSec': 'maxRecordingSec',
  'delivery.previewMs': 'previewMs',
  'delivery.queue': 'queue',
  'ui.sounds': 'sounds',
  'ui.notifications': 'notifications',
  'ui.startWithWindows': 'startWithWindows',
  logLevel: 'logLevel'
}

/** Which field on the screen a schema problem belongs to, and what to say about it. */
export function fieldError(path: readonly PropertyKey[]): {
  field: SettingsField
  message: string
} {
  const field = FIELD_BY_PATH[path.map(String).join('.')] ?? 'hotkey'
  const range = field in RANGES ? RANGES[field as keyof typeof RANGES] : undefined
  const message =
    range === undefined
      ? 'That value isn’t allowed.'
      : `Choose from ${String(range.min)} to ${String(range.max)} ${range.unit}.`
  return { field, message }
}

/** Shown as the system default when the saved one isn't plugged in, as getUserMedia falls back. */
export function shownMicrophone(
  saved: string | null,
  plugged: readonly { readonly deviceId: string }[]
): string | null {
  return plugged.some(({ deviceId }) => deviceId === saved) ? saved : null
}

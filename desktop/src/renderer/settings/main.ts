import type { SettingsApi, SettingsResult, SettingsView } from '../../shared/ipcChannels'
import {
  captureHotkey,
  clashesWithAltGr,
  hotkeyLabel,
  RANGES,
  type EditableSettings,
  type SettingsField
} from '../../shared/settingsFields'

// The settings screen. Main checks and saves every change, so this only sends what the user
// changed and draws what comes back. Everything is shown with textContent, never as markup.

declare global {
  interface Window {
    readonly voiceupSettings: SettingsApi
  }
}

function element(id: string): HTMLElement {
  const found = document.getElementById(id)
  if (found === null) throw new Error(`The settings page is missing #${id}`)
  return found
}

const hotkeyValue = element('hotkey-value')
const hotkeyChange = element('hotkey-change') as HTMLButtonElement
const hotkeyHelp = element('hotkey-help')
const hotkeyWarning = element('hotkey-warning')
const mic = element('micDeviceId') as HTMLSelectElement
const model = element('modelId') as HTMLSelectElement
const modelStatus = element('model-status')
const modelProgress = element('model-progress') as HTMLProgressElement
const modelRetry = element('model-retry') as HTMLButtonElement
const startNote = element('start-note')
const debugWarning = element('debug-warning')
const reset = element('reset') as HTMLButtonElement
const status = element('status')

for (const [field, range] of Object.entries(RANGES)) {
  const input = element(field) as HTMLInputElement
  input.min = String(range.min)
  input.max = String(range.max)
  input.step = String(range.step)
}

let listening = false
let shownHotkey = ''

function options(
  select: HTMLSelectElement,
  items: readonly { value: string; label: string }[]
): void {
  select.replaceChildren(
    ...items.map(({ value, label }) => {
      const option = document.createElement('option')
      option.value = value
      option.textContent = label
      return option
    })
  )
}

function showErrors(errors: Partial<Record<SettingsField, string>>): void {
  for (const node of document.querySelectorAll<HTMLElement>('[data-error-for]')) {
    const message = errors[node.dataset['errorFor'] as SettingsField]
    node.textContent = message ?? ''
    node.hidden = message === undefined
  }
}

function draw(view: SettingsView): void {
  const { values } = view
  shownHotkey = values.hotkey
  if (!listening) hotkeyValue.textContent = hotkeyLabel(values.hotkey)
  hotkeyWarning.hidden = !clashesWithAltGr(values.hotkey)

  options(mic, [
    { value: '', label: 'System default' },
    ...view.microphones.map(({ deviceId, label }) => ({ value: deviceId, label }))
  ])
  mic.value = values.micDeviceId ?? ''

  options(
    model,
    view.models.map(({ id, label, size, installed }) => ({
      value: id,
      label: installed ? label : `${label}, downloads ${size}`
    }))
  )
  model.value = view.models.find((entry) => entry.chosen)?.id ?? ''
  const { phase, percent } = view.model
  modelStatus.textContent =
    phase === 'ready'
      ? 'Installed.'
      : phase === 'failed'
        ? 'The download failed.'
        : phase === 'unpacking'
          ? 'Unpacking…'
          : phase === 'downloading'
            ? `Downloading, ${String(percent)}%`
            : 'Waiting to download.'
  modelProgress.hidden = phase !== 'downloading' && phase !== 'unpacking'
  modelProgress.value = percent
  modelRetry.hidden = phase !== 'failed'

  for (const field of ['endSilenceSec', 'maxRecordingSec', 'previewMs'] as const) {
    const input = element(field) as HTMLInputElement
    // Never under the user's cursor: that would undo what they are typing.
    if (document.activeElement !== input) input.value = String(values[field])
  }
  for (const field of ['queue', 'sounds', 'notifications', 'startWithWindows'] as const) {
    ;(element(field) as HTMLInputElement).checked = values[field]
  }
  const start = element('startWithWindows') as HTMLInputElement
  start.disabled = !view.canStartWithWindows
  startNote.hidden = view.canStartWithWindows
  const logLevel = element('logLevel') as HTMLSelectElement
  logLevel.value = values.logLevel
  debugWarning.hidden = values.logLevel !== 'debug'
}

async function send(request: () => Promise<SettingsResult>, done: string): Promise<void> {
  try {
    const result = await request()
    if (result.data !== null) draw(result.data)
    showErrors(result.ok ? {} : result.errors)
    status.textContent = result.ok ? done : 'Not saved: see above.'
  } catch (failure: unknown) {
    // A warning: the smoke test loads this page with nothing in main to answer it.
    console.warn('The settings did not respond', failure)
    status.textContent = 'Something went wrong. Close this window and open it again.'
  }
}

function change(changes: Partial<EditableSettings>): void {
  void send(() => window.voiceupSettings.set(changes), 'Saved.')
}

for (const input of document.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
  '[data-field]'
)) {
  input.addEventListener('change', () => {
    const field = input.dataset['field'] as SettingsField
    if (input instanceof HTMLInputElement && input.type === 'checkbox') {
      change({ [field]: input.checked })
    } else if (input instanceof HTMLInputElement && input.type === 'number') {
      // An empty or partial number reaches main as NaN, which it refuses with the range.
      change({ [field]: input.valueAsNumber })
    } else if (field === 'micDeviceId') {
      change({ micDeviceId: input.value === '' ? null : input.value })
    } else {
      change({ [field]: input.value })
    }
  })
}

function stopListening(): void {
  listening = false
  hotkeyValue.dataset['listening'] = 'false'
  hotkeyValue.textContent = hotkeyLabel(shownHotkey)
  hotkeyHelp.hidden = true
  hotkeyChange.textContent = 'Change'
}

hotkeyChange.addEventListener('click', () => {
  if (listening) {
    stopListening()
    return
  }
  listening = true
  hotkeyValue.dataset['listening'] = 'true'
  hotkeyValue.textContent = 'Press keys…'
  hotkeyHelp.hidden = false
  hotkeyChange.textContent = 'Cancel'
  showErrors({})
})

document.addEventListener('keydown', (event) => {
  if (!listening) return
  event.preventDefault()
  if (event.code === 'Escape') {
    stopListening()
    return
  }
  const captured = captureHotkey(event)
  if (captured.kind === 'waiting') return
  if (captured.kind === 'invalid') {
    showErrors({ hotkey: captured.reason })
    return
  }
  shownHotkey = captured.accelerator
  stopListening()
  change({ hotkey: captured.accelerator })
})

modelRetry.addEventListener('click', () => {
  void send(() => window.voiceupSettings.retryModel(), 'Trying again.')
})
reset.addEventListener('click', () => {
  void send(() => window.voiceupSettings.reset(), 'Reset to defaults.')
})
window.voiceupSettings.onChanged(draw)
void send(() => window.voiceupSettings.get(), '')

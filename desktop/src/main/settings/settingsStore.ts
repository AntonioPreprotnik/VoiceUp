import { Settings } from '../../shared/settings'
import { log } from '../log'

export type SettingsListener = (next: Settings, previous: Settings) => void

/**
 * The one copy of the settings while the app runs. Every change is checked against the schema
 * before anything sees it, saved, and then announced, so no part of the app reads a stale copy.
 */
export class SettingsStore {
  private value: Settings
  private readonly listeners = new Set<SettingsListener>()

  constructor(
    initial: Settings,
    private readonly persist: (settings: Settings) => void
  ) {
    this.value = initial
  }

  get current(): Settings {
    return this.value
  }

  /** False, with nothing changed, if the result doesn't match the schema. */
  update(change: (current: Settings) => Settings): boolean {
    const parsed = Settings.safeParse(change(this.value))
    if (!parsed.success) {
      // The values may be anything a page sent, so only the field names are logged.
      const fields = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')
      log.warn(`Refused a settings change: ${fields}`)
      return false
    }
    const previous = this.value
    this.value = parsed.data
    try {
      this.persist(this.value)
    } catch (error: unknown) {
      log.error('Could not save settings; the change applies to this run only', error)
    }
    for (const listener of this.listeners) listener(this.value, previous)
    return true
  }

  /** Returns the function that unsubscribes. */
  subscribe(listener: SettingsListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
}

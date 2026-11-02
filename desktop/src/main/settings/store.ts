import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { defaultSettings, migrate } from '../../core/settingsMigrate'
import { Settings } from '../../shared/settings'

const FILE_NAME = 'settings.json'

export interface SettingsLog {
  warn(message: string): void
  error(message: string, error: unknown): void
}

/** Writes through a temp file and a rename, so a crash can't leave half a settings file. */
export function saveSettings(dir: string, settings: Settings): void {
  const validated = Settings.parse(settings)
  const target = join(dir, FILE_NAME)
  const temp = `${target}.${String(process.pid)}.tmp`
  writeFileSync(temp, JSON.stringify(validated, null, 2))
  renameSync(temp, target)
}

function trySave(dir: string, settings: Settings, log: SettingsLog): void {
  try {
    saveSettings(dir, settings)
  } catch (error: unknown) {
    log.error('Could not save settings; using them for this run only', error)
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown
  } catch {
    // Reported by the caller, which moves the file aside. The content is never logged.
    return undefined
  }
}

/** Moves a bad file aside and starts from defaults. Keeps the file if it can't be moved. */
function replaceUnusable(dir: string, now: number, log: SettingsLog): Settings {
  const settings = defaultSettings()
  const badName = `settings.bad-${String(now)}.json`
  try {
    renameSync(join(dir, FILE_NAME), join(dir, badName))
    log.warn(`Settings file could not be used; moved it to ${badName} and restored defaults`)
    trySave(dir, settings, log)
  } catch (error: unknown) {
    log.error('Could not move the bad settings file; using defaults for this run only', error)
  }
  return settings
}

/** Never throws: the app must not fail to start over settings (TECH_SPEC §6.4). */
export function loadSettings(dir: string, log: SettingsLog, now: number = Date.now()): Settings {
  let text: string
  try {
    text = readFileSync(join(dir, FILE_NAME), 'utf8')
  } catch (error: unknown) {
    if (!isMissingFile(error)) {
      log.error('Could not read the settings file', error)
      return replaceUnusable(dir, now, log)
    }
    const settings = defaultSettings()
    trySave(dir, settings, log)
    return settings
  }

  const raw = parseJson(text)
  const settings = migrate(raw)
  if (settings === null) return replaceUnusable(dir, now, log)

  // Persist what migration changed: filled defaults, stripped keys, a newer version.
  if (JSON.stringify(raw) !== JSON.stringify(settings)) trySave(dir, settings, log)
  return settings
}

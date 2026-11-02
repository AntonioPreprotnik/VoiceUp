import { Settings } from '../shared/settings'

export const CURRENT_SETTINGS_VERSION = 1

type RawSettings = Record<string, unknown>
export type SettingsUpgrades = Readonly<Partial<Record<number, (raw: RawSettings) => RawSettings>>>

// Upgrades key on the version they upgrade from. Add one when the schema version changes.
const UPGRADES: SettingsUpgrades = {}

export function defaultSettings(): Settings {
  return Settings.parse({ version: CURRENT_SETTINGS_VERSION })
}

function isRecord(value: unknown): value is RawSettings {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** One upgrade step, or null if it throws or does not raise the version (no hang at startup). */
function upgradeOnce(
  raw: RawSettings,
  version: number,
  upgrades: SettingsUpgrades
): RawSettings | null {
  const upgrade = upgrades[version]
  if (upgrade === undefined) return null
  try {
    const upgraded = upgrade(raw)
    const next = upgraded['version']
    return typeof next === 'number' && next > version ? upgraded : null
  } catch {
    // The caller treats null as unusable settings; the store logs that and moves the file aside.
    return null
  }
}

/**
 * Upgrades raw settings by version, strips unknown keys and fills defaults. Returns null when they
 * can't be used: not an object, no valid version, a version with no upgrade path, or a bad value.
 */
export function migrate(
  raw: unknown,
  upgrades: SettingsUpgrades = UPGRADES,
  currentVersion: number = CURRENT_SETTINGS_VERSION
): Settings | null {
  if (!isRecord(raw)) return null
  let current = raw

  for (;;) {
    const version = current['version']
    if (typeof version !== 'number' || !Number.isInteger(version)) return null
    if (version >= currentVersion) break
    const upgraded = upgradeOnce(current, version, upgrades)
    if (upgraded === null) return null
    current = upgraded
  }

  const parsed = Settings.safeParse(current)
  return parsed.success ? parsed.data : null
}

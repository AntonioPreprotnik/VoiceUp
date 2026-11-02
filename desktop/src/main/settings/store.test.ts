import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { defaultSettings } from '../../core/settingsMigrate'
import { loadSettings, saveSettings, type SettingsLog } from './store'

let dir: string
let warnings: string[]
let errors: string[]
const log: SettingsLog = {
  warn: (message) => warnings.push(message),
  error: (message) => errors.push(message)
}

const settingsPath = (): string => join(dir, 'settings.json')
const readSaved = (): unknown => JSON.parse(readFileSync(settingsPath(), 'utf8'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'voiceup-settings-'))
  warnings = []
  errors = []
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('loadSettings', () => {
  it('creates the file with defaults on first run', () => {
    expect(loadSettings(dir, log)).toEqual(defaultSettings())
    expect(readSaved()).toEqual(defaultSettings())
    expect(warnings).toEqual([])
    expect(errors).toEqual([])
  })

  it('returns what was saved', () => {
    const settings = { ...defaultSettings(), hotkey: 'Alt+V' }
    saveSettings(dir, settings)
    expect(loadSettings(dir, log)).toEqual(settings)
  })

  it('does not rewrite a file that needs no change', () => {
    saveSettings(dir, defaultSettings())
    const custom = JSON.stringify(defaultSettings(), null, 4)
    writeFileSync(settingsPath(), custom)
    loadSettings(dir, log)
    expect(readFileSync(settingsPath(), 'utf8')).toBe(custom)
  })

  it('saves unknown keys stripped and missing fields filled', () => {
    writeFileSync(settingsPath(), JSON.stringify({ version: 1, oldField: 1, hotkey: 'Alt+V' }))
    const settings = loadSettings(dir, log)
    expect(settings.hotkey).toBe('Alt+V')
    expect(readSaved()).toEqual({ ...defaultSettings(), hotkey: 'Alt+V' })
  })

  it.each([
    ['corrupt JSON', '{ not json'],
    ['an empty file', ''],
    ['a bad value', JSON.stringify({ version: 1, ui: { fontSize: 1000 } })],
    ['a newer version', JSON.stringify({ version: 99 })]
  ])('moves %s aside and restores defaults', (_label, content) => {
    writeFileSync(settingsPath(), content)
    expect(loadSettings(dir, log, 1234)).toEqual(defaultSettings())
    expect(readFileSync(join(dir, 'settings.bad-1234.json'), 'utf8')).toBe(content)
    expect(readSaved()).toEqual(defaultSettings())
    expect(warnings).toHaveLength(1)
  })

  it('never logs the content of a bad file', () => {
    writeFileSync(settingsPath(), '{ "secret-content": ')
    loadSettings(dir, log, 1234)
    expect(warnings.join(' ')).not.toContain('secret-content')
  })

  it('still returns defaults when the folder is missing, so nothing can be saved', () => {
    const missing = join(dir, 'does-not-exist')
    expect(loadSettings(missing, log)).toEqual(defaultSettings())
    expect(errors).toHaveLength(1)
  })

  it('returns defaults when a directory sits at the settings path', () => {
    mkdirSync(settingsPath())
    expect(loadSettings(dir, log, 1234)).toEqual(defaultSettings())
    expect(errors).toHaveLength(1)
    expect(readSaved()).toEqual(defaultSettings())
  })
})

describe('saveSettings', () => {
  it('leaves no temp file behind', () => {
    saveSettings(dir, defaultSettings())
    expect(readdirSync(dir)).toEqual(['settings.json'])
  })

  it('refuses invalid settings and keeps the existing file', () => {
    saveSettings(dir, defaultSettings())
    const invalid = { ...defaultSettings(), logLevel: 'trace' } as never
    expect(() => {
      saveSettings(dir, invalid)
    }).toThrow()
    expect(readSaved()).toEqual(defaultSettings())
  })
})

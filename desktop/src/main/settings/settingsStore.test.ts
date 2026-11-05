import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defaultSettings } from '../../core/settingsMigrate'
import type { Settings } from '../../shared/settings'
import fakeLog from '../../../test/fakes/electronLog'
import { SettingsStore } from './settingsStore'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const persist = vi.fn<(settings: Settings) => void>()
let store: SettingsStore

beforeEach(() => {
  vi.resetAllMocks()
  store = new SettingsStore(defaultSettings(), persist)
})

describe('SettingsStore', () => {
  it('keeps one current copy, which a change replaces', () => {
    store.update((current) => ({ ...current, hotkey: 'Alt+V' }))
    expect(store.current.hotkey).toBe('Alt+V')
  })

  it('saves each change, then tells every listener, with the old value too', () => {
    const order: string[] = []
    persist.mockImplementation(() => order.push('saved'))
    store.subscribe((next, previous) => {
      order.push(`${previous.hotkey} -> ${next.hotkey}`)
    })
    store.update((current) => ({ ...current, hotkey: 'Alt+V' }))
    expect(order).toEqual(['saved', 'Control+Shift+Space -> Alt+V'])
    expect(persist).toHaveBeenCalledWith(expect.objectContaining({ hotkey: 'Alt+V' }))
  })

  it('refuses a change that breaks the schema, changing and saving nothing', () => {
    const listener = vi.fn()
    store.subscribe(listener)
    const changed = store.update((current) => ({
      ...current,
      speech: { ...current.speech, maxRecordingSec: 9999 }
    }))
    expect(changed).toBe(false)
    expect(store.current.speech.maxRecordingSec).toBe(60)
    expect(persist).not.toHaveBeenCalled()
    expect(listener).not.toHaveBeenCalled()
  })

  it('logs which field was refused, never its value', () => {
    store.update((current) => ({ ...current, hotkey: 42 as unknown as string }))
    const warnings = JSON.stringify(fakeLog.messages('warn'))
    expect(warnings).toContain('hotkey')
    expect(warnings).not.toContain('42')
  })

  it('keeps a change for this run when it can not be saved', () => {
    persist.mockImplementation(() => {
      throw new Error('disk full')
    })
    expect(store.update((current) => ({ ...current, hotkey: 'Alt+V' }))).toBe(true)
    expect(store.current.hotkey).toBe('Alt+V')
    expect(fakeLog.messages('error')).toHaveLength(1)
  })

  it('stops telling a listener that unsubscribed', () => {
    const listener = vi.fn()
    store.subscribe(listener)()
    store.update((current) => ({ ...current, hotkey: 'Alt+V' }))
    expect(listener).not.toHaveBeenCalled()
  })
})

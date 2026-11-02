import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { BrowserWindow as RealBrowserWindow } from 'electron'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { BrowserWindow, dialog, resetFakes } from '../../../test/fakes/electron'
import fakeLog from '../../../test/fakes/electronLog'
import { lastPty, resetFakePty, spawned } from '../../../test/fakes/nodePty'
import { defaultSettings } from '../../core/settingsMigrate'
import { ClaudeSession } from './session'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))
vi.mock('node-pty', () => import('../../../test/fakes/nodePty'))

let root: string
let settingsDir: string
let folderA: string
let folderB: string
let window: BrowserWindow

function createSession(projectDir: string | null = null): ClaudeSession {
  const defaults = defaultSettings()
  return new ClaudeSession({
    window: window as unknown as RealBrowserWindow,
    settings: { ...defaults, claude: { ...defaults.claude, projectDir } },
    settingsDir,
    resolveCommand: () => Promise.resolve({ file: 'claude.exe', args: [] })
  })
}

function savedFolder(): unknown {
  const saved = JSON.parse(readFileSync(join(settingsDir, 'settings.json'), 'utf8')) as {
    claude: { projectDir: unknown }
  }
  return saved.claude.projectDir
}

function output(): string {
  return window.webContents.sent.map(([, payload]) => String(payload)).join('')
}

async function spawnedCount(count: number): Promise<void> {
  await vi.waitFor(() => {
    expect(spawned).toHaveLength(count)
  })
}

beforeEach(() => {
  resetFakes()
  resetFakePty()
  root = mkdtempSync(join(tmpdir(), 'voiceup-session-'))
  settingsDir = join(root, 'settings')
  folderA = join(root, 'a')
  folderB = join(root, 'b')
  for (const dir of [settingsDir, folderA, folderB]) mkdirSync(dir)
  window = new BrowserWindow({})
  window.visible = true
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the first launch', () => {
  it('asks for a folder, remembers it and starts Claude there', async () => {
    dialog.answers.push(folderA)
    createSession().host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    expect(lastPty().options['cwd']).toBe(folderA)
    expect(savedFolder()).toBe(folderA)
  })

  it('asks for a directory, with the window as parent', async () => {
    dialog.answers.push(folderA)
    createSession().host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    expect(dialog.requests).toHaveLength(1)
    expect(dialog.requests[0]?.window).toBe(window)
    expect(dialog.requests[0]?.options['properties']).toEqual(['openDirectory'])
  })

  it('waits for the window to be visible before asking', async () => {
    window.visible = false
    dialog.answers.push(folderA)
    createSession().host.resize({ cols: 80, rows: 24 })
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(dialog.requests).toEqual([])
    window.visible = true
    window.emit('show')
    await spawnedCount(1)
  })

  it('does not ask when the window closes first', async () => {
    window.visible = false
    createSession().host.resize({ cols: 80, rows: 24 })
    window.destroyed = true
    window.emit('closed')
    await new Promise((resolve) => {
      setTimeout(resolve, 20)
    })
    expect(dialog.requests).toEqual([])
    expect(spawned).toEqual([])
  })

  it('explains the next step, and starts nothing, when cancelled', async () => {
    dialog.answers.push(null)
    createSession().host.resize({ cols: 80, rows: 24 })
    await vi.waitFor(() => {
      expect(output()).toContain('No project folder chosen')
    })
    expect(output()).toContain('File > Change folder')
    expect(spawned).toEqual([])
  })
})

describe('a later launch', () => {
  it('uses the remembered folder without asking', async () => {
    createSession(folderA).host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    expect(lastPty().options['cwd']).toBe(folderA)
    expect(dialog.requests).toEqual([])
  })

  it('asks again when the remembered folder is gone', async () => {
    dialog.answers.push(folderB)
    createSession(join(root, 'deleted')).host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    expect(lastPty().options['cwd']).toBe(folderB)
    expect(fakeLog.messages('warn')).toHaveLength(1)
  })

  it('asks again when the remembered path is now a file', async () => {
    dialog.answers.push(folderB)
    createSession(join(settingsDir, 'settings.json')).host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    expect(lastPty().options['cwd']).toBe(folderB)
  })
})

describe('changing folder', () => {
  it('restarts Claude in the new folder and remembers it', async () => {
    const session = createSession(folderA)
    session.host.resize({ cols: 90, rows: 30 })
    await spawnedCount(1)
    const first = lastPty()

    dialog.answers.push(folderB)
    const changed = session.changeFolder()
    await vi.waitFor(() => {
      expect(first.killCount).toBe(1)
    })
    first.emitExit(0)
    await changed

    expect(spawned).toHaveLength(2)
    expect(lastPty().options).toMatchObject({ cwd: folderB, cols: 90, rows: 30 })
    expect(savedFolder()).toBe(folderB)
  })

  it('clears the screen for the new session', async () => {
    const session = createSession(folderA)
    session.host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    dialog.answers.push(folderB)
    const changed = session.changeFolder()
    await vi.waitFor(() => {
      expect(lastPty().killCount).toBe(1)
    })
    lastPty().emitExit(0)
    await changed
    expect(output()).toContain('\x1bc')
  })

  it('leaves the session alone when cancelled', async () => {
    const session = createSession(folderA)
    session.host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    dialog.answers.push(null)
    await session.changeFolder()
    expect(lastPty().killCount).toBe(0)
    expect(spawned).toHaveLength(1)
  })

  it('offers the current folder as the starting point', async () => {
    const session = createSession(folderA)
    dialog.answers.push(null)
    await session.changeFolder()
    expect(dialog.requests[0]?.options['defaultPath']).toBe(folderA)
  })

  it('still restarts when the folder cannot be saved', async () => {
    settingsDir = join(root, 'missing-settings-folder')
    const session = createSession(folderA)
    dialog.answers.push(folderB)
    await session.changeFolder()
    await spawnedCount(0)
    session.host.resize({ cols: 80, rows: 24 })
    await spawnedCount(1)
    expect(lastPty().options['cwd']).toBe(folderB)
    expect(fakeLog.messages('error')).toHaveLength(1)
  })

  it('starts a session after the first picker was cancelled', async () => {
    const session = createSession()
    dialog.answers.push(null)
    session.host.resize({ cols: 80, rows: 24 })
    await vi.waitFor(() => {
      expect(output()).toContain('No project folder chosen')
    })
    dialog.answers.push(folderA)
    await session.changeFolder()
    expect(spawned).toHaveLength(1)
    expect(lastPty().options['cwd']).toBe(folderA)
  })
})

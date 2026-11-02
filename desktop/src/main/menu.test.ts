import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { app, Menu, resetFakes, shell } from '../../test/fakes/electron'
import fakeLog from '../../test/fakes/electronLog'
import { installAppMenu } from './menu'

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))

interface TemplateItem {
  label?: string
  role?: string
  accelerator?: string
  click?: () => void
  submenu?: TemplateItem[]
}

function actions(): { changeFolder: () => Promise<void>; changeFontSize: Mock } {
  return { changeFolder: () => Promise.resolve(), changeFontSize: vi.fn() }
}

function template(): TemplateItem[] {
  return Menu.installed as TemplateItem[]
}

function clickOpenLogs(): void {
  const help = template().find((item) => item.label === 'Help')
  const item = help?.submenu?.find((entry) => entry.label === 'Open logs folder')
  if (item?.click === undefined) throw new Error('No Open logs folder item')
  item.click()
}

beforeEach(resetFakes)

describe('the app menu', () => {
  it('has only Help when packaged, so no reload or DevTools', () => {
    installAppMenu()
    expect(template().map((item) => item.label)).toEqual(['Help'])
  })

  it('adds File and View only when there is a session to change', () => {
    installAppMenu(actions())
    expect(template().map((item) => item.label)).toEqual(['File', 'View', 'Help'])
  })

  it.each([
    ['Larger text', 'larger', 'Ctrl+Shift+='],
    ['Smaller text', 'smaller', 'Ctrl+Shift+-'],
    ['Default text size', 'reset', 'Ctrl+Shift+0']
  ])('%s changes the font size', (label, change, accelerator) => {
    const session = actions()
    installAppMenu(session)
    const view = template().find((item) => item.label === 'View')
    const entry = view?.submenu?.find((item) => item.label === label)
    expect(entry?.accelerator).toBe(accelerator)
    entry?.click?.()
    expect(session.changeFontSize).toHaveBeenCalledWith(change)
  })

  it('runs Change folder and logs a failure', async () => {
    const change = vi.fn(() => Promise.reject(new Error('boom')))
    installAppMenu({ ...actions(), changeFolder: change })
    const file = template().find((item) => item.label === 'File')
    file?.submenu?.find((entry) => entry.label === 'Change folder...')?.click?.()
    expect(change).toHaveBeenCalledOnce()
    await vi.waitFor(() => {
      expect(fakeLog.messages('error')).toHaveLength(1)
    })
  })

  it('adds reload and DevTools when unpackaged', () => {
    app.isPackaged = false
    installAppMenu()
    expect(template().map((item) => item.label)).toEqual(['Help', 'Developer'])
  })

  it('opens the logs folder', async () => {
    installAppMenu()
    clickOpenLogs()
    await vi.waitFor(() => {
      expect(shell.opened).toEqual([app.getPath('logs')])
    })
    expect(fakeLog.messages('error')).toEqual([])
  })

  it('logs when the folder cannot be opened', async () => {
    shell.failure = 'no handler'
    installAppMenu()
    clickOpenLogs()
    await vi.waitFor(() => {
      expect(fakeLog.messages('error')).toHaveLength(1)
    })
  })
})

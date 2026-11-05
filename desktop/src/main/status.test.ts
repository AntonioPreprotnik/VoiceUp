import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import { BrowserWindow, Notification, resetFakes, Tray } from '../../test/fakes/electron'
import { statusView } from '../core/state/status'
import { Channels } from '../shared/ipcChannels'
import { ClaudeStatus } from './status'

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))

let window: BrowserWindow
let reArm: Mock
let showWindow: Mock
let quit: Mock

function create(notifications = true): ClaudeStatus {
  return new ClaudeStatus({
    window: window as unknown as Electron.BrowserWindow,
    notifications,
    reArm,
    showWindow,
    quit,
    openSettings: () => undefined
  })
}

function tray(): Tray {
  const created = Tray.instances.at(-1)
  if (created === undefined) throw new Error('No tray')
  return created
}

interface MenuItem {
  label?: string
  enabled?: boolean
  click?: () => void
}

function menuItem(label: string): MenuItem {
  const item = (tray().menu as MenuItem[]).find((entry) => entry.label === label)
  if (item === undefined) throw new Error(`No menu item ${label}`)
  return item
}

beforeEach(() => {
  resetFakes()
  window = new BrowserWindow({})
  reArm = vi.fn()
  showWindow = vi.fn()
  quit = vi.fn()
})

describe('showing a state', () => {
  it('tells the terminal window', () => {
    const view = statusView('idle', null)
    create().show(view)
    expect(window.webContents.sent).toEqual([[Channels.stateChanged, view]])
  })

  it('mirrors it in the tray: its color and its label', () => {
    const status = create()
    status.show(statusView('idle', null))
    const ready = tray().image
    expect(tray().tooltip).toBe('VoiceUp: Ready')
    status.show(statusView('busy', null))
    expect(tray().tooltip).toBe('VoiceUp: Working')
    expect(tray().image).not.toEqual(ready)
  })

  it('remembers the latest, for a page that loads later', () => {
    const status = create()
    expect(status.current).toBeUndefined()
    const view = statusView('busy', null)
    status.show(view)
    expect(status.current).toEqual(view)
  })

  it('sends nothing when nothing changed', () => {
    const status = create()
    status.show(statusView('idle', null))
    status.show(statusView('idle', null))
    expect(window.webContents.sent).toHaveLength(1)
  })

  it('survives the window being gone', () => {
    const status = create()
    window.destroyed = true
    expect(() => {
      status.show(statusView('idle', null))
    }).not.toThrow()
  })
})

describe('the queue', () => {
  const queue = [{ id: '1', preview: 'run the tests' }]

  it('tells the terminal window when only the queue changed', () => {
    const status = create()
    status.show(statusView('busy', null))
    status.show(statusView('busy', null, queue))
    expect(window.webContents.sent.at(-1)).toEqual([
      Channels.stateChanged,
      statusView('busy', null, queue)
    ])
    expect(window.webContents.sent).toHaveLength(2)
  })

  it('counts it in the tray, without its text', () => {
    const status = create()
    status.show(statusView('busy', null, queue))
    expect(tray().tooltip).toBe('VoiceUp: Working (1 queued)')
  })
})

describe('the tray menu', () => {
  it('offers re-arm only while unknown', () => {
    const status = create()
    status.show(statusView('idle', null))
    expect(menuItem('Re-arm voice').enabled).toBe(false)
    status.show(statusView('unknown', null))
    expect(menuItem('Re-arm voice').enabled).toBe(true)
    menuItem('Re-arm voice').click?.()
    expect(reArm).toHaveBeenCalledOnce()
  })

  it('shows the window and quits', () => {
    create().show(statusView('idle', null))
    menuItem('Show VoiceUp').click?.()
    expect(showWindow).toHaveBeenCalledOnce()
    menuItem('Quit').click?.()
    expect(quit).toHaveBeenCalledOnce()
  })

  it('shows the window on a click on the icon', () => {
    create()
    tray().emit('click')
    expect(showWindow).toHaveBeenCalledOnce()
  })

  it('is removed on destroy, so no ghost icon stays behind', () => {
    create().destroy()
    expect(tray().destroyed).toBe(true)
  })
})

describe('notifications', () => {
  it('appears when Claude finishes and the window is not focused', () => {
    window.focused = false
    create().notify('busy', 'idle')
    expect(Notification.shown.map(({ options }) => options.title)).toEqual(['Claude finished'])
  })

  it('appears when Claude needs permission', () => {
    window.focused = false
    create().notify('idle', 'awaitingPermission')
    expect(Notification.shown.map(({ options }) => options.title)).toEqual([
      'Claude needs your permission'
    ])
  })

  it('stays quiet while the user is looking at the window', () => {
    window.focused = true
    create().notify('busy', 'idle')
    expect(Notification.shown).toEqual([])
  })

  it('stays quiet when turned off', () => {
    window.focused = false
    create(false).notify('busy', 'idle')
    expect(Notification.shown).toEqual([])
  })

  it('stays quiet for a change nobody needs to hear about', () => {
    window.focused = false
    create().notify('idle', 'busy')
    expect(Notification.shown).toEqual([])
  })

  it('stays quiet where Windows has none', () => {
    window.focused = false
    Notification.supported = false
    create().notify('busy', 'idle')
    expect(Notification.shown).toEqual([])
  })

  it('opens the window on a click', () => {
    window.focused = false
    create().notify('busy', 'idle')
    Notification.shown.at(0)?.emit('click')
    expect(showWindow).toHaveBeenCalledOnce()
  })
})

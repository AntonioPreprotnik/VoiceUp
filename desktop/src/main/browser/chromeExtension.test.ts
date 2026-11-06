import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  EXTENSION_ID,
  findBrowsers,
  openForTest,
  openStore,
  STORE_URL,
  type Disk,
  type Places
} from './chromeExtension'

vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const PLACES: Places = {
  programFiles: 'C:\\Program Files',
  programFilesX86: 'C:\\Program Files (x86)',
  localAppData: 'C:\\Users\\a\\AppData\\Local'
}
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
const CHROME_DATA = 'C:\\Users\\a\\AppData\\Local\\Google\\Chrome\\User Data'
const BRAVE_USER =
  'C:\\Users\\a\\AppData\\Local\\BraveSoftware\\Brave-Browser\\Application\\brave.exe'
const BRAVE_DATA = 'C:\\Users\\a\\AppData\\Local\\BraveSoftware\\Brave-Browser\\User Data'

/** A disk that has only the paths and folders given, and records every path asked about. */
function disk(files: string[], folders: Record<string, string[]> = {}): Disk & { asked: string[] } {
  const asked: string[] = []
  return {
    asked,
    exists: (path) => {
      asked.push(path)
      return files.includes(path)
    },
    folders: (path) => {
      asked.push(path)
      return folders[path] ?? []
    }
  }
}

const extensionIn = (data: string, profile: string): string =>
  `${data}\\${profile}\\Extensions\\${EXTENSION_ID}`

describe('findBrowsers', () => {
  it('finds nothing on a PC without Chrome or Brave', () => {
    expect(findBrowsers(PLACES, disk([]))).toEqual([
      { browser: 'chrome', installed: false, extension: false },
      { browser: 'brave', installed: false, extension: false }
    ])
  })

  it('finds a browser installed for this user only, and the extension in a second profile', () => {
    const found = findBrowsers(
      PLACES,
      disk([BRAVE_USER, extensionIn(BRAVE_DATA, 'Profile 2')], {
        [BRAVE_DATA]: ['Default', 'Profile 2', 'Crashpad']
      })
    )
    expect(found[1]).toEqual({ browser: 'brave', installed: true, extension: true })
  })

  it('reports Chrome without the extension', () => {
    expect(findBrowsers(PLACES, disk([CHROME], { [CHROME_DATA]: ['Default'] }))[0]).toEqual({
      browser: 'chrome',
      installed: true,
      extension: false
    })
  })

  it('looks only at profile folders, and only for the extension folder in them', () => {
    const fake = disk([CHROME, `${CHROME_DATA}\\System Profile\\Extensions\\${EXTENSION_ID}`], {
      [CHROME_DATA]: ['System Profile', 'Default', 'Guest Profile']
    })
    expect(findBrowsers(PLACES, fake)[0]?.extension).toBe(false)
    const inProfiles = fake.asked.filter((path) => path.startsWith(`${CHROME_DATA}\\`))
    expect(inProfiles).toEqual([extensionIn(CHROME_DATA, 'Default')])
  })
})

describe('openStore', () => {
  const launch = vi.fn<(program: string, args: readonly string[]) => void>()
  beforeEach(() => {
    launch.mockReset()
  })

  it("starts the browser's own program with the fixed store address only", () => {
    expect(openStore('chrome', PLACES, disk([CHROME]), launch)).toBe(true)
    expect(launch).toHaveBeenCalledExactlyOnceWith(CHROME, [STORE_URL])
    expect(STORE_URL).toBe(
      'https://chromewebstore.google.com/detail/claude/fcoeoabgfenejglbffodgkkbkcdhcgfn'
    )
  })

  it('starts nothing when that browser is not installed', () => {
    expect(openStore('brave', PLACES, disk([CHROME]), launch)).toBe(false)
    expect(launch).not.toHaveBeenCalled()
  })
})

describe('openForTest', () => {
  const launch = vi.fn<(program: string, args: readonly string[]) => void>()
  const isRunning = vi.fn<(exe: string) => Promise<boolean>>()
  beforeEach(() => {
    launch.mockReset()
    isRunning.mockReset()
  })

  it('starts the browser, with no page, when it is not running', async () => {
    isRunning.mockResolvedValue(false)
    await expect(openForTest('chrome', PLACES, disk([CHROME]), isRunning, launch)).resolves.toBe(
      'started'
    )
    expect(isRunning).toHaveBeenCalledWith('chrome.exe')
    expect(launch).toHaveBeenCalledExactlyOnceWith(CHROME, [])
  })

  it('leaves a running browser alone', async () => {
    isRunning.mockResolvedValue(true)
    await expect(openForTest('brave', PLACES, disk([BRAVE_USER]), isRunning, launch)).resolves.toBe(
      'running'
    )
    expect(isRunning).toHaveBeenCalledWith('brave.exe')
    expect(launch).not.toHaveBeenCalled()
  })

  it('starts nothing without a browser to start', async () => {
    await expect(openForTest(null, PLACES, disk([CHROME]), isRunning, launch)).resolves.toBe('none')
    await expect(openForTest('brave', PLACES, disk([CHROME]), isRunning, launch)).resolves.toBe(
      'none'
    )
    expect(launch).not.toHaveBeenCalled()
  })
})

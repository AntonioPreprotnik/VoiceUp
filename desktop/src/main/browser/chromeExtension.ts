import { execFile, spawn } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { win32 } from 'node:path'
import type { BrowserFinding } from '../../core/chromeStep'
import type { ChromeBrowser } from '../../shared/ipcChannels'
import { log } from '../log'
import { system32Path } from '../pty/resolveClaude'

// Windows paths on any host, so the tests read the same everywhere.
const join = (...parts: string[]): string => win32.join(...parts)

/** Claude in Chrome, by Anthropic (Claude Code's Chrome docs). */
export const EXTENSION_ID = 'fcoeoabgfenejglbffodgkkbkcdhcgfn'
export const STORE_URL = `https://chromewebstore.google.com/detail/claude/${EXTENSION_ID}`

/** The folders Windows names in the environment, which each browser installs under. */
export interface Places {
  readonly programFiles: string
  readonly programFilesX86: string
  readonly localAppData: string
}

const BROWSERS: Readonly<Record<ChromeBrowser, { readonly vendor: string; readonly exe: string }>> =
  {
    chrome: { vendor: 'Google\\Chrome', exe: 'chrome.exe' },
    brave: { vendor: 'BraveSoftware\\Brave-Browser', exe: 'brave.exe' }
  }

/** Where each browser's program can be: for all users, or for this user only. */
export function programPaths(browser: ChromeBrowser, places: Places): string[] {
  const { vendor, exe } = BROWSERS[browser]
  return [places.programFiles, places.programFilesX86, places.localAppData]
    .filter((root) => root !== '')
    .map((root) => join(root, vendor, 'Application', exe))
}

export function userDataPath(browser: ChromeBrowser, places: Places): string {
  return join(places.localAppData, BROWSERS[browser].vendor, 'User Data')
}

/** The profile folders Chromium makes. Anything else in User Data is not a profile. */
const PROFILE = /^(Default|Profile \d+)$/

/** Only these two calls touch the disk, so nothing else in a browser profile is read. */
export interface Disk {
  exists(path: string): boolean
  /** Folder names directly inside, or none if it can't be listed. */
  folders(path: string): string[]
}

export const realDisk: Disk = {
  exists: existsSync,
  folders: (path) => {
    try {
      return readdirSync(path, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch (error: unknown) {
      // Usual when the browser was never opened: there is no User Data yet.
      log.info(`No browser profiles to check: ${(error as NodeJS.ErrnoException).code ?? 'error'}`)
      return []
    }
  }
}

export function findBrowser(browser: ChromeBrowser, places: Places, disk: Disk): BrowserFinding {
  const program = programPaths(browser, places).find((path) => disk.exists(path))
  if (program === undefined) return { browser, installed: false, extension: false }
  const userData = userDataPath(browser, places)
  const extension = disk
    .folders(userData)
    .filter((name) => PROFILE.test(name))
    .some((profile) => disk.exists(join(userData, profile, 'Extensions', EXTENSION_ID)))
  return { browser, installed: true, extension }
}

export function findBrowsers(places: Places, disk: Disk = realDisk): BrowserFinding[] {
  return (Object.keys(BROWSERS) as ChromeBrowser[]).map((browser) =>
    findBrowser(browser, places, disk)
  )
}

/**
 * The real folders. An unpackaged build can point them at a test folder with
 * VOICEUP_TEST_BROWSER_ROOT, like VOICEUP_INSTALL_SCRIPT: a packaged build ignores it.
 */
export function browserPlaces(isPackaged: boolean): Places {
  const root = process.env['VOICEUP_TEST_BROWSER_ROOT']
  if (root !== undefined && !isPackaged) {
    return {
      programFiles: join(root, 'Program Files'),
      programFilesX86: join(root, 'Program Files (x86)'),
      localAppData: join(root, 'Local')
    }
  }
  return {
    programFiles: process.env['ProgramFiles'] ?? '',
    programFilesX86: process.env['ProgramFiles(x86)'] ?? '',
    localAppData: process.env['LOCALAPPDATA'] ?? ''
  }
}

export type Launch = (program: string, args: readonly string[]) => void

const launchDetached: Launch = (program, args) => {
  const child = spawn(program, args, { detached: true, stdio: 'ignore' })
  child.once('error', (error) => {
    log.warn('Could not open the browser:', error.message)
  })
  child.unref()
}

/** The browser's own program with the fixed store address, and nothing else on its command line. */
export function openStore(
  browser: ChromeBrowser,
  places: Places,
  disk: Disk = realDisk,
  launch: Launch = launchDetached
): boolean {
  const program = programPaths(browser, places).find((path) => disk.exists(path))
  if (program === undefined) {
    log.warn(`Could not open the Web Store: ${browser} isn't installed`)
    return false
  }
  launch(program, [STORE_URL])
  log.info(`Opened the Claude in Chrome page in ${browser}`)
  return true
}

/** Whether a program with this file name is running, from Windows' own task list. */
export type IsRunning = (exe: string) => Promise<boolean>

const isRunningReal: IsRunning = (exe) =>
  new Promise((resolve) => {
    execFile(
      system32Path('tasklist.exe'),
      ['/FI', `IMAGENAME eq ${exe}`, '/FO', 'CSV', '/NH'],
      { windowsHide: true, timeout: 10000 },
      (error, stdout) => {
        if (error !== null) {
          log.warn('Could not read the task list:', error.message)
          // Unknown: starting the browser again only opens one more window.
          resolve(false)
          return
        }
        resolve(stdout.toLowerCase().includes(`"${exe.toLowerCase()}"`))
      }
    )
  })

export type BrowserOpened = 'started' | 'running' | 'none'

/**
 * Before the browser test (S6.9): Claude in Chrome can only connect to a browser that is open, so
 * this starts the chosen one if it isn't running. It opens no page: Claude does that.
 */
export async function openForTest(
  browser: ChromeBrowser | null,
  places: Places,
  disk: Disk = realDisk,
  isRunning: IsRunning = isRunningReal,
  launch: Launch = launchDetached
): Promise<BrowserOpened> {
  if (browser === null) return 'none'
  const program = programPaths(browser, places).find((path) => disk.exists(path))
  if (program === undefined) return 'none'
  if (await isRunning(BROWSERS[browser].exe)) return 'running'
  launch(program, [])
  log.info(`Started ${browser} for the browser test`)
  return 'started'
}

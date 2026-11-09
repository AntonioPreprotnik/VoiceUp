import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { z } from 'zod'
import {
  installOnExit,
  isNewlyReady,
  nextUpdateStatus,
  shouldCheck,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_FIRST_CHECK_DELAY_MS,
  type ExitReason,
  type UpdateEvent,
  type UpdateStatus
} from '../core/updates'
import { log } from './log'

/** The part of electron-updater's `autoUpdater` VoiceUp uses, so tests can drive a fake. */
export interface UpdaterPort {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  disableWebInstaller: boolean
  on(event: 'checking-for-update' | 'update-not-available', listener: () => void): unknown
  on(
    event: 'update-available' | 'update-downloaded',
    listener: (info: { version: string }) => void
  ): unknown
  on(event: 'error', listener: (error: Error) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void
}

// The version comes from latest.yml on GitHub and is shown in the tray, so it is checked first.
const Version = z
  .string()
  .max(64)
  .regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/)

export interface AppUpdatesOptions {
  readonly updater: UpdaterPort
  /** Once per downloaded version. */
  readonly onReady: (version: string) => void
}

/**
 * Updates from the public repo's GitHub Releases (S7.4). An update downloads in the background and
 * its installer runs silently as VoiceUp exits, so Claude is never cut off by one. A failed check is
 * only logged: being offline is no reason to interrupt anyone, and the next check tries again.
 */
export class AppUpdates {
  private status: UpdateStatus = { kind: 'idle' }
  private firstCheck: ReturnType<typeof setTimeout> | undefined
  private interval: ReturnType<typeof setInterval> | undefined

  constructor(private readonly options: AppUpdatesOptions) {}

  get current(): UpdateStatus {
    return this.status
  }

  start(): void {
    const { updater } = this.options
    updater.autoDownload = true
    // VoiceUp ships the full NSIS installer only.
    updater.disableWebInstaller = true
    // Installing goes through installOnExit, which runs as a shutdown step: Electron's quit event,
    // which electron-updater would wait for, never comes after the app.exit that ends a shutdown.
    updater.autoInstallOnAppQuit = false
    updater.on('checking-for-update', () => {
      this.apply({ type: 'checking' })
    })
    updater.on('update-not-available', () => {
      this.apply({ type: 'notAvailable' })
    })
    updater.on('update-available', (info) => {
      this.withVersion(info, (version) => ({ type: 'available', version }))
    })
    updater.on('update-downloaded', (info) => {
      this.withVersion(info, (version) => ({ type: 'downloaded', version }))
    })
    updater.on('error', (error) => {
      log.warn('App update failed; the next check tries again', error)
      this.apply({ type: 'error' })
    })
    this.firstCheck = setTimeout(() => {
      this.check()
    }, UPDATE_FIRST_CHECK_DELAY_MS)
    this.interval = setInterval(() => {
      this.check()
    }, UPDATE_CHECK_INTERVAL_MS)
  }

  check(): void {
    if (!shouldCheck(this.status)) return
    // The error event reports it as well; this only keeps the rejection from going unhandled.
    this.options.updater.checkForUpdates().catch((error: unknown) => {
      log.warn('Could not check for an app update', error)
    })
  }

  /** The last shutdown step. The installer waits for VoiceUp to exit, then replaces it. */
  installOnExit(reason: ExitReason): void {
    if (this.status.kind !== 'ready') return
    const install = installOnExit(this.status, reason)
    if (install === null) {
      log.info(`App update ${this.status.version} waits for the next quit`)
      return
    }
    log.info(`Installing app update ${this.status.version}`)
    this.options.updater.quitAndInstall(true, install.relaunch)
  }

  stop(): void {
    clearTimeout(this.firstCheck)
    clearInterval(this.interval)
  }

  private withVersion(info: { version: string }, event: (version: string) => UpdateEvent): void {
    const version = Version.safeParse(info.version)
    if (!version.success) {
      log.warn('App update refused: its version is not valid')
      this.apply({ type: 'error' })
      return
    }
    this.apply(event(version.data))
  }

  private apply(event: UpdateEvent): void {
    const previous = this.status
    this.status = nextUpdateStatus(previous, event)
    if (isNewlyReady(previous, this.status) && this.status.kind === 'ready') {
      log.info(`App update ${this.status.version} downloaded`)
      this.options.onReady(this.status.version)
    }
  }
}

/**
 * Only a copy built for the installer can update: electron-builder writes app-update.yml for the
 * NSIS target alone, so dev runs and `--dir` builds, like the daily copy, have none and never check.
 */
function updatesSupported(): boolean {
  // Undefined outside Electron, as in the main-process tests.
  const resources = process.resourcesPath as string | undefined
  return app.isPackaged && resources !== undefined && existsSync(join(resources, 'app-update.yml'))
}

/**
 * electron-updater's Windows updater. Not its `autoUpdater`, which is a getter it doesn't enumerate,
 * so the bundle's import of the package never carries it: measured in S7.4 on a packaged build,
 * where it was undefined. The packaged smoke test loads it this same way.
 */
export async function loadNsisUpdater(): Promise<UpdaterPort> {
  const { NsisUpdater } = await import('electron-updater')
  const updater = new NsisUpdater()
  updater.logger = log
  return updater
}

/** Loads electron-updater only for an installed copy, and starts checking. */
export async function startAppUpdates(
  onReady: (version: string) => void
): Promise<AppUpdates | null> {
  if (!updatesSupported()) {
    log.info('App updates are off: this copy was not installed by the VoiceUp installer')
    return null
  }
  const updates = new AppUpdates({ updater: await loadNsisUpdater(), onReady })
  updates.start()
  log.info('App updates are on')
  return updates
}

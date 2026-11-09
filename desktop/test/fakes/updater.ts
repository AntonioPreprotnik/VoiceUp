import { EventEmitter } from 'node:events'
import type { UpdaterPort } from '../../src/main/updater'

/** Stands in for electron-updater's autoUpdater: tests emit its events and read what it was asked. */
export class FakeUpdater extends EventEmitter implements UpdaterPort {
  autoDownload = false
  autoInstallOnAppQuit = true
  disableWebInstaller = false
  checks = 0
  checkFails = false
  installs: [isSilent: boolean, isForceRunAfter: boolean][] = []

  checkForUpdates(): Promise<unknown> {
    this.checks += 1
    return this.checkFails ? Promise.reject(new Error('offline')) : Promise.resolve(null)
  }

  quitAndInstall(isSilent: boolean, isForceRunAfter: boolean): void {
    this.installs.push([isSilent, isForceRunAfter])
  }

  /** A check that finds the version and downloads it. */
  download(version = '1.0.1'): void {
    this.emit('checking-for-update')
    this.emit('update-available', { version })
    this.emit('update-downloaded', { version })
  }
}

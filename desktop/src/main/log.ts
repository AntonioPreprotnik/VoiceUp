import { join } from 'node:path'
import { app } from 'electron'
import electronLog from 'electron-log/main'
import type { LogLevel } from '../shared/settings'
import { applyLogLevel, configureLogFile } from './logConfig'

// log.initialize() is not called: it would add an IPC channel for renderers to log through.
export const log = electronLog

export function logsDirectory(): string {
  return app.getPath('logs')
}

export function initLogging(): void {
  configureLogFile(log, join(logsDirectory(), 'main.log'))
}

export function setLogLevel(level: LogLevel): void {
  applyLogLevel(log, level)
}

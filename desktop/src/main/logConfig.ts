import type { NodeLogger } from 'electron-log'
import type { LogLevel } from '../shared/settings'

// Free of Electron, so logConfig.test.ts can run these against the real electron-log.

const MAX_LOG_BYTES = 5 * 1024 * 1024

/** electron-log rotates to `<name>.old.log` when the file reaches the size limit. */
export function configureLogFile(
  logger: NodeLogger,
  filePath: string,
  maxBytes: number = MAX_LOG_BYTES
): void {
  logger.transports.file.resolvePathFn = () => filePath
  logger.transports.file.maxSize = maxBytes
}

export function applyLogLevel(logger: NodeLogger, level: LogLevel): void {
  logger.transports.file.level = level
  logger.transports.console.level = level
}

/** The only way a transcript may reach a log: at debug, so never at the default level. */
export function logTranscript(logger: NodeLogger, transcript: string): void {
  logger.debug(`Transcript: ${transcript}`)
}

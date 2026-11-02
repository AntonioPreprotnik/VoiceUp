import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import log from 'electron-log/node'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { LogLevel } from '../shared/settings'
import { applyLogLevel, configureLogFile, logTranscript } from './logConfig'

// Runs against the real electron-log, writing real files: a fake could not prove the filtering.
let dir: string
let filePath: string
let instance = 0

function createLogger(level: LogLevel, maxBytes?: number): typeof log {
  instance += 1
  const logger = log.create({ logId: `test-${String(instance)}` })
  logger.transports.console.level = false
  configureLogFile(logger, filePath, maxBytes)
  applyLogLevel(logger, level)
  logger.transports.console.level = false
  return logger
}

const written = (): string => (existsSync(filePath) ? readFileSync(filePath, 'utf8') : '')

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'voiceup-log-'))
  filePath = join(dir, 'main.log')
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('log levels', () => {
  it.each([
    ['error', ['e'], ['w', 'i', 'd']],
    ['warn', ['e', 'w'], ['i', 'd']],
    ['info', ['e', 'w', 'i'], ['d']],
    ['debug', ['e', 'w', 'i', 'd'], []]
  ] as const)('at %s, writes only what it should', (level, kept, dropped) => {
    const logger = createLogger(level)
    logger.error('msg-e')
    logger.warn('msg-w')
    logger.info('msg-i')
    logger.debug('msg-d')
    for (const name of kept) expect(written()).toContain(`msg-${name}`)
    for (const name of dropped) expect(written()).not.toContain(`msg-${name}`)
  })
})

describe('transcripts', () => {
  it.each(['error', 'warn', 'info'] as const)('never reach the file at %s', (level) => {
    const logger = createLogger(level)
    logTranscript(logger, 'delete the production database')
    logger.error('other message')
    expect(written()).toContain('other message')
    expect(written()).not.toContain('delete the production database')
  })

  it('reach the file at debug', () => {
    const logger = createLogger('debug')
    logTranscript(logger, 'delete the production database')
    expect(written()).toContain('delete the production database')
  })
})

describe('rotation', () => {
  it('moves a full file to .old.log and keeps writing', () => {
    const logger = createLogger('info', 200)
    for (let line = 0; line < 20; line++) logger.info(`line ${String(line)}`)
    const oldFile = join(dir, 'main.old.log')
    expect(existsSync(oldFile)).toBe(true)
    expect(readFileSync(oldFile, 'utf8')).toContain('line')
    expect(written()).toContain('line 19')
  })
})

// A fake of electron-log/main that records messages. Use it with
// vi.mock('electron-log/main', () => import('<path to this file>')).
// logConfig.test.ts covers the real logger's filtering and rotation.

type Level = 'error' | 'warn' | 'info' | 'debug'

const records: { level: Level; args: unknown[] }[] = []

const fakeLog = {
  transports: {
    file: { level: 'info' as string | false, maxSize: 0, resolvePathFn: (): string => '' },
    console: { level: 'info' as string | false }
  },
  error: (...args: unknown[]): void => {
    records.push({ level: 'error', args })
  },
  warn: (...args: unknown[]): void => {
    records.push({ level: 'warn', args })
  },
  info: (...args: unknown[]): void => {
    records.push({ level: 'info', args })
  },
  debug: (...args: unknown[]): void => {
    records.push({ level: 'debug', args })
  },
  messages: (level: Level): unknown[][] =>
    records.filter((record) => record.level === level).map((record) => record.args),
  reset: (): void => {
    records.length = 0
    fakeLog.transports.file.level = 'info'
    fakeLog.transports.console.level = 'info'
  }
}

export default fakeLog

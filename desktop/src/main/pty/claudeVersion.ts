import { execFile } from 'node:child_process'
import { childEnv, ptyArgs, type ClaudeCommand } from '../../core/claudeCommand'
import { parseClaudeVersion } from '../../core/claudeVersion'
import { log } from '../log'

const TIMEOUT_MS = 15000

/** The version of this Claude, or null if it can't be read, which never blocks a start. */
export function readClaudeVersion(command: ClaudeCommand): Promise<string | null> {
  return new Promise((resolve) => {
    const args = ptyArgs(command, ['--version'])
    execFile(
      command.file,
      // A .cmd has its whole line as one string, which must reach cmd.exe as it is.
      typeof args === 'string' ? [args] : args,
      {
        env: childEnv(process.env),
        timeout: TIMEOUT_MS,
        windowsHide: true,
        windowsVerbatimArguments: typeof args === 'string'
      },
      (error, stdout) => {
        if (error !== null) {
          log.warn('Could not read the Claude Code version:', error.message)
          resolve(null)
          return
        }
        const version = parseClaudeVersion(stdout)
        if (version === null) log.warn('Could not understand the Claude Code version')
        else log.info(`Claude Code ${version}`)
        resolve(version)
      }
    )
  })
}

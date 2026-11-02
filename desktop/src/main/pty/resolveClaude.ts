import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import {
  chooseClaudeCommand,
  firstWhereResult,
  parseClaudeOverride,
  type ClaudeCommand
} from '../../core/claudeCommand'
import { log } from '../log'

const run = promisify(execFile)

async function where(name: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('where.exe', [name], { windowsHide: true })
    return firstWhereResult(stdout)
  } catch {
    // where.exe exits 1 when it finds nothing, which is an ordinary answer here.
    return undefined
  }
}

/** Never a bare `where.exe claude`: on an npm install it finds a shim that can't be spawned. */
export async function resolveClaude(isPackaged: boolean): Promise<ClaudeCommand | null> {
  const override = process.env['VOICEUP_CLAUDE_CMD']
  if (override !== undefined && !isPackaged) {
    const parsed = parseClaudeOverride(override)
    if (parsed !== null) return parsed
    log.warn('Ignored VOICEUP_CLAUDE_CMD: it must be a JSON array of strings')
  }

  const localBin = join(homedir(), '.local', 'bin', 'claude.exe')
  return chooseClaudeCommand({
    whereExe: await where('claude.exe'),
    localBinExe: existsSync(localBin) ? localBin : undefined,
    whereCmd: await where('claude.cmd')
  })
}

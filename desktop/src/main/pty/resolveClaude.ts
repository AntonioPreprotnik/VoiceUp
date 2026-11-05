import { execFile } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
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

/** A Windows tool by absolute path, so PATH can't substitute it. */
export function system32Path(tool: string): string {
  return join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', tool)
}

/** The full path to cmd.exe, which node-pty needs (see chooseClaudeCommand). */
export function cmdExePath(): string {
  return system32Path('cmd.exe')
}

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
  // A test seam, like the one below: Claude "appears" when a fake installer writes this file.
  const overrideFile = process.env['VOICEUP_CLAUDE_CMD_FILE']
  if (overrideFile !== undefined && !isPackaged) {
    return existsSync(overrideFile) ? parseClaudeOverride(readFileSync(overrideFile, 'utf8')) : null
  }
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
    whereCmd: await where('claude.cmd'),
    cmdExe: cmdExePath()
  })
}

// How to launch Claude Code (TECH_SPEC §4.1). The caller gathers the facts; this decides.

export interface ClaudeCommand {
  readonly file: string
  readonly args: readonly string[]
}

export interface ClaudeLocations {
  readonly whereExe: string | undefined
  readonly localBinExe: string | undefined
  readonly whereCmd: string | undefined
  /** Must be a full path: see the note in chooseClaudeCommand. */
  readonly cmdExe: string
}

/**
 * A .cmd can't be spawned directly, so it runs through cmd.exe, by its full path: node-pty fails
 * with an empty "File not found" on a relative name that exists in the current folder, and an app
 * launched from Explorer starts in System32.
 */
export function chooseClaudeCommand(locations: ClaudeLocations): ClaudeCommand | null {
  const exe = locations.whereExe ?? locations.localBinExe
  if (exe !== undefined) return { file: exe, args: [] }
  if (locations.whereCmd !== undefined) {
    return { file: locations.cmdExe, args: ['/d', '/s', '/c', locations.whereCmd] }
  }
  return null
}

/** The first path `where.exe` printed, or undefined if it printed none. */
export function firstWhereResult(stdout: string): string | undefined {
  const first = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line !== '')
  return first
}

/** VOICEUP_CLAUDE_CMD: a JSON array such as ["node", "test/fake-claude.mjs"]. Null if invalid. */
export function parseClaudeOverride(raw: string): ClaudeCommand | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    // The caller logs the null result.
    return null
  }
  if (!Array.isArray(parsed)) return null
  const parts: unknown[] = parsed
  const strings = parts.filter((part): part is string => typeof part === 'string')
  const file = strings.at(0)
  if (strings.length !== parts.length || file === undefined || file === '') return null
  return { file, args: strings.slice(1) }
}

const REMOVED_FROM_CHILD = ['CLAUDECODE', 'CLAUDE_CODE_ENTRYPOINT']

/**
 * The environment for Claude: the user's, unchanged, minus the two variables set only when this
 * app itself runs under Claude Code. An API key is never stripped silently.
 */
export function childEnv(
  env: Readonly<Record<string, string | undefined>>
): Record<string, string> {
  const result: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    const removed = REMOVED_FROM_CHILD.includes(key.toUpperCase())
    if (value !== undefined && !removed) result[key] = value
  }
  return result
}

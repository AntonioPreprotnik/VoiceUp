// Which Claude Code versions VoiceUp can work with (S6.3).

/**
 * The only version measured so far: hook behaviour (S2.1) and paste limits (S5.3). The changelog's
 * floor for the hook features alone is 2.1.139, for `args` on a command hook. Lower this only after
 * measuring an older version. Native installs update themselves, so the cost is small.
 */
export const MIN_CLAUDE_VERSION = '2.1.318'

export const INSTALL_COMMAND = 'irm https://claude.ai/install.ps1 | iex'
export const UPDATE_COMMAND = 'claude update'

/** The version in the output of `claude --version`, or null if there isn't one. */
export function parseClaudeVersion(output: string): string | null {
  return /^\s*(\d+\.\d+\.\d+)/.exec(output)?.[1] ?? null
}

function parts(version: string): number[] {
  return version.split('.').map(Number)
}

/** A version that can't be read isn't "too old": only a clear answer blocks a start. */
export function isTooOld(version: string | null): boolean {
  if (version === null) return false
  const have = parts(version)
  const need = parts(MIN_CLAUDE_VERSION)
  for (const [index, wanted] of need.entries()) {
    const found = have[index] ?? 0
    if (found !== wanted) return found < wanted
  }
  return false
}

import { HOOK_NAMES, type ClaudeHookPolicy, type HookName } from '../shared/hooks'

// The per-launch hook settings (TECH_SPEC §4.2), and whether Claude's own settings would stop them.

/**
 * Everything but SessionEnd, which made each close take 9.6 s and hit the shutdown watchdog. The
 * likely cause: killing the PTY blocks the main process until Claude exits, while Claude waits for
 * that same process to answer this hook. The state machine doesn't need it: a PTY exit means
 * exited, and after /clear or /resume the next SessionStart decides.
 */
export const REGISTERED_HOOKS: readonly HookName[] = HOOK_NAMES.filter(
  (name) => name !== 'SessionEnd'
)

export function hookUrl(port: number, event: HookName): string {
  return `http://127.0.0.1:${String(port)}/hooks/${event}`
}

export interface HookSettingsInput {
  readonly port: number
  /** By absolute path, so PATH can't substitute it. */
  readonly curlPath: string
  /** Holds the token, so it never appears in a process list. */
  readonly headerFile: string
}

/** SessionStart only supports command hooks. Everything else is a native http hook. */
export function buildHookSettings({ port, curlPath, headerFile }: HookSettingsInput): unknown {
  const handler = (event: HookName): unknown =>
    event === 'SessionStart'
      ? {
          type: 'command',
          command: curlPath,
          args: [
            '-s',
            '-m',
            '2',
            '--noproxy',
            '*',
            '-X',
            'POST',
            '-H',
            `@${headerFile}`,
            '-H',
            'Content-Type: application/json',
            '--data-binary',
            '@-',
            hookUrl(port, event)
          ],
          timeout: 5
        }
      : {
          type: 'http',
          url: hookUrl(port, event),
          headers: { 'X-VoiceUp-Token': '$VOICEUP_HOOK_TOKEN' },
          allowedEnvVars: ['VOICEUP_HOOK_TOKEN'],
          timeout: 5
        }
  return {
    hooks: Object.fromEntries(
      REGISTERED_HOOKS.map((event) => [event, [{ hooks: [handler(event)] }]])
    )
  }
}

/** Highest precedence first, which is the order Claude resolves a single value in. */
export interface HookPolicies {
  readonly managed: ClaudeHookPolicy
  readonly local: ClaudeHookPolicy
  readonly project: ClaudeHookPolicy
  readonly user: ClaudeHookPolicy
}

function matchesPattern(url: string, pattern: string): boolean {
  const body = pattern
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${body}$`, 'u').test(url)
}

/** The setting that stops our hooks, or null. Only setting names: never a value from the files. */
export function hooksBlockedBy(policies: HookPolicies, port: number): string | null {
  const { managed, local, project, user } = policies
  const levels = [managed, local, project, user]
  const disabled = levels.map((level) => level.disableAllHooks).find((v) => v !== undefined)
  if (disabled === true) return 'disableAllHooks'
  if (managed.allowManagedHooksOnly === true) return 'allowManagedHooksOnly'
  const lists = levels.flatMap((level) => level.allowedHttpHookUrls ?? [])
  // No list anywhere means no limit. An empty list means no http hooks at all.
  if (levels.every((level) => level.allowedHttpHookUrls === undefined)) return null
  const allowed = REGISTERED_HOOKS.filter((event) => event !== 'SessionStart').every((event) =>
    lists.some((pattern) => matchesPattern(hookUrl(port, event), pattern))
  )
  return allowed ? null : 'allowedHttpHookUrls'
}

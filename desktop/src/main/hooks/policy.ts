import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { HookPolicies } from '../../core/hookConfig'
import { ClaudeHookPolicy } from '../../shared/hooks'
import { log } from '../log'

// Reads only the settings that can stop our hooks (TECH_SPEC §4.2), and nothing else from Claude's
// files: zod drops every other key. Logs name a level and never a value or an error message, since
// a JSON error quotes the file.

function readPolicy(path: string, level: string): ClaudeHookPolicy {
  if (!existsSync(path)) return {}
  let raw: string
  try {
    raw = readFileSync(path, 'utf8')
  } catch {
    log.warn(`Could not read the ${level} Claude settings`)
    return {}
  }
  let json: unknown
  try {
    json = JSON.parse(raw)
  } catch {
    log.warn(`Could not parse the ${level} Claude settings`)
    return {}
  }
  const parsed = ClaudeHookPolicy.safeParse(json)
  if (parsed.success) return parsed.data
  log.warn(`Unexpected shape in the ${level} Claude settings`)
  return {}
}

/** A drop-in file overrides the base file for a single value, and adds to a list. */
function readManaged(folder: string): ClaudeHookPolicy {
  let merged = readPolicy(join(folder, 'managed-settings.json'), 'managed')
  const dropIns = join(folder, 'managed-settings.d')
  if (!existsSync(dropIns)) return merged
  let names: string[]
  try {
    names = readdirSync(dropIns)
  } catch {
    log.warn('Could not read the managed Claude settings folder')
    return merged
  }
  for (const name of names.filter((file) => file.endsWith('.json')).sort()) {
    const next = readPolicy(join(dropIns, name), 'managed')
    merged = {
      ...merged,
      ...next,
      ...(merged.allowedHttpHookUrls === undefined && next.allowedHttpHookUrls === undefined
        ? {}
        : {
            allowedHttpHookUrls: [
              ...(merged.allowedHttpHookUrls ?? []),
              ...(next.allowedHttpHookUrls ?? [])
            ]
          })
    }
  }
  return merged
}

export interface PolicyLocations {
  readonly projectDir: string
  /** Where Claude keeps its user settings: CLAUDE_CONFIG_DIR, or ~/.claude. */
  readonly userDir?: string
  readonly managedDir?: string
}

export function readHookPolicies(locations: PolicyLocations): HookPolicies {
  const {
    projectDir,
    userDir = process.env['CLAUDE_CONFIG_DIR'] ?? join(homedir(), '.claude'),
    managedDir = join(process.env['ProgramFiles'] ?? 'C:\\Program Files', 'ClaudeCode')
  } = locations
  return {
    managed: readManaged(managedDir),
    local: readPolicy(join(projectDir, '.claude', 'settings.local.json'), 'local'),
    project: readPolicy(join(projectDir, '.claude', 'settings.json'), 'project'),
    user: readPolicy(join(userDir, 'settings.json'), 'user')
  }
}

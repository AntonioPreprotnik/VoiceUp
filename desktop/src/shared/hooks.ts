import { z } from 'zod'

// The bodies Claude Code's hooks send (TECH_SPEC §6.3). Only the fields the state machine reads are
// kept: zod drops the rest, so tool input and file contents go no further than the parse.

const session = { session_id: z.string().optional() }
const agent = {
  ...session,
  agent_id: z.string().optional(),
  tool_name: z.string().optional()
}

const HookEvent = z.discriminatedUnion('hook_event_name', [
  z.object({ hook_event_name: z.literal('SessionStart'), ...session, source: z.string() }),
  z.object({ hook_event_name: z.literal('SessionEnd'), ...session, reason: z.string() }),
  // Kept only so delivery can tell a prompt from a tag Claude sends itself (§4.5). Never logged.
  z.object({
    hook_event_name: z.literal('UserPromptSubmit'),
    ...session,
    prompt: z.string().optional()
  }),
  z.object({ hook_event_name: z.literal('PreToolUse'), ...agent }),
  z.object({ hook_event_name: z.literal('PermissionRequest'), ...agent }),
  z.object({ hook_event_name: z.literal('PostToolUse'), ...agent }),
  z.object({ hook_event_name: z.literal('PostToolUseFailure'), ...agent }),
  z.object({
    hook_event_name: z.literal('Notification'),
    ...session,
    // An open string: a value outside §4.3 moves the state to unknown, and must not fail here.
    notification_type: z.string()
  }),
  z.object({ hook_event_name: z.literal('Elicitation'), ...session }),
  z.object({ hook_event_name: z.literal('ElicitationResult'), ...session }),
  z.object({
    hook_event_name: z.literal('Stop'),
    ...session,
    background_tasks: z.array(z.unknown()).optional()
  }),
  z.object({
    hook_event_name: z.literal('StopFailure'),
    ...session,
    error: z.string().optional()
  })
])
export type HookEvent = z.infer<typeof HookEvent>

export type HookName = HookEvent['hook_event_name']

/**
 * The only keys ever read from Claude's settings (§4.2), so every other key is dropped here. A value
 * of the wrong type counts as unset, since Claude can't be relying on it either.
 */
export const ClaudeHookPolicy = z.object({
  disableAllHooks: z.boolean().optional().catch(undefined),
  allowManagedHooksOnly: z.boolean().optional().catch(undefined),
  allowedHttpHookUrls: z.array(z.string()).optional().catch(undefined)
})
export type ClaudeHookPolicy = z.infer<typeof ClaudeHookPolicy>

export const HOOK_NAMES = [
  'SessionStart',
  'SessionEnd',
  'UserPromptSubmit',
  'PreToolUse',
  'PermissionRequest',
  'PostToolUse',
  'PostToolUseFailure',
  'Notification',
  'Elicitation',
  'ElicitationResult',
  'Stop',
  'StopFailure'
] as const satisfies readonly HookName[]

export type UnexpectedReason =
  | 'unknown event'
  | 'bad request'
  | 'body too large'
  | 'invalid JSON'
  | 'invalid body'
  | 'name mismatch'

/** Unexpected ones still reach the state machine, which treats them as unknown (fail safe). */
export type HookMessage =
  | { readonly kind: 'hook'; readonly hook: HookEvent }
  | { readonly kind: 'unexpected'; readonly name: string; readonly reason: UnexpectedReason }

function isHookName(name: string): name is HookName {
  return (HOOK_NAMES as readonly string[]).includes(name)
}

/** The name comes from the URL and the body is untrusted, so neither is believed until it fits. */
export function parseHook(name: string, body: string): HookMessage {
  if (!isHookName(name)) return { kind: 'unexpected', name, reason: 'unknown event' }
  let json: unknown
  try {
    json = JSON.parse(body)
  } catch {
    // The caller logs the reason, and never the body, which can hold a prompt.
    return { kind: 'unexpected', name, reason: 'invalid JSON' }
  }
  const parsed = HookEvent.safeParse(json)
  if (!parsed.success) return { kind: 'unexpected', name, reason: 'invalid body' }
  if (parsed.data.hook_event_name !== name) {
    return { kind: 'unexpected', name, reason: 'name mismatch' }
  }
  return { kind: 'hook', hook: parsed.data }
}

import { z } from 'zod'

// TECH_SPEC §6.1. term:* are the high-frequency stream channels allowed to carry bare values.
export const MAX_TERM_INPUT_CHARS = 64 * 1024

export const TermInput = z.string().max(MAX_TERM_INPUT_CHARS)
export const TermAck = z.number().int().nonnegative()
// The size is clamped by the receiver, not rejected, so only its shape is checked here.
export const TermResize = z.object({ cols: z.number().int(), rows: z.number().int() })
export type TermResize = z.infer<typeof TermResize>
export const SessionRestart = z.object({}).strict()
export const StateReArm = z.object({}).strict()
export const WizardAction = z.object({}).strict()
export const QueueCancel = z.object({ id: z.string().max(32) }).strict()
export const RecorderDevices = z
  .array(z.object({ deviceId: z.string().max(512), label: z.string().max(512) }))
  .max(64)
export const RecorderError = z.object({
  recordingId: z.string(),
  code: z.enum(['MIC_DENIED', 'MIC_MISSING', 'MIC_FAILED'])
})
// Far above any real selection, while keeping a runaway page from filling the clipboard.
export const ClipboardWrite = z.string().max(10 * 1024 * 1024)
export const LinkOpen = z.object({ url: z.string().max(2048) })
export const ContextMenuRequest = z.object({ hasSelection: z.boolean() })

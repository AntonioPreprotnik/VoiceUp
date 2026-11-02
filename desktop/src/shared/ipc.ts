import { z } from 'zod'

// TECH_SPEC §6.1. term:* are the high-frequency stream channels allowed to carry bare values.
export const MAX_TERM_INPUT_CHARS = 64 * 1024

export const TermInput = z.string().max(MAX_TERM_INPUT_CHARS)
export const TermAck = z.number().int().nonnegative()
// The size is clamped by the receiver, not rejected, so only its shape is checked here.
export const TermResize = z.object({ cols: z.number().int(), rows: z.number().int() })
export type TermResize = z.infer<typeof TermResize>
export const SessionRestart = z.object({}).strict()

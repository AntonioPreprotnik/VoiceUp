import { z } from 'zod'

// TECH_SPEC §6.4. `.prefault({})` makes zod 4 parse a missing section as {}, so its defaults apply.
export const Settings = z.object({
  version: z.literal(1),
  hotkey: z.string().default('Control+Shift+Space'), // Ctrl+Alt = AltGr on HR layouts
  micDeviceId: z.string().nullable().default(null),
  speech: z
    .object({
      // auto: >= 15 GiB reported RAM -> Parakeet, else Moonshine
      modelId: z.enum(['auto', 'parakeet-tdt-0.6b-v2-int8', 'moonshine-base-en']).default('auto'),
      endSilenceSec: z.number().min(0.5).max(3).default(1.2),
      minSpeechSec: z.number().min(0.1).max(1).default(0.25),
      maxRecordingSec: z.number().min(5).max(120).default(60),
      noSpeechTimeoutSec: z.number().min(3).max(30).default(8),
      minWords: z.number().int().min(1).max(5).default(1)
    })
    .prefault({}),
  delivery: z
    .object({
      previewMs: z.number().int().min(0).max(5000).default(1000),
      alwaysConfirm: z.boolean().default(false),
      queue: z.boolean().default(true),
      maxQueue: z.number().int().min(1).max(5).default(3)
    })
    .prefault({}),
  claude: z
    .object({
      projectDir: z.string().nullable().default(null),
      browserControl: z.boolean().default(false)
    })
    .prefault({}),
  ui: z
    .object({
      fontSize: z.number().int().min(8).max(32).default(14),
      sounds: z.boolean().default(true),
      startWithWindows: z.boolean().default(false)
    })
    .prefault({}),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info')
})

export type Settings = z.infer<typeof Settings>
export type LogLevel = Settings['logLevel']

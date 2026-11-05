import { z } from 'zod'
import { ModelId } from './models'

// TECH_SPEC §6.4. `.prefault({})` makes zod 4 parse a missing section as {}, so its defaults apply.
export const Settings = z.object({
  version: z.literal(1),
  hotkey: z.string().default('Control+Shift+Space'), // Ctrl+Alt = AltGr on HR layouts
  micDeviceId: z.string().nullable().default(null),
  speech: z
    .object({
      // auto: Moonshine (decision note S4.1)
      modelId: z.enum(['auto', ...ModelId.options]).default('auto'),
      endSilenceSec: z.number().min(0.5).max(3).default(1.2),
      minSpeechSec: z.number().min(0.1).max(1).default(0.25),
      maxRecordingSec: z.number().min(5).max(120).default(60),
      noSpeechTimeoutSec: z.number().min(3).max(30).default(8),
      minWords: z.number().int().min(1).max(5).default(1)
    })
    .prefault({}),
  delivery: z
    .object({
      /** For each word of the preview. */
      previewMs: z.number().int().min(0).max(5000).default(300),
      alwaysConfirm: z.boolean().default(false),
      queue: z.boolean().default(true),
      maxQueue: z.number().int().min(1).max(5).default(3)
    })
    .prefault({}),
  claude: z
    .object({
      projectDir: z.string().nullable().default(null),
      browserControl: z.boolean().default(false),
      /** Which browser to bring forward when Claude uses it (decision note S6.10). */
      showBrowser: z.enum(['off', 'brave', 'chrome', 'edge']).default('off')
    })
    .prefault({}),
  ui: z
    .object({
      fontSize: z.number().int().min(8).max(32).default(14),
      sounds: z.boolean().default(true),
      notifications: z.boolean().default(true),
      startWithWindows: z.boolean().default(false)
    })
    .prefault({}),
  wizard: z
    .object({
      /**
       * True by default, because a file without this section was written before the wizard existed.
       * A brand-new file says false: see defaultSettings.
       */
      done: z.boolean().default(true),
      /** Strings, not an enum: a step from another version must not make the whole file unusable. */
      completed: z.array(z.string().max(64)).max(64).default([])
    })
    .prefault({}),
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info')
})

export type Settings = z.infer<typeof Settings>
export type LogLevel = Settings['logLevel']

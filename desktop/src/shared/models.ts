import { z } from 'zod'

// The model manifest, resources/models.json (TECH_SPEC §5.4). It's pinned per app version.

export const ModelId = z.enum(['moonshine-base-en', 'parakeet-tdt-0.6b-v2-int8'])
export type ModelId = z.infer<typeof ModelId>

const Download = {
  id: ModelId,
  label: z.string(),
  url: z.url({ protocol: /^https$/ }),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  bytes: z.number().int().positive(),
  dir: z.string()
}

const ModelEntry = z.discriminatedUnion('type', [
  z.object({
    ...Download,
    type: z.literal('moonshine'),
    files: z.object({
      preprocessor: z.string(),
      encoder: z.string(),
      uncachedDecoder: z.string(),
      cachedDecoder: z.string(),
      tokens: z.string()
    })
  }),
  z.object({
    ...Download,
    type: z.literal('nemo_transducer'),
    files: z.object({
      encoder: z.string(),
      decoder: z.string(),
      joiner: z.string(),
      tokens: z.string()
    })
  })
])
export type ModelEntry = z.infer<typeof ModelEntry>

export const ModelManifest = z.array(ModelEntry).min(1)

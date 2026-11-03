import { z } from 'zod'

// Messages between main and the speech worker (TECH_SPEC §6.2). Audio doesn't pass through here:
// frames go straight from the recorder to the worker over their own port.

export const FRAME_SAMPLES = 512
export const SAMPLE_RATE = 16000

const ModelPaths = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('moonshine'),
    preprocessor: z.string(),
    encoder: z.string(),
    uncachedDecoder: z.string(),
    cachedDecoder: z.string(),
    tokens: z.string()
  }),
  z.object({
    type: z.literal('nemo_transducer'),
    encoder: z.string(),
    decoder: z.string(),
    joiner: z.string(),
    tokens: z.string()
  })
])
export type ModelPaths = z.infer<typeof ModelPaths>

const WorkerInit = z.object({
  type: z.literal('init'),
  /** Null until a model is downloaded: VAD runs, and a finished recording reports MODEL_MISSING. */
  modelId: z.string().nullable(),
  modelPaths: ModelPaths.nullable(),
  sileroPath: z.string(),
  vad: z.object({
    endSilenceSec: z.number(),
    minSpeechSec: z.number(),
    maxRecordingSec: z.number(),
    noSpeechTimeoutSec: z.number()
  }),
  numThreads: z.number().int().positive()
})
export type WorkerInit = z.infer<typeof WorkerInit>

const RecordingCommand = { recordingId: z.string() }

export const WorkerCommand = z.discriminatedUnion('type', [
  WorkerInit,
  z.object({ type: z.literal('start'), ...RecordingCommand }),
  z.object({ type: z.literal('stop'), ...RecordingCommand }),
  z.object({ type: z.literal('cancel'), ...RecordingCommand })
])
export type WorkerCommand = z.infer<typeof WorkerCommand>

export const WorkerEvent = z.discriminatedUnion('type', [
  z.object({ type: z.literal('ready'), modelId: z.string().nullable(), loadMs: z.number() }),
  z.object({ type: z.literal('speechStart'), recordingId: z.string() }),
  z.object({ type: z.literal('level'), recordingId: z.string(), rms: z.number() }),
  z.object({ type: z.literal('speechEnd'), recordingId: z.string(), durationMs: z.number() }),
  z.object({
    type: z.literal('transcript'),
    recordingId: z.string(),
    text: z.string(),
    decodeMs: z.number()
  }),
  z.object({
    type: z.literal('error'),
    recordingId: z.string().optional(),
    code: z.enum(['NO_SPEECH', 'MODEL_MISSING', 'WORKER_ERROR']),
    message: z.string()
  })
])
export type WorkerEvent = z.infer<typeof WorkerEvent>

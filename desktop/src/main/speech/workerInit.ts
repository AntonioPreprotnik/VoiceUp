import { availableParallelism } from 'node:os'
import { join } from 'node:path'
import { app } from 'electron'
import type { ModelId } from '../../shared/models'
import type { Settings } from '../../shared/settings'
import type { ModelPaths, WorkerInit } from '../../shared/worker'

/**
 * The bundled Silero model. In a packaged build it sits outside the asar (electron-builder.yml
 * asarUnpack), because the addon opens files itself, without Electron's asar support.
 */
export function sileroPath(): string {
  return join(app.getAppPath(), 'resources', 'silero_vad.onnx').replace(
    'app.asar',
    'app.asar.unpacked'
  )
}

/** Without a model, which means none is downloaded yet, the worker runs VAD only. */
export function workerInit(
  speech: Settings['speech'] | undefined,
  model: { readonly id: ModelId; readonly paths: ModelPaths } | null = null
): WorkerInit {
  return {
    type: 'init',
    modelId: model?.id ?? null,
    modelPaths: model?.paths ?? null,
    sileroPath: sileroPath(),
    vad: {
      endSilenceSec: speech?.endSilenceSec ?? 1.2,
      minSpeechSec: speech?.minSpeechSec ?? 0.25,
      maxRecordingSec: speech?.maxRecordingSec ?? 60,
      noSpeechTimeoutSec: speech?.noSpeechTimeoutSec ?? 8
    },
    numThreads: Math.max(1, Math.min(4, availableParallelism() - 1))
  }
}

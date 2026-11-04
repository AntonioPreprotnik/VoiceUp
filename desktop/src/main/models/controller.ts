import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { chooseModel, formatSize } from '../../core/modelChoice'
import { ModelManifest, type ModelEntry, type ModelId } from '../../shared/models'
import type { Settings } from '../../shared/settings'
import type { ModelPaths } from '../../shared/worker'
import { log } from '../log'
import { ModelError, type ModelErrorCode, type ModelManager, type ModelPhase } from './manager'

export function loadManifest(): readonly ModelEntry[] {
  return ModelManifest.parse(
    JSON.parse(readFileSync(join(app.getAppPath(), 'resources', 'models.json'), 'utf8'))
  )
}

export type ModelStatus =
  | { readonly phase: 'idle' }
  | { readonly phase: 'installing'; readonly stage: ModelPhase; readonly percent: number }
  | { readonly phase: 'failed' }

export function modelTitle(status: ModelStatus): string {
  if (status.phase === 'idle') return 'VoiceUp'
  if (status.phase === 'failed') return 'VoiceUp - Speech model download failed'
  const doing = status.stage === 'downloading' ? 'Downloading' : 'Unpacking'
  return `VoiceUp - ${doing} speech model ${String(status.percent)}%`
}

export interface ReadyModel {
  readonly id: ModelId
  readonly paths: ModelPaths
}

export interface ModelControllerOptions {
  readonly manifest: readonly ModelEntry[]
  readonly manager: Pick<ModelManager, 'isInstalled' | 'install' | 'paths' | 'diskUsageBytes'>
  readonly modelId: Settings['speech']['modelId']
  readonly onStatus: (status: ModelStatus) => void
  /** The chosen model is on disk and isn't the one the worker has. */
  readonly onReady: (model: ReadyModel) => void
  readonly onFailed: (code: ModelErrorCode) => void
}

/** Keeps the chosen model on disk and in the worker. Installs one model at a time. */
export class ModelController {
  private current: ModelStatus = { phase: 'idle' }
  private modelId: Settings['speech']['modelId']
  private active: ModelId | null

  constructor(private readonly options: ModelControllerOptions) {
    this.modelId = options.modelId
    this.active = this.installedModel()?.id ?? null
  }

  get status(): ModelStatus {
    return this.current
  }

  /** The chosen model, if it's ready to use. */
  installedModel(): ReadyModel | null {
    const { manager } = this.options
    const entry = this.chosen()
    return manager.isInstalled(entry) ? { id: entry.id, paths: manager.paths(entry) } : null
  }

  select(id: ModelId): void {
    this.modelId = id
    this.ensure()
  }

  /** Gets the chosen model ready. While another install runs, that one's end picks this up. */
  ensure(): void {
    if (this.current.phase === 'installing') return
    const ready = this.installedModel()
    if (ready === null) {
      void this.install(this.chosen())
      return
    }
    this.setStatus({ phase: 'idle' })
    if (ready.id !== this.active) {
      this.active = ready.id
      this.options.onReady(ready)
    }
  }

  menu(): {
    choices: { id: ModelId; label: string; checked: boolean }[]
    notes: string[]
    canRetry: boolean
  } {
    const { manifest, manager } = this.options
    const chosen = this.chosen()
    const { phase } = this.current
    return {
      choices: manifest.map((entry) => ({
        id: entry.id,
        label: manager.isInstalled(entry)
          ? entry.label
          : `${entry.label}, downloads ${formatSize(entry.bytes)}`,
        checked: entry.id === chosen.id
      })),
      notes: [
        ...(phase === 'installing' ? ['Installing, the title bar shows how far along'] : []),
        `Models on disk: ${formatSize(manager.diskUsageBytes())}`
      ],
      canRetry: phase === 'failed'
    }
  }

  private chosen(): ModelEntry {
    return chooseModel(this.options.manifest, this.modelId)
  }

  private async install(entry: ModelEntry): Promise<void> {
    log.info(`Installing the speech model ${entry.id}`)
    this.setStatus({ phase: 'installing', stage: 'downloading', percent: 0 })
    try {
      await this.options.manager.install(entry, (stage, fraction) => {
        this.progress(stage, Math.floor(fraction * 100))
      })
      log.info(`Installed the speech model ${entry.id}`)
    } catch (error: unknown) {
      const code = error instanceof ModelError ? error.code : 'MODEL_DOWNLOAD_FAILED'
      log.error(`${code}: could not install ${entry.id}`, error)
      this.setStatus({ phase: 'failed' })
      this.options.onFailed(code)
      return
    }
    this.setStatus({ phase: 'idle' })
    this.ensure()
  }

  /** Called for every chunk, so it reports only when the number on screen changes. */
  private progress(stage: ModelPhase, percent: number): void {
    const { current } = this
    if (current.phase === 'installing' && current.stage === stage && current.percent === percent) {
      return
    }
    this.setStatus({ phase: 'installing', stage, percent })
  }

  private setStatus(status: ModelStatus): void {
    this.current = status
    this.options.onStatus(status)
  }
}

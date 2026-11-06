import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelEntry, ModelId } from '../../shared/models'
import type { ModelPaths } from '../../shared/worker'
import { ModelController, modelTitle, type ModelStatus } from './controller'
import { ModelError, type ModelProgress } from './manager'

vi.mock('electron', () => import('../../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../../test/fakes/electronLog'))

const moonshine = { id: 'moonshine-base-en', label: 'Moonshine', bytes: 251e6 } as ModelEntry
const parakeet = { id: 'parakeet-tdt-0.6b-v2-int8', label: 'Parakeet', bytes: 482e6 } as ModelEntry

let installed: Set<ModelId>
let installs: { entry: ModelEntry; progress: ModelProgress; finish: (error?: Error) => void }[]
let statuses: ModelStatus[]
let ready: ModelId[]
let failed: string[]

function controller(modelId: ModelId | 'auto' = 'auto'): ModelController {
  return new ModelController({
    manifest: [moonshine, parakeet],
    modelId,
    manager: {
      isInstalled: (entry) => installed.has(entry.id),
      paths: () => ({ type: 'moonshine' }) as ModelPaths,
      diskUsageBytes: () => 287e6,
      install: (entry, progress) =>
        new Promise((resolve, reject) => {
          installs.push({
            entry,
            progress,
            finish: (error) => {
              if (error !== undefined) {
                reject(error)
                return
              }
              installed.add(entry.id)
              resolve()
            }
          })
        })
    },
    onStatus: (status) => {
      statuses.push(status)
    },
    onReady: ({ id }) => {
      ready.push(id)
    },
    onFailed: (code) => {
      failed.push(code)
    }
  })
}

const settle = (): Promise<void> =>
  new Promise((resolve) => {
    setImmediate(resolve)
  })

beforeEach(() => {
  installed = new Set()
  installs = []
  statuses = []
  ready = []
  failed = []
})

describe('on first run', () => {
  it('has no model for the worker, and installs Moonshine', () => {
    const models = controller()
    expect(models.installedModel()).toBeNull()
    models.ensure()
    expect(installs.map(({ entry }) => entry.id)).toEqual(['moonshine-base-en'])
  })

  it('hands the model to the worker when it is ready', async () => {
    const models = controller()
    models.ensure()
    installs[0]?.finish()
    await settle()
    expect(ready).toEqual(['moonshine-base-en'])
    expect(models.status.phase).toBe('idle')
  })

  it('reports each percent once', () => {
    controller().ensure()
    const before = statuses.length
    installs[0]?.progress('downloading', 0.421)
    installs[0]?.progress('downloading', 0.425)
    installs[0]?.progress('unpacking', 0.425)
    expect(statuses.slice(before)).toEqual([
      { phase: 'installing', stage: 'downloading', percent: 42 },
      { phase: 'installing', stage: 'unpacking', percent: 42 }
    ])
  })
})

describe('on later runs', () => {
  it('uses the model on disk without downloading or restarting the worker', () => {
    installed.add('moonshine-base-en')
    const models = controller()
    expect(models.installedModel()?.id).toBe('moonshine-base-en')
    models.ensure()
    expect(installs).toEqual([])
    expect(ready).toEqual([])
  })
})

describe('choosing another model', () => {
  it('downloads it, and the worker keeps the old one until then', async () => {
    installed.add('moonshine-base-en')
    const models = controller()
    models.select('parakeet-tdt-0.6b-v2-int8')
    expect(ready).toEqual([])
    installs[0]?.finish()
    await settle()
    expect(ready).toEqual(['parakeet-tdt-0.6b-v2-int8'])
  })

  it('switches straight away to one already on disk', () => {
    installed.add('moonshine-base-en').add('parakeet-tdt-0.6b-v2-int8')
    controller().select('parakeet-tdt-0.6b-v2-int8')
    expect(installs).toEqual([])
    expect(ready).toEqual(['parakeet-tdt-0.6b-v2-int8'])
  })

  it('waits for a running install, then gets the new choice', async () => {
    const models = controller()
    models.ensure()
    models.select('parakeet-tdt-0.6b-v2-int8')
    expect(installs).toHaveLength(1)
    installs[0]?.finish()
    await settle()
    expect(installs.map(({ entry }) => entry.id)).toEqual([
      'moonshine-base-en',
      'parakeet-tdt-0.6b-v2-int8'
    ])
    expect(ready).toEqual([])
    installs[1]?.finish()
    await settle()
    expect(ready).toEqual(['parakeet-tdt-0.6b-v2-int8'])
  })
})

describe('a failed install', () => {
  it('reports the code, offers a retry, and the retry works', async () => {
    const models = controller()
    models.ensure()
    installs[0]?.finish(new ModelError('MODEL_CORRUPT', 'bad'))
    await settle()
    expect(failed).toEqual(['MODEL_CORRUPT'])
    expect(models.status.phase).toBe('failed')
    expect(models.chosenStatus().phase).toBe('failed')

    models.ensure()
    installs[1]?.finish()
    await settle()
    expect(models.status.phase).toBe('idle')
    expect(models.chosenStatus().phase).toBe('ready')
    expect(ready).toEqual(['moonshine-base-en'])
  })

  it('reports anything unexpected as a failed download', async () => {
    controller().ensure()
    installs[0]?.finish(new Error('disk'))
    await settle()
    expect(failed).toEqual(['MODEL_DOWNLOAD_FAILED'])
  })
})

describe('for the settings screen', () => {
  it('lists every model, marking the choice and what is installed', () => {
    installed.add('moonshine-base-en')
    expect(controller().choices()).toEqual([
      {
        id: 'moonshine-base-en',
        label: 'Moonshine',
        size: '251 MB',
        installed: true,
        chosen: true
      },
      {
        id: 'parakeet-tdt-0.6b-v2-int8',
        label: 'Parakeet',
        size: '482 MB',
        installed: false,
        chosen: false
      }
    ])
  })

  it('shows the download as it goes', () => {
    const models = controller()
    models.ensure()
    expect(models.chosenStatus()).toMatchObject({ phase: 'downloading', percent: 0 })
  })

  it('switches back to the default for auto', () => {
    const models = controller()
    models.select('parakeet-tdt-0.6b-v2-int8')
    models.select('auto')
    expect(models.choices().find((entry) => entry.chosen)?.id).toBe('moonshine-base-en')
  })
})

describe('modelTitle', () => {
  it.each<[ModelStatus, string]>([
    [{ phase: 'idle' }, 'VoiceUp'],
    [{ phase: 'failed' }, 'VoiceUp - Speech model download failed'],
    [
      { phase: 'installing', stage: 'downloading', percent: 42 },
      'VoiceUp - Downloading speech model 42%'
    ],
    [{ phase: 'installing', stage: 'unpacking', percent: 7 }, 'VoiceUp - Unpacking speech model 7%']
  ])('titles %j', (status, title) => {
    expect(modelTitle(status)).toBe(title)
  })
})

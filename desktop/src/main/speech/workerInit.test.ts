import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetFakes } from '../../../test/fakes/electron'
import { defaultSettings } from '../../core/settingsMigrate'
import { sileroPath, workerInit } from './workerInit'

vi.mock('electron', () => import('../../../test/fakes/electron'))

beforeEach(resetFakes)

describe('workerInit', () => {
  it('passes each endpointing setting to the worker', () => {
    const { speech } = defaultSettings()
    const init = workerInit({
      ...speech,
      endSilenceSec: 2,
      minSpeechSec: 0.5,
      maxRecordingSec: 30,
      noSpeechTimeoutSec: 5
    })
    expect(init.vad).toEqual({
      endSilenceSec: 2,
      minSpeechSec: 0.5,
      maxRecordingSec: 30,
      noSpeechTimeoutSec: 5
    })
  })

  it('uses the same defaults as the settings when there are none, as in a smoke test', () => {
    const { endSilenceSec, minSpeechSec, maxRecordingSec, noSpeechTimeoutSec } =
      defaultSettings().speech
    expect(workerInit(undefined).vad).toEqual({
      endSilenceSec,
      minSpeechSec,
      maxRecordingSec,
      noSpeechTimeoutSec
    })
  })

  it('uses at least one thread and at most four', () => {
    const { numThreads } = workerInit(undefined)
    expect(numThreads).toBeGreaterThanOrEqual(1)
    expect(numThreads).toBeLessThanOrEqual(4)
  })
})

describe('sileroPath', () => {
  it('points outside the asar, because the addon opens files without asar support', () => {
    expect(sileroPath().replace('app.asar.unpacked', '')).not.toContain('app.asar')
    expect(sileroPath()).toMatch(/silero_vad\.onnx$/)
  })
})

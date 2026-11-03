import { describe, expect, it } from 'vitest'
import type { ModelEntry } from '../shared/models'
import { chooseModel, formatSize } from './modelChoice'

const moonshine = { id: 'moonshine-base-en' } as ModelEntry
const parakeet = { id: 'parakeet-tdt-0.6b-v2-int8' } as ModelEntry

describe('chooseModel', () => {
  it('takes the first model for auto', () => {
    expect(chooseModel([moonshine, parakeet], 'auto')).toBe(moonshine)
  })

  it('takes the named model', () => {
    expect(chooseModel([moonshine, parakeet], 'parakeet-tdt-0.6b-v2-int8')).toBe(parakeet)
  })

  it('falls back to the first when the manifest no longer has it', () => {
    expect(chooseModel([moonshine], 'parakeet-tdt-0.6b-v2-int8')).toBe(moonshine)
  })

  it('refuses an empty manifest', () => {
    expect(() => chooseModel([], 'auto')).toThrow('empty')
  })
})

describe('formatSize', () => {
  it.each([
    [0, '0 MB'],
    [250807309, '251 MB'],
    [1234000000, '1.2 GB']
  ])('shows %d as %s', (bytes, shown) => {
    expect(formatSize(bytes)).toBe(shown)
  })
})

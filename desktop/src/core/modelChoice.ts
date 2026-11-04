import type { ModelEntry } from '../shared/models'
import type { Settings } from '../shared/settings'

/** `auto` is the first model in the manifest, Moonshine (decision note S4.1). */
export function chooseModel(
  manifest: readonly ModelEntry[],
  modelId: Settings['speech']['modelId']
): ModelEntry {
  const first = manifest.at(0)
  if (first === undefined) throw new Error('The model manifest is empty')
  return manifest.find(({ id }) => id === modelId) ?? first
}

export function formatSize(bytes: number): string {
  return bytes < 1e9 ? `${String(Math.round(bytes / 1e6))} MB` : `${(bytes / 1e9).toFixed(1)} GB`
}

import { createHash } from 'node:crypto'
import type { ModelEntry } from '../../shared/models'
import { ModelManager } from './manager'

/**
 * test/fixtures/tiny-model.tar.bz2. Only a packaged build shows whether the extractor's packages
 * load and work, and a smoke test can't use the network, so the archive travels here.
 */
export const TINY_MODEL_BASE64 =
  'QlpoOTFBWSZTWVmGCLMAAilfg8KQQAP/gAFcAgDvb9/gAACIIRAIMAGKtoWEiRNU/SepD1D1NGhoNAepkG0EVITQAPU00AaAAAAqUmgUzRNAGgAAyZAy3BlobsLAeaMkDLA2NJ3iAWNMOqVSTaEUIITLWL+KFZmloroWRCKEFWRDs8tpFyDBBRBtxB3fkXM6ySCdScRDjbaLNgWW9HFOIUwBCrTVUVS7JsYhSIZLsJRCTOoa8uGsO5UVvhhVCsLDHHVCqLsYXytKp0QMgd8kp0nNtBVLoJ1LrxBRBCCCMLkKZpL7b6QohWR0qQ1+Z6G5dCk2dGmza6yxU7UtJsnzTvZlSxHBhcuNEjQsXfpfW0ojIzM6LveG9VaMVi9UsNI+kZM7cjJtFTkwYw5YatVW+GmGnPWJQK/A95yB0oMipRIoKxY4Y8DPOUSimioYkr80IshN+JwImGQShV/i7kinChILMMEWYA=='

/** Installs the tiny archive under the folder, from memory, and says if it worked. */
export async function checkModelInstall(root: string): Promise<boolean> {
  const archive = Buffer.from(TINY_MODEL_BASE64, 'base64')
  const entry: ModelEntry = {
    id: 'moonshine-base-en',
    label: 'Tiny',
    type: 'moonshine',
    url: 'https://localhost/unused',
    sha256: createHash('sha256').update(archive).digest('hex'),
    bytes: archive.length,
    dir: 'tiny-model',
    files: {
      preprocessor: 'preprocess.onnx',
      encoder: 'encode.onnx',
      uncachedDecoder: 'uncached.onnx',
      cachedDecoder: 'cached.onnx',
      tokens: 'tokens.txt'
    }
  }
  const manager = new ModelManager({ root, fetch: () => Promise.resolve(new Response(archive)) })
  await manager.install(entry, () => undefined)
  return manager.isInstalled(entry)
}

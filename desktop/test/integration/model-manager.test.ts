import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ModelError, ModelManager } from '../../src/main/models/manager'
import { checkModelInstall, TINY_MODEL_BASE64 } from '../../src/main/models/selfTest'
import { ModelManifest, type ModelEntry, type ModelId } from '../../src/shared/models'

// A real HTTP server and a real, tiny .tar.bz2 (TECH_SPEC §8): resume, corrupt hash and 404.
const ARCHIVE = readFileSync(join(__dirname, '../fixtures/tiny-model.tar.bz2'))
const SHA256 = createHash('sha256').update(ARCHIVE).digest('hex')

let root: string
let server: Server
let baseUrl: string
let requests: { range: string | undefined }[]
let serve: Buffer
let status: number | undefined
let honoursRange: boolean

function entry(overrides: Partial<ModelEntry> = {}): ModelEntry {
  return {
    id: 'tiny' as ModelId,
    label: 'Tiny',
    type: 'moonshine',
    // A local http server. The schema, which holds the app's manifest to https, isn't involved.
    url: `${baseUrl}/tiny.tar.bz2`,
    sha256: SHA256,
    bytes: ARCHIVE.length,
    dir: 'tiny-model',
    files: {
      preprocessor: 'preprocess.onnx',
      encoder: 'encode.onnx',
      uncachedDecoder: 'uncached.onnx',
      cachedDecoder: 'cached.onnx',
      tokens: 'tokens.txt'
    },
    ...overrides
  } as ModelEntry
}

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'voiceup-models-'))
  requests = []
  serve = ARCHIVE
  status = undefined
  honoursRange = true
  server = createServer((request, response) => {
    const range = request.headers.range
    requests.push({ range })
    if (status !== undefined) {
      response.statusCode = status
      response.end()
      return
    }
    if (range !== undefined && honoursRange) {
      const from = Number(/bytes=(\d+)-/.exec(range)?.[1])
      response.statusCode = 206
      response.end(serve.subarray(from))
      return
    }
    response.end(serve)
  })
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', resolve)
  })
  baseUrl = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
})

afterEach(async () => {
  await new Promise((resolve) => {
    server.close(resolve)
  })
  rmSync(root, { recursive: true, force: true })
})

const manager = (): ModelManager => new ModelManager({ root })
const noProgress = (): void => undefined

async function failure(install: Promise<void>): Promise<ModelError> {
  const error = await install.then(
    () => undefined,
    (reason: unknown) => reason
  )
  if (!(error instanceof ModelError)) throw new Error(`Expected a ModelError, got ${String(error)}`)
  return error
}

describe('installing a model', () => {
  it('downloads, verifies and unpacks the model', async () => {
    await manager().install(entry(), noProgress)
    expect(manager().isInstalled(entry())).toBe(true)
    expect(readFileSync(join(root, 'tiny', 'tokens.txt'), 'utf8')).toContain('tokens')
  })

  it('leaves no temporary files behind', async () => {
    await manager().install(entry(), noProgress)
    expect(existsSync(join(root, 'tiny.partial'))).toBe(false)
    expect(existsSync(join(root, 'tiny.tmp'))).toBe(false)
  })

  it('writes only the files the manifest names', async () => {
    await manager().install(entry(), noProgress)
    expect(existsSync(join(root, 'tiny', 'test_wavs'))).toBe(false)
    expect(existsSync(join(root, 'tiny', 'extra.txt'))).toBe(false)
  })

  it('reports progress up to the end of each phase', async () => {
    const seen: Record<string, number> = {}
    await manager().install(entry(), (phase, fraction) => {
      seen[phase] = fraction
    })
    expect(seen).toEqual({ downloading: 1, unpacking: 1 })
  })

  it('gives paths the worker can use', async () => {
    await manager().install(entry(), noProgress)
    const paths = manager().paths(entry())
    expect(paths.type).toBe('moonshine')
    expect(existsSync(paths.tokens)).toBe(true)
    expect(existsSync(paths.encoder)).toBe(true)
  })
})

describe('resuming', () => {
  it('asks only for what is missing, and the result still verifies', async () => {
    const half = Math.floor(ARCHIVE.length / 2)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'tiny.partial'), ARCHIVE.subarray(0, half))
    await manager().install(entry(), noProgress)
    expect(requests).toEqual([{ range: `bytes=${String(half)}-` }])
    expect(manager().isInstalled(entry())).toBe(true)
  })

  it('starts over when the server ignores the range', async () => {
    honoursRange = false
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'tiny.partial'), ARCHIVE.subarray(0, 10))
    await manager().install(entry(), noProgress)
    expect(manager().isInstalled(entry())).toBe(true)
  })

  it('skips the download when the whole file is already there', async () => {
    writeFileSync(join(root, 'tiny.partial'), ARCHIVE)
    await manager().install(entry(), noProgress)
    expect(requests).toEqual([])
    expect(manager().isInstalled(entry())).toBe(true)
  })

  it('catches a resumed file with a bad first half', async () => {
    const half = Math.floor(ARCHIVE.length / 2)
    writeFileSync(join(root, 'tiny.partial'), Buffer.alloc(half))
    const error = await failure(manager().install(entry(), noProgress))
    expect(error.code).toBe('MODEL_CORRUPT')
  })
})

describe('failures', () => {
  it('reports a wrong checksum, deletes the file, and installs nothing', async () => {
    serve = Buffer.from('not the model')
    const error = await failure(manager().install(entry(), noProgress))
    expect(error.code).toBe('MODEL_CORRUPT')
    expect(existsSync(join(root, 'tiny.partial'))).toBe(false)
    expect(manager().isInstalled(entry())).toBe(false)
  })

  it('reports a 404, and installs nothing', async () => {
    status = 404
    const error = await failure(manager().install(entry(), noProgress))
    expect(error.code).toBe('MODEL_DOWNLOAD_FAILED')
    expect(error.message).toContain('404')
    expect(manager().isInstalled(entry())).toBe(false)
  })

  it('reports no connection, and keeps the partial file for later', async () => {
    writeFileSync(join(root, 'tiny.partial'), ARCHIVE.subarray(0, 10))
    const unreachable = new ModelManager({
      root,
      fetch: () => Promise.reject(new Error('offline'))
    })
    const error = await failure(unreachable.install(entry(), noProgress))
    expect(error.code).toBe('MODEL_DOWNLOAD_FAILED')
    expect(existsSync(join(root, 'tiny.partial'))).toBe(true)
  })

  it('reports an archive missing a file the manifest needs, and installs nothing', async () => {
    const missing = entry({
      files: {
        preprocessor: 'preprocess.onnx',
        encoder: 'encode.onnx',
        uncachedDecoder: 'uncached.onnx',
        cachedDecoder: 'cached.onnx',
        tokens: 'not-in-the-archive.txt'
      }
    })
    const error = await failure(manager().install(missing, noProgress))
    expect(error.code).toBe('MODEL_CORRUPT')
    expect(existsSync(join(root, 'tiny'))).toBe(false)
    expect(existsSync(join(root, 'tiny.tmp'))).toBe(false)
  })
})

describe('isInstalled', () => {
  it('is false for a model never downloaded', () => {
    expect(manager().isInstalled(entry())).toBe(false)
  })

  it('is false when a file is missing or empty', async () => {
    await manager().install(entry(), noProgress)
    writeFileSync(join(root, 'tiny', 'tokens.txt'), '')
    expect(manager().isInstalled(entry())).toBe(false)
  })
})

describe('diskUsageBytes', () => {
  it('is zero with no models', () => {
    expect(new ModelManager({ root: join(root, 'nowhere') }).diskUsageBytes()).toBe(0)
  })

  it('counts an installed model', async () => {
    await manager().install(entry(), noProgress)
    expect(manager().diskUsageBytes()).toBeGreaterThan(0)
  })
})

describe('the bundled manifest', () => {
  it('is valid, with Moonshine first as the default', () => {
    const manifest = ModelManifest.parse(
      JSON.parse(readFileSync(join(__dirname, '../../resources/models.json'), 'utf8'))
    )
    expect(manifest.map(({ id }) => id)).toEqual(['moonshine-base-en', 'parakeet-tdt-0.6b-v2-int8'])
  })

  it.each([
    ['bad checksum', { sha256: 'abc' }],
    ['non-web url', { url: 'file:///C:/model.tar.bz2' }],
    ['plain http url', { url: 'http://example.com/m' }],
    ['model the settings do not know', { id: 'tiny' }],
    ['no size', { bytes: 0 }]
  ])('rejects a %s', (_label, change) => {
    const valid = { ...entry(), id: 'moonshine-base-en', url: 'https://example.com/m' }
    expect(ModelManifest.safeParse([valid]).success).toBe(true)
    expect(ModelManifest.safeParse([{ ...valid, ...change }]).success).toBe(false)
  })
})

describe('the packaged smoke test', () => {
  it('carries the same archive as the fixture', () => {
    expect(Buffer.from(TINY_MODEL_BASE64, 'base64').equals(ARCHIVE)).toBe(true)
  })

  it('passes', async () => {
    await expect(checkModelInstall(root)).resolves.toBe(true)
  })
})

// Set VOICEUP_TEST_MODELS to a folder holding the downloaded archive and its unpacked copy.
const realModels = process.env.VOICEUP_TEST_MODELS
describe.skipIf(realModels === undefined)('the real Moonshine archive', () => {
  it('installs byte for byte', { timeout: 240000 }, async () => {
    const dir = realModels ?? ''
    const moonshine = ModelManifest.parse(
      JSON.parse(readFileSync(join(__dirname, '../../resources/models.json'), 'utf8'))
    ).find(({ id }) => id === 'moonshine-base-en')
    if (moonshine === undefined) throw new Error('Moonshine is not in the manifest')
    const archive = readFileSync(join(dir, `${moonshine.dir}.tar.bz2`))
    const real = new ModelManager({ root, fetch: () => Promise.resolve(new Response(archive)) })
    await real.install(moonshine, noProgress)
    for (const file of Object.values(moonshine.files)) {
      const installed = readFileSync(join(root, moonshine.id, file))
      expect(installed.equals(readFileSync(join(dir, moonshine.dir, file))), file).toBe(true)
    }
  })
})

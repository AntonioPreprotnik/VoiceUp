import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, readdirSync, statSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Transform, type Readable } from 'node:stream'
import tar from 'tar-stream'
import unbzip2 from 'unbzip2-stream'
import type { ModelEntry } from '../../shared/models'
import type { ModelPaths } from '../../shared/worker'

export type ModelErrorCode = 'MODEL_CORRUPT' | 'MODEL_DOWNLOAD_FAILED'

export class ModelError extends Error {
  constructor(
    readonly code: ModelErrorCode,
    message: string
  ) {
    super(message)
  }
}

export type ModelPhase = 'downloading' | 'unpacking'
export type ModelProgress = (phase: ModelPhase, fraction: number) => void

export interface ModelManagerOptions {
  /** Where models live, userData/models. */
  readonly root: string
  /** Electron's net.fetch in the app, which honours the system proxy. */
  readonly fetch?: (url: string, init: RequestInit) => Promise<Response>
}

/** Downloads, verifies and unpacks speech models (TECH_SPEC §5.4). */
export class ModelManager {
  private readonly fetch: NonNullable<ModelManagerOptions['fetch']>

  constructor(private readonly options: ModelManagerOptions) {
    this.fetch = options.fetch ?? globalThis.fetch
  }

  private installDir(entry: ModelEntry): string {
    return join(this.options.root, entry.id)
  }

  /** Presence and size only: the full hash runs once, at download. */
  isInstalled(entry: ModelEntry): boolean {
    return Object.values(entry.files).every((file) => {
      const path = join(this.installDir(entry), file)
      return existsSync(path) && statSync(path).size > 0
    })
  }

  paths(entry: ModelEntry): ModelPaths {
    const dir = this.installDir(entry)
    if (entry.type === 'moonshine') {
      const { preprocessor, encoder, uncachedDecoder, cachedDecoder, tokens } = entry.files
      return {
        type: 'moonshine',
        preprocessor: join(dir, preprocessor),
        encoder: join(dir, encoder),
        uncachedDecoder: join(dir, uncachedDecoder),
        cachedDecoder: join(dir, cachedDecoder),
        tokens: join(dir, tokens)
      }
    }
    const { encoder, decoder, joiner, tokens } = entry.files
    return {
      type: 'nemo_transducer',
      encoder: join(dir, encoder),
      decoder: join(dir, decoder),
      joiner: join(dir, joiner),
      tokens: join(dir, tokens)
    }
  }

  /** Bytes on disk for every model, including a partial download. */
  diskUsageBytes(): number {
    const { root } = this.options
    if (!existsSync(root)) return 0
    return readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((item) => item.isFile())
      .reduce((total, item) => total + statSync(join(item.parentPath, item.name)).size, 0)
  }

  async install(entry: ModelEntry, onProgress: ModelProgress): Promise<void> {
    await mkdir(this.options.root, { recursive: true })
    const partial = join(this.options.root, `${entry.id}.partial`)
    await this.download(entry, partial, onProgress)
    await this.verify(entry, partial)
    await this.unpack(entry, partial, onProgress)
    await rm(partial, { force: true })
  }

  private async download(
    entry: ModelEntry,
    partial: string,
    onProgress: ModelProgress
  ): Promise<void> {
    const existing = await stat(partial).then(
      ({ size }) => size,
      () => 0
    )
    if (existing >= entry.bytes) return

    const response = await this.request(entry, existing)
    // 206 means the server is resuming. Anything else with a body is the whole file again.
    const resuming = response.status === 206
    if (!response.ok && !resuming) {
      throw new ModelError(
        'MODEL_DOWNLOAD_FAILED',
        `The server answered ${String(response.status)}`
      )
    }
    if (response.body === null)
      throw new ModelError('MODEL_DOWNLOAD_FAILED', 'The answer had no body')

    let received = resuming ? existing : 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        received += chunk.length
        onProgress('downloading', Math.min(1, received / entry.bytes))
        done(null, chunk)
      }
    })
    try {
      await pipeline(
        response.body as unknown as Readable,
        counter,
        createWriteStream(partial, { flags: resuming ? 'a' : 'w' })
      )
    } catch (error: unknown) {
      // The partial file stays, so the next attempt resumes from it.
      throw new ModelError('MODEL_DOWNLOAD_FAILED', `The download stopped: ${String(error)}`)
    }
  }

  private async request(entry: ModelEntry, from: number): Promise<Response> {
    try {
      return await this.fetch(
        entry.url,
        from > 0 ? { headers: { Range: `bytes=${String(from)}-` } } : {}
      )
    } catch (error: unknown) {
      throw new ModelError('MODEL_DOWNLOAD_FAILED', `Could not connect: ${String(error)}`)
    }
  }

  /** Hashes the finished file, so a resumed download is covered from its first byte. */
  private async verify(entry: ModelEntry, partial: string): Promise<void> {
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(partial)) hash.update(chunk as Buffer)
    if (hash.digest('hex') !== entry.sha256) {
      await rm(partial, { force: true })
      throw new ModelError('MODEL_CORRUPT', `The download of ${entry.id} failed its checksum`)
    }
  }

  /**
   * Writes only the files the manifest names, so a bad archive can't place anything else on disk.
   * Into a temporary folder and renamed at the end, so a model is never half there.
   */
  private async unpack(
    entry: ModelEntry,
    partial: string,
    onProgress: ModelProgress
  ): Promise<void> {
    const temp = join(this.options.root, `${entry.id}.tmp`)
    await rm(temp, { recursive: true, force: true })
    await mkdir(temp, { recursive: true })

    const wanted = new Map(
      Object.values(entry.files).map((file) => [`${entry.dir}/${file}`, join(temp, file)])
    )
    const extract = tar.extract()
    extract.on('entry', (header, stream, next) => {
      const target = header.type === 'file' ? wanted.get(header.name) : undefined
      if (target === undefined) {
        stream.on('end', () => {
          next()
        })
        stream.resume()
        return
      }
      mkdir(dirname(target), { recursive: true })
        .then(() => pipeline(stream, createWriteStream(target)))
        .then(() => {
          wanted.delete(header.name)
          next()
        })
        .catch(next)
    })

    let read = 0
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        read += chunk.length
        onProgress('unpacking', Math.min(1, read / entry.bytes))
        done(null, chunk)
      }
    })
    try {
      await pipeline(createReadStream(partial), counter, unbzip2(), extract)
      if (wanted.size > 0) {
        throw new Error(`The archive was missing ${[...wanted.keys()].join(', ')}`)
      }
    } catch (error: unknown) {
      await rm(temp, { recursive: true, force: true })
      await rm(partial, { force: true })
      throw new ModelError('MODEL_CORRUPT', `Could not unpack ${entry.id}: ${String(error)}`)
    }

    const dir = this.installDir(entry)
    await rm(dir, { recursive: true, force: true })
    await rename(temp, dir)
  }
}

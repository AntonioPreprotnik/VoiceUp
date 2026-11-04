import { randomBytes, timingSafeEqual } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { parseHook, type HookMessage, type UnexpectedReason } from '../../shared/hooks'
import { log } from '../log'

const MAX_BODY_BYTES = 1024 * 1024
const HOOK_URL = /^\/hooks\/([A-Za-z]{1,40})$/
// Hooks come from this machine and answer at once, so a slow request is never a real one.
const HEADERS_TIMEOUT_MS = 5000
const REQUEST_TIMEOUT_MS = 10000
const NO_NAME = '<invalid>'

export interface HookServerOptions {
  /** Every request with a valid token ends up here, in the order its body finished arriving. */
  readonly onMessage: (message: HookMessage) => void
}

/**
 * Receives Claude Code's hooks (TECH_SPEC §6.3). After a valid token it always answers 200 with an
 * empty body, whatever it was sent: anything else would show an error inside Claude, and a JSON
 * answer could change what Claude does.
 */
export class HookServer {
  /** Per launch. Reaches Claude through its environment and a header file (§4.2). */
  readonly token = randomBytes(32).toString('hex')
  private server: Server | undefined

  constructor(private readonly options: HookServerOptions) {}

  /** Resolves with the port. Only ever on loopback. */
  start(): Promise<number> {
    const server = createServer((request, response) => {
      this.handle(request, response)
    })
    server.headersTimeout = HEADERS_TIMEOUT_MS
    server.requestTimeout = REQUEST_TIMEOUT_MS
    this.server = server
    return new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', reject)
        server.on('error', (error) => {
          log.error('Hook server error:', error.message)
        })
        resolve((server.address() as AddressInfo).port)
      })
    })
  }

  stop(): Promise<void> {
    const { server } = this
    this.server = undefined
    if (server === undefined) return Promise.resolve()
    return new Promise((resolve) => {
      server.close((error) => {
        if (error !== undefined) log.warn('Hook server close failed:', error.message)
        resolve()
      })
      server.closeAllConnections()
    })
  }

  private tokenMatches(request: IncomingMessage): boolean {
    const given = request.headers['x-voiceup-token']
    if (typeof given !== 'string') return false
    const expected = Buffer.from(this.token)
    const actual = Buffer.from(given)
    return actual.length === expected.length && timingSafeEqual(actual, expected)
  }

  private handle(request: IncomingMessage, response: ServerResponse): void {
    if (!this.tokenMatches(request)) {
      log.warn('Hook server rejected a request with a bad token')
      // Unread, so a caller without the token can't make this hold on to anything.
      response.writeHead(401, { Connection: 'close' }).end()
      return
    }
    const name = HOOK_URL.exec(request.url ?? '')?.[1]
    let chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) chunks = []
      else chunks.push(chunk)
    })
    request.on('error', (error) => {
      log.warn('A hook request failed:', error.message)
    })
    request.on('end', () => {
      response.writeHead(200).end()
      if (request.method !== 'POST' || name === undefined) {
        this.unexpected(name ?? NO_NAME, 'bad request')
      } else if (size > MAX_BODY_BYTES) {
        this.unexpected(name, 'body too large')
      } else {
        this.deliver(parseHook(name, Buffer.concat(chunks).toString('utf8')))
      }
    })
  }

  private unexpected(name: string, reason: UnexpectedReason): void {
    this.deliver({ kind: 'unexpected', name, reason })
  }

  private deliver(message: HookMessage): void {
    // Names only, even at debug: a body can hold a prompt or a tool's input.
    if (message.kind === 'hook') log.debug(`Hook: ${message.hook.hook_event_name}`)
    else log.warn(`Unexpected hook ${message.name}: ${message.reason}`)
    try {
      this.options.onMessage(message)
    } catch (error: unknown) {
      log.error('Handling a hook failed:', error instanceof Error ? error.message : String(error))
    }
  }
}

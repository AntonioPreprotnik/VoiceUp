import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { net, protocol } from 'electron'
import { APP_SCHEME, appUrlToRelativePath } from '../core/appUrl'
import { log } from './log'

/**
 * Security rule 3: renderers load over app://, never file:// or a remote URL. Must run before
 * app ready. getUserMedia and AudioWorklet need the secure context that `secure` provides.
 */
export function registerAppScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: APP_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** Serves app:// from the renderer folder only. Anything else gets a 404. */
export function serveAppProtocol(rendererRoot: string): void {
  protocol.handle(APP_SCHEME, (request) => {
    const relativePath = request.method === 'GET' ? appUrlToRelativePath(request.url) : null
    if (relativePath === null) {
      log.warn(`Rejected app:// request: ${request.method} ${request.url}`)
      return new Response(null, { status: 404 })
    }
    return net.fetch(pathToFileURL(join(rendererRoot, relativePath)).href)
  })
}

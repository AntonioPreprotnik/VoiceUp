// URL policy for renderers (TECH_SPEC §7.1, security rules 3 and 8): bundled pages load over
// app://, and only an unpackaged build may also use the dev server.

export const APP_SCHEME = 'app'
const APP_BASE_URL = `${APP_SCHEME}://voiceup/`

export interface RendererMode {
  readonly isPackaged: boolean
  readonly devServerUrl: string | undefined
}

function parseUrl(raw: string): URL | undefined {
  return URL.canParse(raw) ? new URL(raw) : undefined
}

function isAppUrl(url: URL): boolean {
  return (
    url.protocol === `${APP_SCHEME}:` &&
    url.hostname === 'voiceup' &&
    url.port === '' &&
    url.username === '' &&
    url.password === ''
  )
}

/** The dev server origin when this build may use it, otherwise undefined. */
function allowedDevOrigin(mode: RendererMode): string | undefined {
  if (mode.isPackaged || mode.devServerUrl === undefined) return undefined
  const origin = parseUrl(mode.devServerUrl)?.origin
  return origin === 'null' ? undefined : origin
}

/** Where a renderer entry loads from. A packaged build ignores any dev server URL. */
export function rendererEntryUrl(entry: string, mode: RendererMode): string {
  const base = allowedDevOrigin(mode) ?? APP_BASE_URL
  return new URL(`${entry}/index.html`, base).href
}

/** Whether a frame at this URL may talk to the main process. */
export function isTrustedRendererUrl(rawUrl: string, mode: RendererMode): boolean {
  const url = parseUrl(rawUrl)
  if (url === undefined) return false
  return isAppUrl(url) || url.origin === allowedDevOrigin(mode)
}

/**
 * The file an app:// request maps to, relative to the renderer folder, or null if the URL is
 * foreign or tries to leave that folder.
 */
export function appUrlToRelativePath(rawUrl: string): string | null {
  const url = parseUrl(rawUrl)
  if (url === undefined || !isAppUrl(url)) return null

  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    // Malformed percent-encoding: the caller rejects the request and logs it.
    return null
  }

  const relative = path.replace(/^\/+/, '')
  if (relative === '' || /[\\:\0]/.test(relative)) return null
  const segments = relative.split('/')
  return segments.some((segment) => segment === '' || segment === '.' || segment === '..')
    ? null
    : relative
}

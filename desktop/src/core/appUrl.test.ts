import { describe, expect, it } from 'vitest'
import {
  appUrlToRelativePath,
  isTrustedRendererUrl,
  rendererEntryUrl,
  type RendererMode
} from './appUrl'

const DEV_URL = 'http://localhost:5173'
const packagedWithDevUrl: RendererMode = { isPackaged: true, devServerUrl: DEV_URL }
const packaged: RendererMode = { isPackaged: true, devServerUrl: undefined }
const dev: RendererMode = { isPackaged: false, devServerUrl: DEV_URL }
const unpackagedNoServer: RendererMode = { isPackaged: false, devServerUrl: undefined }

describe('rendererEntryUrl', () => {
  it('uses app:// when packaged, even if a dev server URL is set', () => {
    expect(rendererEntryUrl('terminal', packagedWithDevUrl)).toBe(
      'app://voiceup/terminal/index.html'
    )
  })

  it('uses the dev server only when unpackaged', () => {
    expect(rendererEntryUrl('terminal', dev)).toBe('http://localhost:5173/terminal/index.html')
  })

  it('falls back to app:// when unpackaged without a dev server', () => {
    expect(rendererEntryUrl('terminal', unpackagedNoServer)).toBe(
      'app://voiceup/terminal/index.html'
    )
  })

  it('falls back to app:// when the dev server URL is invalid', () => {
    const mode: RendererMode = { isPackaged: false, devServerUrl: 'not a url' }
    expect(rendererEntryUrl('terminal', mode)).toBe('app://voiceup/terminal/index.html')
  })
})

describe('isTrustedRendererUrl when packaged', () => {
  it('accepts app://', () => {
    expect(isTrustedRendererUrl('app://voiceup/terminal/index.html', packagedWithDevUrl)).toBe(true)
  })

  it.each([
    ['the dev server', 'http://localhost:5173/terminal/index.html'],
    ['file://', 'file:///C:/app/index.html'],
    ['https', 'https://example.com/'],
    ['another app:// host', 'app://evil/terminal/index.html'],
    ['app:// with a port', 'app://voiceup:1234/x'],
    ['app:// with credentials', 'app://user:pw@voiceup/x'],
    ['a lookalike scheme', 'apps://voiceup/x'],
    ['about:blank', 'about:blank'],
    ['data:', 'data:text/html,hi'],
    ['an empty URL', ''],
    ['garbage', 'not a url']
  ])('rejects %s', (_label, url) => {
    expect(isTrustedRendererUrl(url, packagedWithDevUrl)).toBe(false)
  })

  it('rejects the dev server when no URL is set', () => {
    expect(isTrustedRendererUrl('http://localhost:5173/', packaged)).toBe(false)
  })
})

describe('isTrustedRendererUrl when unpackaged', () => {
  it('accepts app:// and the exact dev origin', () => {
    expect(isTrustedRendererUrl('app://voiceup/x', dev)).toBe(true)
    expect(isTrustedRendererUrl('http://localhost:5173/terminal/index.html', dev)).toBe(true)
  })

  it.each([
    ['another port', 'http://localhost:5174/'],
    ['another host', 'http://127.0.0.1:5173/'],
    ['another protocol', 'https://localhost:5173/'],
    ['file://', 'file:///C:/app/index.html']
  ])('rejects %s', (_label, url) => {
    expect(isTrustedRendererUrl(url, dev)).toBe(false)
  })

  it('does not trust opaque origins through an opaque dev server URL', () => {
    const mode: RendererMode = { isPackaged: false, devServerUrl: 'data:text/html,hi' }
    expect(isTrustedRendererUrl('data:text/html,hi', mode)).toBe(false)
  })
})

describe('appUrlToRelativePath', () => {
  it.each([
    ['app://voiceup/terminal/index.html', 'terminal/index.html'],
    ['app://voiceup/assets/a%20b.js', 'assets/a b.js'],
    ['app://voiceup/terminal/index.html?x=1#y', 'terminal/index.html'],
    ['app://voiceup/a/../b.js', 'b.js']
  ])('maps %s', (url, expected) => {
    expect(appUrlToRelativePath(url)).toBe(expected)
  })

  it.each([
    ['the root', 'app://voiceup/'],
    ['a foreign host', 'app://evil/index.html'],
    ['another scheme', 'file:///C:/index.html'],
    ['traversal that stays literal', 'app://voiceup/%2e%2e%2f%2e%2e%2fsecret'],
    ['an encoded separator', 'app://voiceup/a%2f..%2fb'],
    ['an encoded backslash', 'app://voiceup/..%5csecret'],
    ['a backslash path', 'app://voiceup/a%5cb'],
    ['a drive letter', 'app://voiceup/C:/Windows/win.ini'],
    ['an alternate data stream', 'app://voiceup/a.js:stream'],
    ['a NUL byte', 'app://voiceup/a%00.js'],
    ['an empty segment', 'app://voiceup/a//b'],
    ['malformed encoding', 'app://voiceup/%E0%A4%A'],
    ['garbage', 'not a url']
  ])('rejects %s', (_label, url) => {
    expect(appUrlToRelativePath(url)).toBeNull()
  })
})

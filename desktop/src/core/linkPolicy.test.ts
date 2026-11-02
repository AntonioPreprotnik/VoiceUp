import { describe, expect, it } from 'vitest'
import { isAllowedLink } from './linkPolicy'

describe('isAllowedLink', () => {
  it.each([
    'https://example.com',
    'https://example.com/a/b?c=d#e',
    'HTTPS://EXAMPLE.COM/',
    'https://example.com:8443/path'
  ])('allows %s', (url) => {
    expect(isAllowedLink(url)).toBe(true)
  })

  it.each([
    ['http', 'http://example.com'],
    ['file', 'file:///C:/Windows/System32/calc.exe'],
    ['a UNC path', '\\\\server\\share\\run.exe'],
    ['javascript', 'javascript:alert(1)'],
    ['data', 'data:text/html,hi'],
    ['the settings handler', 'ms-settings:privacy-microphone'],
    ['a custom protocol', 'vscode://file/C:/x'],
    ['a search handler', 'search-ms:query=x'],
    ['credentials, a phishing trick', 'https://example.com@evil.test/'],
    ['a password', 'https://user:pw@example.com/'],
    ['a scheme lookalike', 'httpsx://example.com'],
    ['no scheme', 'example.com'],
    ['nothing', ''],
    ['garbage', 'not a url']
  ])('blocks %s', (_label, url) => {
    expect(isAllowedLink(url)).toBe(false)
  })
})

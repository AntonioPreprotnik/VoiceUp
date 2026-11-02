import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Security rule 4: every renderer page carries the strict CSP.
const RENDERER_ROOT = join(__dirname, '../../src/renderer')
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; media-src 'self' blob:"

const pages = readdirSync(RENDERER_ROOT, { recursive: true, encoding: 'utf8' }).filter((file) =>
  file.endsWith('.html')
)

describe('renderer pages', () => {
  it('exist', () => {
    expect(pages.length).toBeGreaterThan(0)
  })

  it.each(pages)('%s has the strict CSP', (page) => {
    const html = readFileSync(join(RENDERER_ROOT, page), 'utf8')
    const match = /http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html)
    expect(match?.[1]).toBe(CSP)
  })

  it.each(pages)('%s loads nothing remote', (page) => {
    const html = readFileSync(join(RENDERER_ROOT, page), 'utf8')
    expect(html).not.toMatch(/(?:src|href)="(?:https?:)?\/\//)
  })
})

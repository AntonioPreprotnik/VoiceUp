import { describe, expect, it } from 'vitest'
import { chunkInput } from './chunkInput'
import { MAX_TERM_INPUT_CHARS, TermAck, TermInput, TermResize } from './ipc'

describe('term:* schemas', () => {
  it('accepts input up to the limit and rejects more', () => {
    expect(TermInput.safeParse('x'.repeat(MAX_TERM_INPUT_CHARS)).success).toBe(true)
    expect(TermInput.safeParse('x'.repeat(MAX_TERM_INPUT_CHARS + 1)).success).toBe(false)
  })

  it.each([5, null, undefined, {}])('rejects non-string input: %s', (value) => {
    expect(TermInput.safeParse(value).success).toBe(false)
  })

  it('accepts a whole-number size, even out of range, because the receiver clamps it', () => {
    expect(TermResize.safeParse({ cols: 99999, rows: 0 }).success).toBe(true)
  })

  it.each([{ cols: 1.5, rows: 2 }, { cols: 1 }, { cols: '80', rows: 24 }, 80, null])(
    'rejects a bad size: %j',
    (value) => {
      expect(TermResize.safeParse(value).success).toBe(false)
    }
  )

  it.each([0, 100])('accepts an ack of %s', (value) => {
    expect(TermAck.safeParse(value).success).toBe(true)
  })

  it.each([-1, 1.5, '5', null])('rejects an ack of %s', (value) => {
    expect(TermAck.safeParse(value).success).toBe(false)
  })
})

describe('chunkInput', () => {
  it('returns nothing for empty input', () => {
    expect(chunkInput('', 4)).toEqual([])
  })

  it('leaves short input whole', () => {
    expect(chunkInput('abc', 4)).toEqual(['abc'])
  })

  it('splits long input and loses nothing', () => {
    expect(chunkInput('abcdefghij', 4)).toEqual(['abcd', 'efgh', 'ij'])
  })

  it('does not cut a surrogate pair', () => {
    const chunks = chunkInput('abc😀def', 4)
    expect(chunks).toEqual(['abc', '😀de', 'f'])
    expect(chunks.join('')).toBe('abc😀def')
  })

  it('still makes progress when the limit fits only half a pair', () => {
    expect(chunkInput('😀', 1).join('')).toBe('😀')
  })
})

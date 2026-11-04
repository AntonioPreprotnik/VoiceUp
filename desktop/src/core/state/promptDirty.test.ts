import { describe, expect, it } from 'vitest'
import { dirtyAfterInput } from './promptDirty'

describe('input at the main prompt', () => {
  it.each([
    ['a letter', 'a'],
    ['a word', 'hello'],
    ['a paste', '\x1b[200~text\x1b[201~'],
    ['Backspace, which may be editing text', '\x7f'],
    ['Delete', '\x1b[3~'],
    ['Up, which recalls history', '\x1b[A'],
    ['Down', '\x1b[B'],
    ['an escape sequence nobody knows', '\x1b[99;99~'],
    ['Tab', '\t'],
    ['Ctrl+U', '\x15']
  ])('%s makes it dirty', (_label, data) => {
    expect(dirtyAfterInput(false, data, 'idle')).toBe(true)
  })

  it.each([
    ['focus gained', '\x1b[I'],
    ['focus lost', '\x1b[O'],
    ['an SGR mouse press', '\x1b[<0;10;5M'],
    ['an SGR mouse release', '\x1b[<0;10;5m'],
    ['several mouse reports together', '\x1b[<64;1;1M\x1b[<64;1;1M'],
    ['a legacy mouse report', '\x1b[M !!'],
    ['Page Up', '\x1b[5~'],
    ['Page Down', '\x1b[6~']
  ])('%s changes nothing', (_label, data) => {
    expect(dirtyAfterInput(false, data, 'idle')).toBe(false)
    expect(dirtyAfterInput(true, data, 'idle')).toBe(true)
  })

  it.each([
    ['Enter', '\r'],
    ['Esc', '\x1b']
  ])('%s adds no text, and clears none', (_label, data) => {
    expect(dirtyAfterInput(false, data, 'idle')).toBe(false)
    expect(dirtyAfterInput(true, data, 'idle')).toBe(true)
  })

  it('counts typing while Claude works, which waits in the prompt', () => {
    expect(dirtyAfterInput(false, 'a', 'busy')).toBe(true)
  })

  it('counts typing while unknown, since the prompt may be there', () => {
    expect(dirtyAfterInput(false, 'a', 'unknown')).toBe(true)
  })
})

describe('keys that answer something else', () => {
  it.each(['awaitingPermission', 'awaitingInput', 'starting', 'exited'] as const)(
    'do not reach the prompt while %s',
    (state) => {
      expect(dirtyAfterInput(false, '1', state)).toBe(false)
      expect(dirtyAfterInput(false, '\x1b[B', state)).toBe(false)
    }
  )

  it('leave text that was already there', () => {
    expect(dirtyAfterInput(true, '1', 'awaitingPermission')).toBe(true)
  })
})

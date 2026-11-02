import { describe, expect, it } from 'vitest'
import { hasVisibleText } from './terminalText'

describe('hasVisibleText', () => {
  it.each([
    ['nothing', ''],
    ['whitespace', ' \r\n\t '],
    ['the terminal reset', '\x1bc'],
    ['a clear and cursor home', '\x1b[2J\x1b[m\x1b[H'],
    ['private mode switches', '\x1b[?2004h\x1b[?1004h\x1b[?25l'],
    ['a window title ending in BEL', '\x1b]0;C:\\Windows\\System32\\cmd.exe\x07'],
    ['a window title ending in ST', '\x1b]0;claude\x1b\\'],
    ['a title with no end yet', '\x1b]0;claude'],
    ['erase-line codes with spaces', '\x1b[K \x1b[K \x1b[K'],
    ['what a new session really sent first', '\x1b[2J\x1b[m\x1b[H\x1b]0;cmd.exe\x07\x1b[?25h']
  ])('finds none in %s', (_label, data) => {
    expect(hasVisibleText(data)).toBe(false)
  })

  it.each([
    ['plain text', 'Welcome'],
    ['text among codes', '\x1b[1mWelcome\x1b[0m'],
    ['a box-drawing character', '\x1b[38;5;2m╭\x1b[0m'],
    ['text after a title', '\x1b]0;claude\x07Hello'],
    ['the no-folder message', '\r\n\x1b[1mNo project folder chosen\x1b[0m\r\n']
  ])('finds some in %s', (_label, data) => {
    expect(hasVisibleText(data)).toBe(true)
  })
})

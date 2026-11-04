import { describe, expect, it } from 'vitest'
import {
  isClaudeOwnPrompt,
  isTooLongForPrompt,
  MAX_PROMPT_CHARS,
  promptContains,
  sanitizeForPrompt
} from './sanitize'

describe('sanitizeForPrompt', () => {
  it.each([
    ['plain text', 'run the tests', 'run the tests'],
    ['surrounding space', '  run the tests  ', 'run the tests'],
    ['newlines', 'run\r\nthe\ntests', 'run the tests'],
    ['tabs', 'run\tthe tests', 'run the tests'],
    ['a bell', 'run\u0007 tests', 'run tests'],
    ['ESC', 'run\u001b tests', 'run tests'],
    ['a delete character', 'run\u007f tests', 'run tests'],
    ['a zero-width character', 'ru​n', 'run'],
    [
      'special characters, kept',
      `"a" 'b' $c %d ^e & | < > čšž 日本語 😀`,
      `"a" 'b' $c %d ^e & | < > čšž 日本語 😀`
    ]
  ])('handles %s', (_label, input, expected) => {
    expect(sanitizeForPrompt(input)).toBe(expected)
  })

  // S5.3: a real paste with this in it submitted the first part and left the rest in the prompt.
  it('removes a paste end marker, so text cannot break out of the paste', () => {
    const result = sanitizeForPrompt('run\u001b[201~\rrm -rf /')
    expect(result).not.toContain('\u001b')
    expect(result).not.toContain('\r')
  })

  it('removes the paste start marker too', () => {
    expect(sanitizeForPrompt('\u001b[200~run')).not.toContain('\u001b')
  })

  // S5.3: "/clear" really cleared the session and "!echo" really ran in a shell.
  it.each([
    ['/clear', ' /clear'],
    ['/model haiku', ' /model haiku'],
    ['!rm -rf /', ' !rm -rf /'],
    ['  /clear', ' /clear'],
    ['\n!echo hi', ' !echo hi'],
    ['\u0007/clear', ' /clear']
  ])('stops %j running as a command', (input, expected) => {
    expect(sanitizeForPrompt(input)).toBe(expected)
  })

  it.each(['#tag', '@file', '? help', '& run', 'use /clear here', 'wow!'])(
    'leaves %j alone, since it is plain text already',
    (input) => {
      expect(sanitizeForPrompt(input)).toBe(input)
    }
  )
})

describe('isTooLongForPrompt', () => {
  it('allows the limit, and blocks one over', () => {
    expect(isTooLongForPrompt('x'.repeat(MAX_PROMPT_CHARS))).toBe(false)
    expect(isTooLongForPrompt('x'.repeat(MAX_PROMPT_CHARS + 1))).toBe(true)
  })

  it('stays below where S5.3 saw text come back changed', () => {
    expect(MAX_PROMPT_CHARS).toBeLessThan(1024)
  })

  it('counts characters, not bytes', () => {
    expect(isTooLongForPrompt('č'.repeat(MAX_PROMPT_CHARS))).toBe(false)
  })
})

describe('isClaudeOwnPrompt', () => {
  it.each([
    ['a task notification', '<task-notification>done</task-notification>', true],
    ['plain text', 'run the tests', false],
    ['a long paste, which starts with newlines', '\n\n<pasted_content id="1">\nx', false],
    ['text mentioning a tag', 'what is <task-notification>', false],
    ['text starting with an angle bracket', '< is less than', false]
  ])('%s', (_label, prompt, expected) => {
    expect(isClaudeOwnPrompt(prompt)).toBe(expected)
  })
})

describe('promptContains', () => {
  const wrapped = (text: string): string =>
    `\n\n<pasted_content id="5eb0">\n${text}\n</pasted_content id="5eb0">\n`

  it.each([
    ['the same text', 'run the tests', 'run the tests', true],
    ['the wrapper around a long paste', wrapped('run the tests'), 'run the tests', true],
    ['the space in front of a command', ' /clear', ' /clear', true],
    ['Claude dropping that space', '/clear', ' /clear', true],
    ['half-typed text in front', 'half typed run the tests', 'run the tests', true],
    ['the start lost, as S5.3 measured', 'delete the database', "don't delete the database", false],
    ['a changed character', 'run tha tests', 'run the tests', false],
    ['nothing', '', 'run the tests', false]
  ])('%s', (_label, prompt, text, expected) => {
    expect(promptContains(prompt, text)).toBe(expected)
  })
})

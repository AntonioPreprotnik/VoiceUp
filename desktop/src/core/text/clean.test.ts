import { describe, expect, it } from 'vitest'
import { clean } from './clean'

describe('clean', () => {
  it.each([
    ['trims', '  run the tests  ', 'run the tests'],
    ['collapses whitespace', 'run   the\t\ttests\n\nnow', 'run the tests now'],
    ['removes the escape character', 'run\u001b[31m tests', 'run[31m tests'],
    ['strips a control character', 'run\u0007 tests', 'run tests'],
    ['strips a zero-width character', 'ru​n tests', 'run tests'],
    ['keeps words apart across a newline', 'run\ntests', 'run tests'],
    ['removes a square tag', '[BLANK_AUDIO] run the tests', 'run the tests'],
    ['removes a tag inside text', 'hello [noise], world', 'hello, world'],
    ['removes a short parenthesised tag', 'run (music) the tests', 'run the tests'],
    ['removes a two-word tag', '(wind blowing) run the tests', 'run the tests'],
    ['keeps a longer aside', 'run it (the old test suite)', 'run it (the old test suite)'],
    ['removes a model token', '<|endoftext|> run <unk> tests', 'run tests'],
    ['removes music notes', '♪ run the tests ♪', 'run the tests'],
    ['collapses a token repeated four times', 'the the the the end', 'the end'],
    ['collapses a long loop', `${'no '.repeat(40)}stop`, 'no stop'],
    ['ignores case and punctuation in a loop', 'No, no, NO, no.', 'no.'],
    ['collapses a loop at the end', 'yes yes yes yes', 'yes'],
    ['collapses two separate loops', 'a a a a b b b b', 'a b'],
    ['keeps a token repeated three times', 'no no no stop', 'no no no stop'],
    ['keeps a single word', 'continue', 'continue'],
    ['keeps numbers', '42', '42'],
    ['keeps other alphabets', 'pokreni testove čšž', 'pokreni testove čšž'],
    ['keeps punctuation that means something', 'cd .. and ls .', 'cd .. and ls .'],
    ['keeps a run of punctuation tokens', 'a . . . . b', 'a . . . . b']
  ])('%s', (_name, input, expected) => {
    expect(clean(input, 1)).toBe(expected)
  })

  it.each([
    ['empty', ''],
    ['only whitespace', ' \t\n '],
    ['only a tag', '[BLANK_AUDIO]'],
    ['only parenthesised noise', '(music)'],
    ['tags and leftover punctuation', '[noise] . (coughing) ...'],
    ['only punctuation', '. , !'],
    ['only control characters', '\u0007\u0008'],
    ['only music notes', '♪♪♪']
  ])('drops %s', (_name, input) => {
    expect(clean(input, 1)).toBeNull()
  })

  describe('the minimum word count', () => {
    it('drops results under it', () => {
      expect(clean('run tests', 3)).toBeNull()
    })

    it('keeps results that reach it', () => {
      expect(clean('run the tests', 3)).toBe('run the tests')
    })

    it('counts a collapsed loop as one word', () => {
      expect(clean('no no no no', 2)).toBeNull()
    })

    it('does not count punctuation as words', () => {
      expect(clean('run . . .', 2)).toBeNull()
    })

    it('still drops an empty result when set below one', () => {
      expect(clean('', 0)).toBeNull()
    })
  })
})

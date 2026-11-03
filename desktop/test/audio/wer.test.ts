import { describe, expect, it } from 'vitest'
import { editDistance, normalizeWords, wordErrors } from './wer.mjs'

describe('normalizeWords', () => {
  it('ignores case and punctuation', () => {
    expect(normalizeWords('Run the Tests.')).toEqual(['run', 'the', 'tests'])
  })

  it('treats spoken numbers and digits as the same', () => {
    expect(normalizeWords('line forty two')).toEqual(normalizeWords('line 42'))
    expect(normalizeWords('story one')).toEqual(normalizeWords('Story 1'))
  })

  it('leaves nothing for empty or punctuation-only text', () => {
    expect(normalizeWords('')).toEqual([])
    expect(normalizeWords(' ... ')).toEqual([])
  })
})

describe('editDistance', () => {
  it.each([
    [[], [], 0],
    [['a'], ['a'], 0],
    [['a'], ['b'], 1],
    [['a', 'b'], ['a'], 1],
    [['a'], ['a', 'b'], 1],
    [[], ['a', 'b'], 2],
    [['a', 'b', 'c'], ['a', 'x', 'c', 'd'], 2]
  ])('between %j and %j is %i', (reference, heard, expected) => {
    expect(editDistance(reference, heard)).toBe(expected)
  })
})

describe('wordErrors', () => {
  it('finds none in a match that differs only in form', () => {
    expect(
      wordErrors('fix the type error on line forty two', 'Fix the type error on line 42.')
    ).toEqual({ errors: 0, words: 7 })
  })

  it('counts a misheard word', () => {
    expect(wordErrors('run the tests', 'run the test')).toEqual({ errors: 1, words: 3 })
  })
})

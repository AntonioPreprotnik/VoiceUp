// Turns a raw transcript into text fit to send, or null when nothing usable is left (TECH_SPEC §5.5).

const REPEAT_LIMIT = 4
const MAX_PARENTHESISED_WORDS = 3

// What small models print for noise. Each takes the space before it, so "hello [noise], world"
// doesn't end up as "hello , world".
const TAGS = [
  /\s*\[[^\]]*\]/gu, // [BLANK_AUDIO]
  /\s*<\|?\w+\|?>/gu, // <unk>, <|endoftext|>
  /\s*[♩♪♫♬]+/gu
]
// Up to three words only: "(music)" and "(wind blowing)" are noise, but a longer aside is speech.
const PARENTHESISED = /\s*\(([^()]*)\)/gu

function stripControlCharacters(text: string): string {
  // Tabs and newlines become spaces, so the words either side stay apart.
  return text.replace(/[\p{Cc}\p{Cf}]/gu, (char) => (/\s/u.test(char) ? ' ' : ''))
}

function tokensOf(text: string): string[] {
  return text.split(/\s+/u).filter((token) => token !== '')
}

function stripTags(text: string): string {
  const withoutTags = TAGS.reduce((result, tag) => result.replace(tag, ''), text)
  return withoutTags.replace(PARENTHESISED, (match, inner: string) =>
    tokensOf(inner).length <= MAX_PARENTHESISED_WORDS ? '' : match
  )
}

/** Compared without case or surrounding punctuation, so "No, no, no, no." is one loop. */
function tokenKey(token: string): string {
  return token.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
}

/** A run of 4 or more becomes its last token, which keeps any closing punctuation. */
function collapseLoops(tokens: readonly string[]): string[] {
  const result: string[] = []
  let start = 0
  for (let at = 1; at <= tokens.length; at++) {
    const key = tokenKey(tokens[start] ?? '')
    if (at < tokens.length && key !== '' && tokenKey(tokens[at] ?? '') === key) continue
    const run = tokens.slice(start, at)
    result.push(...(run.length >= REPEAT_LIMIT ? run.slice(-1) : run))
    start = at
  }
  return result
}

function isWord(token: string): boolean {
  return /[\p{L}\p{N}]/u.test(token)
}

export function clean(text: string, minWords: number): string | null {
  const tokens = collapseLoops(tokensOf(stripTags(stripControlCharacters(text))))
  return tokens.filter(isWord).length < Math.max(minWords, 1) ? null : tokens.join(' ')
}

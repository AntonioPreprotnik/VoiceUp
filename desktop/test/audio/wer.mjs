// Word error rate, for the speech benchmark. Case and punctuation don't count as errors, and spoken
// numbers match their digits, since a model's choice between them changes nothing a user cares about.

const NUMBER_WORDS = new Map([
  ['forty two', '42'],
  ['one', '1']
])

/** Lower case, no punctuation, known number words as digits, then split into words. */
export function normalizeWords(text) {
  let normalized = text
    .toLowerCase()
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  for (const [words, digits] of NUMBER_WORDS) {
    normalized = normalized.replace(new RegExp(`\\b${words}\\b`, 'g'), digits)
  }
  return normalized === '' ? [] : normalized.split(' ')
}

/** Substitutions, insertions and deletions needed to turn one word list into the other. */
export function editDistance(reference, heard) {
  let previous = Array.from({ length: heard.length + 1 }, (_, i) => i)
  for (let r = 1; r <= reference.length; r++) {
    const current = [r]
    for (let h = 1; h <= heard.length; h++) {
      const same = reference[r - 1] === heard[h - 1]
      current[h] = Math.min(previous[h] + 1, current[h - 1] + 1, previous[h - 1] + (same ? 0 : 1))
    }
    previous = current
  }
  return previous[heard.length]
}

/** Errors and reference length for one clip. Sum these across clips, then divide. */
export function wordErrors(referenceText, heardText) {
  const reference = normalizeWords(referenceText)
  return { errors: editDistance(reference, normalizeWords(heardText)), words: reference.length }
}

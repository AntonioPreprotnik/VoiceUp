/** Splits terminal input to fit the term:input limit, without cutting a surrogate pair in two. */
export function chunkInput(data: string, maxChars: number): string[] {
  const chunks: string[] = []
  let start = 0
  while (start < data.length) {
    let end = Math.min(start + maxChars, data.length)
    const lastCode = data.charCodeAt(end - 1)
    const endsOnHighSurrogate = lastCode >= 0xd800 && lastCode <= 0xdbff
    if (endsOnHighSurrogate && end < data.length && end - start > 1) end -= 1
    chunks.push(data.slice(start, end))
    start = end
  }
  return chunks
}

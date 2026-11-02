/**
 * Security rule 5: the only links the app opens outside itself are https:. Terminal output is
 * untrusted, so anything else a program prints as a link (file:, a custom protocol handler, a
 * command) must never reach the operating system.
 */
export function isAllowedLink(raw: string): boolean {
  if (!URL.canParse(raw)) return false
  const url = new URL(raw)
  return url.protocol === 'https:' && url.username === '' && url.password === ''
}

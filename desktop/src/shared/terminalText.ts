// Escape sequences (CSI, OSC, other two-byte ones) and control characters. Matching control
// characters is the whole point here, so the lint rule against them doesn't apply.
const NOT_VISIBLE =
  // eslint-disable-next-line no-control-regex
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?|\x1b[ -/]*[0-~]|[\x00-\x1f\x7f]/g

/**
 * Whether terminal output would put something on screen. A new session sends only setup codes for
 * its first second or so (measured in S1.3: first output at 432 ms, first text at 1405 ms).
 */
export function hasVisibleText(data: string): boolean {
  return data.replace(NOT_VISIBLE, '').trim() !== ''
}

const FLAG = '--smoke-test='

/** The result file path from `--smoke-test=<file>`, or undefined when the flag is absent. */
export function parseSmokeTestPath(argv: readonly string[]): string | undefined {
  return argv.find((arg) => arg.startsWith(FLAG))?.slice(FLAG.length)
}

// Reads the fuses back from a packaged exe and fails if any differs from electron-builder.yml.
// Usage: node scripts/check-fuses.mjs <path to exe>
import console from 'node:console'
import process from 'node:process'
import fuses from '@electron/fuses'

// @electron/fuses 1.8.0 is CommonJS without named ESM exports.
const { FuseV1Options, getCurrentFuseWire } = fuses

// The wire stores each fuse as an ASCII digit. 1.8.0 does not export its FuseState enum.
const DISABLE = '0'.charCodeAt(0)
const ENABLE = '1'.charCodeAt(0)
const STATE_NAMES = { [DISABLE]: 'DISABLE', [ENABLE]: 'ENABLE' }

const EXPECTED = {
  RunAsNode: DISABLE,
  EnableNodeOptionsEnvironmentVariable: DISABLE,
  EnableNodeCliInspectArguments: DISABLE,
  EnableEmbeddedAsarIntegrityValidation: ENABLE,
  OnlyLoadAppFromAsar: ENABLE
}

const exePath = process.argv[2]
if (exePath === undefined) {
  console.error('Usage: node scripts/check-fuses.mjs <path to exe>')
  process.exit(2)
}

const wire = await getCurrentFuseWire(exePath)
let failed = false
for (const [name, expected] of Object.entries(EXPECTED)) {
  const actual = wire[FuseV1Options[name]]
  const ok = actual === expected
  const actualName = STATE_NAMES[actual] ?? `unknown (${String(actual)})`
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}: ${actualName} (expected ${STATE_NAMES[expected]})`)
  if (!ok) failed = true
}
process.exit(failed ? 1 : 0)

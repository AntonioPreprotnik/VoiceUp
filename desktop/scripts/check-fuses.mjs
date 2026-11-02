// Reads the fuses back from a packaged exe and fails if any differs from electron-builder.yml.
// Usage: node scripts/check-fuses.mjs <path to exe>
import console from 'node:console'
import process from 'node:process'
import fuses from '@electron/fuses'

// @electron/fuses 1.8.0 is CommonJS without named ESM exports.
const { FuseState, FuseV1Options, getCurrentFuseWire } = fuses

const EXPECTED = {
  RunAsNode: FuseState.DISABLE,
  EnableNodeOptionsEnvironmentVariable: FuseState.DISABLE,
  EnableNodeCliInspectArguments: FuseState.DISABLE,
  EnableEmbeddedAsarIntegrityValidation: FuseState.ENABLE,
  OnlyLoadAppFromAsar: FuseState.ENABLE
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
  console.log(
    `${ok ? 'ok  ' : 'FAIL'} ${name}: ${FuseState[actual]} (expected ${FuseState[expected]})`
  )
  if (!ok) failed = true
}
process.exit(failed ? 1 : 0)

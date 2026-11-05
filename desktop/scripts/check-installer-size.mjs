// Fails if the installer is over the budget in TECH_SPEC section 1.
// Usage: node scripts/check-installer-size.mjs <path to installer>
import console from 'node:console'
import { statSync } from 'node:fs'
import process from 'node:process'

const BUDGET_MB = 150

const installerPath = process.argv[2]
if (installerPath === undefined) {
  console.error('Usage: node scripts/check-installer-size.mjs <path to installer>')
  process.exit(2)
}

const sizeMb = statSync(installerPath).size / (1024 * 1024)
console.log(`${installerPath}: ${sizeMb.toFixed(1)} MB, budget ${BUDGET_MB} MB`)
if (sizeMb > BUDGET_MB) {
  console.error('The installer is over budget. Models must not be bundled.')
  process.exit(1)
}

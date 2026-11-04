// S2.3 check: does cmd.exe /d /s /c survive spaces in both the .cmd path and an argument?
// Usage: node spikes/S2.1/quoting.mjs <empty folder>
import { mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pty = createRequire(join(here, '../../desktop/package.json'))('node-pty')
const folder = join(process.argv[2], 'Ana Maria (x86)')
mkdirSync(folder, { recursive: true })
const script = join(folder, 'claude.cmd')
writeFileSync(script, '@echo off\r\necho ARG1=[%1] ARG2=[%2]\r\n')
const argument = join(folder, 'hooks-1.json')
const cmd = join(process.env.SystemRoot, 'System32', 'cmd.exe')

function run(label, args) {
  return new Promise((resolve) => {
    let output = ''
    const child = pty.spawn(cmd, args, { cols: 200, rows: 10, cwd: process.argv[2] })
    child.onData((data) => {
      output += data
    })
    child.onExit(({ exitCode }) => {
      // eslint-disable-next-line no-control-regex
      const text = output.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').trim()
      console.log(`${label}: exit ${String(exitCode)} | ${text}`)
      resolve()
    })
  })
}

await run('array form', ['/d', '/s', '/c', script, '--settings', argument])
await run('string form', `/d /s /c ""${script}" --settings "${argument}""`)
process.exit(0)

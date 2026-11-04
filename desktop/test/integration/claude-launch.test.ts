import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node-pty'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { chooseClaudeCommand, ptyArgs } from '../../src/core/claudeCommand'

// A real cmd.exe through a real PTY: only this shows how the quoting really behaves. An npm install
// of Claude is a .cmd, and on a PC with a space in the user name both paths below have one.
let root: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'voiceup-launch-'))
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

it.each(['Ana Maria', 'Ana Maria (x86)', 'R&D Ana'])(
  'starts a .cmd with its settings, in a folder called %s',
  async (name) => {
    const folder = join(root, name)
    mkdirSync(folder)
    const shim = join(folder, 'claude.cmd')
    writeFileSync(shim, '@echo off\r\necho ONE=%1\r\necho TWO=%2\r\n')
    const settings = join(folder, 'hooks-1.json')
    const command = chooseClaudeCommand({
      whereExe: undefined,
      localBinExe: undefined,
      whereCmd: shim,
      cmdExe: join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe')
    })
    if (command === null) throw new Error('No command')

    const child = spawn(command.file, ptyArgs(command, ['--settings', settings]), {
      cols: 400,
      rows: 10,
      cwd: root
    })
    let output = ''
    child.onData((data) => {
      output += data
    })
    const exitCode = await new Promise<number>((resolve) => {
      child.onExit((event) => {
        resolve(event.exitCode)
      })
    })
    expect(output).toContain('ONE="--settings"')
    expect(output).toContain(`TWO="${settings}"`)
    expect(exitCode).toBe(0)
  },
  20000
)

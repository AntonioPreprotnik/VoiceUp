import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installScript, plainOutput, runInstaller } from '../../src/main/pty/installClaude'
import { readClaudeVersion } from '../../src/main/pty/claudeVersion'
import { cmdExePath, system32Path } from '../../src/main/pty/resolveClaude'
import { INSTALL_COMMAND } from '../../src/core/claudeVersion'

vi.mock('electron', () => import('../fakes/electron'))
vi.mock('electron-log/main', () => import('../fakes/electronLog'))

// Real PowerShell and cmd.exe with harmless scripts. Nothing here runs the real installer, which
// would change this machine's Claude Code.

const POWERSHELL = system32Path('WindowsPowerShell\\v1.0\\powershell.exe')

/** How many processes have this in their command line, other than the one asking. */
function processesNamed(marker: string): number {
  const output = execFileSync(
    POWERSHELL,
    [
      '-NoProfile',
      '-Command',
      `@(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.CommandLine -like '*${marker}*' }).Count`
    ],
    { encoding: 'utf8' }
  )
  return Number(output.trim())
}

async function run(script: string): Promise<string> {
  let output = ''
  await runInstaller(script, (text) => {
    output += text
  }).done
  return output
}

describe('runInstaller', () => {
  it('shows what the script prints, on both streams', async () => {
    const output = await run("Write-Output 'to stdout'; [Console]::Error.WriteLine('to stderr')")
    expect(output).toContain('to stdout')
    expect(output).toContain('to stderr')
  }, 30000)

  it('ends normally when the script fails', async () => {
    await expect(run('exit 3')).resolves.toBe('')
  }, 30000)

  it('stops the script and what it started', async () => {
    const marker = `voiceup-install-test-${String(process.pid)}`
    // A child that really keeps running, named so that it can be found.
    const script = `Start-Process -NoNewWindow -Wait ${POWERSHELL} -ArgumentList '-NoProfile','-Command','Start-Sleep 120; # ${marker}'`
    const running = runInstaller(script, () => undefined)
    let finished = false
    void running.done.then(() => {
      finished = true
    })

    // Both processes first, or a child that never started would pass this.
    await vi.waitFor(
      () => {
        expect(processesNamed(marker)).toBeGreaterThanOrEqual(2)
      },
      { timeout: 20000, interval: 500 }
    )
    running.stop()
    await vi.waitFor(
      () => {
        expect(finished).toBe(true)
        expect(processesNamed(marker)).toBe(0)
      },
      { timeout: 20000, interval: 500 }
    )
  }, 60000)
})

describe('plainOutput', () => {
  it('removes colors and cursor moves, and keeps the text', () => {
    expect(plainOutput('\x1b[32mok\x1b[0m\x1b[2K\r\nnext\x07')).toBe('ok\nnext')
  })
})

describe('installScript', () => {
  it("is Anthropic's command", () => {
    expect(installScript(true)).toBe(INSTALL_COMMAND)
  })

  it('ignores the test override in a packaged build', () => {
    vi.stubEnv('VOICEUP_INSTALL_SCRIPT', 'Write-Output evil')
    expect(installScript(true)).toBe(INSTALL_COMMAND)
    expect(installScript(false)).toBe('Write-Output evil')
    vi.unstubAllEnvs()
  })
})

describe('readClaudeVersion', () => {
  it('reads an .exe-style command', async () => {
    const command = {
      file: process.execPath,
      args: ['-e', "console.log('2.1.400 (Claude Code)')", '--']
    }
    await expect(readClaudeVersion(command)).resolves.toBe('2.1.400')
  }, 30000)

  it('is null for something that will not run', async () => {
    await expect(
      readClaudeVersion({ file: 'C:\\no\\such\\claude.exe', args: [] })
    ).resolves.toBeNull()
  }, 30000)

  it('reads through a .cmd in a folder with a space', async () => {
    const root = mkdtempSync(join(tmpdir(), 'voiceup-version-'))
    const folder = join(root, 'with space')
    mkdirSync(folder)
    const shim = join(folder, 'claude.cmd')
    writeFileSync(shim, '@echo 2.1.401 (Claude Code)\r\n')
    await expect(readClaudeVersion({ file: cmdExePath(), args: [], cmdShim: shim })).resolves.toBe(
      '2.1.401'
    )
    rmSync(root, { recursive: true, force: true })
  }, 30000)
})

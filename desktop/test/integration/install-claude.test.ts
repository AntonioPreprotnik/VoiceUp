import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { installScript, plainOutput, runInstaller } from '../../src/main/pty/installClaude'
import { readClaudeVersion } from '../../src/main/pty/claudeVersion'
import { cmdExePath } from '../../src/main/pty/resolveClaude'
import { INSTALL_COMMAND } from '../../src/core/claudeVersion'

vi.mock('electron', () => import('../fakes/electron'))
vi.mock('electron-log/main', () => import('../fakes/electronLog'))

// Real PowerShell and cmd.exe with harmless scripts. Nothing here runs the real installer, which
// would change this machine's Claude Code.

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
    const script = `Write-Output started; Start-Process -NoNewWindow -Wait ping -ArgumentList '-n','60','${marker}.invalid'`
    let stop: () => void = () => undefined
    const started = new Promise<void>((resolve) => {
      const running = runInstaller(script, () => {
        resolve()
      })
      stop = () => {
        running.stop()
      }
      void running.done.then(() => {
        finished = true
      })
    })
    let finished = false
    await started
    stop()
    await vi.waitFor(
      () => {
        expect(finished).toBe(true)
      },
      { timeout: 15000 }
    )
    const left = execFileSync(
      'wmic',
      ['process', 'where', "name='PING.EXE'", 'get', 'commandline'],
      {
        encoding: 'utf8'
      }
    )
    expect(left).not.toContain(marker)
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

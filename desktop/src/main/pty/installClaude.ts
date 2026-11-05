import { execFile, spawn } from 'node:child_process'
import { INSTALL_COMMAND } from '../../core/claudeVersion'
import { log } from '../log'
import { system32Path } from './resolveClaude'

const TIMEOUT_MS = 10 * 60 * 1000

/** Colors and cursor moves, which would show as junk in the page's plain text. */
// eslint-disable-next-line no-control-regex -- matching control characters is the point
const TERMINAL_CODES = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]|[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g

export function plainOutput(text: string): string {
  return text.replace(TERMINAL_CODES, '').replace(/\r\n?/g, '\n')
}

/**
 * What runs. A test seam for an unpackaged build only, like VOICEUP_CLAUDE_CMD: a packaged build
 * only ever runs Anthropic's own command.
 */
export function installScript(isPackaged: boolean): string {
  const override = process.env['VOICEUP_INSTALL_SCRIPT']
  return override !== undefined && !isPackaged ? override : INSTALL_COMMAND
}

export interface RunningInstall {
  /** Ends when the installer does. The result only goes to the log: the caller looks for Claude. */
  readonly done: Promise<void>
  /** Stops the installer and whatever it started. */
  stop(): void
}

/** Its output goes to the page and never to the log. */
export function runInstaller(script: string, onOutput: (text: string) => void): RunningInstall {
  const child = spawn(
    system32Path('WindowsPowerShell\\v1.0\\powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }
  )
  let stopped = false
  const stop = (): void => {
    if (stopped || child.pid === undefined || child.exitCode !== null) return
    stopped = true
    // child.kill would leave whatever PowerShell started, such as the download, running.
    execFile(
      system32Path('taskkill.exe'),
      ['/pid', String(child.pid), '/t', '/f'],
      { windowsHide: true },
      (error) => {
        if (error !== null) log.warn('Could not stop the Claude Code installer:', error.message)
      }
    )
  }
  const timer = setTimeout(() => {
    log.warn('The Claude Code installer took too long, stopping it')
    stop()
  }, TIMEOUT_MS)
  child.stdout.setEncoding('utf8').on('data', (text: string) => {
    onOutput(plainOutput(text))
  })
  child.stderr.setEncoding('utf8').on('data', (text: string) => {
    onOutput(plainOutput(text))
  })
  const done = new Promise<void>((resolve) => {
    child.once('error', (error) => {
      clearTimeout(timer)
      log.error('Could not start the Claude Code installer', error)
      onOutput(`Could not start PowerShell: ${error.message}\n`)
      resolve()
    })
    child.once('close', (code) => {
      clearTimeout(timer)
      log.info(`The Claude Code installer ended with ${String(code)}`)
      resolve()
    })
  })
  return { done, stop }
}

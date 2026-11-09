import { app, type BrowserWindow } from 'electron'
import type { ShutdownSteps } from '../core/shutdown'
import type { ClaudeLink } from './claudeLink'
import { registerTerminalIpc } from './ipc/terminal'
import { registerTerminalUiIpc } from './ipc/terminalUi'
import { readClaudeVersion } from './pty/claudeVersion'
import { resolveClaude } from './pty/resolveClaude'
import { ClaudeSession } from './pty/session'
import type { SettingsStore } from './settings/settingsStore'

export interface ClaudeSessionSetupOptions {
  readonly window: BrowserWindow
  readonly settings: SettingsStore
  readonly link: Pick<ClaudeLink, 'claudeState' | 'delivery' | 'hooks' | 'publishStatus'>
  readonly steps: ShutdownSteps
}

/**
 * Step 6 of TECH_SPEC §3: Claude in its PTY, tied to the state tracker, delivery and hooks. Claude
 * itself starts at the renderer's first size, so it never draws at a wrong one.
 */
export function setUpClaudeSession({
  window,
  settings,
  link,
  steps
}: ClaudeSessionSetupOptions): ClaudeSession {
  const { claudeState, delivery, hooks, publishStatus } = link
  const claude = new ClaudeSession({
    window,
    settings,
    resolveCommand: () => resolveClaude(app.isPackaged),
    readVersion: readClaudeVersion,
    hooks: {
      prepareLaunch: (cwd) => hooks.prepareLaunch(cwd),
      launched: () => {
        delivery.sessionRestarted()
        claudeState.sessionRestart()
        hooks.launched()
        publishStatus()
      },
      exited: () => {
        delivery.sessionEnded()
        claudeState.ptyExit()
        hooks.exited()
      }
    }
  })
  registerTerminalIpc(claude.host, (data) => {
    claudeState.onInput(data)
    // Ctrl+C can clear the prompt with no change of state, which may free the queue.
    delivery.kick()
  })
  steps.pty ??= () => claude.host.stop()
  registerTerminalUiIpc(window, () => claude.fontSize)
  return claude
}

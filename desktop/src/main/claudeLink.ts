import { join } from 'node:path'
import { app, dialog, type BrowserWindow } from 'electron'
import { BrowserFollow } from '../core/browserFollow'
import { Delivery } from '../core/delivery/delivery'
import { FailureNotices } from '../core/failureNotices'
import { MESSAGES } from '../core/messages'
import type { ShutdownSteps } from '../core/shutdown'
import type { ClaudeState } from '../core/state/reducer'
import { statusView } from '../core/state/status'
import { ClaudeStateTracker } from '../core/state/tracker'
import type { HookMessage } from '../shared/hooks'
import { showBrowser } from './browser/showBrowser'
import { HookLink } from './hooks/link'
import { readHookPolicies } from './hooks/policy'
import { escapeKey } from './hotkey'
import { registerStatusIpc } from './ipc/status'
import { log } from './log'
import type { Overlay } from './overlay'
import { system32Path } from './pty/resolveClaude'
import { schedule } from './schedule'
import type { SettingsStore } from './settings/settingsStore'
import { ClaudeStatus } from './status'

const QUEUE_PREVIEW_CHARS = 80

export interface ClaudeLinkOptions {
  readonly settings: SettingsStore
  readonly overlay: Overlay
  readonly terminalWindow: BrowserWindow
  /** The window a message box belongs to, if one is still open. */
  readonly parentWindow: () => BrowserWindow | undefined
  readonly showWindow: () => void
  readonly openSettings: () => void
  readonly pauseListening: (paused: boolean) => void
  readonly restartToUpdate: () => void
  /** Writes to Claude's terminal. */
  readonly write: (data: string) => void
  readonly steps: ShutdownSteps
  /** For the wizard, while it is open. */
  readonly onClaudeState: (state: ClaudeState) => void
  readonly onHook: (message: HookMessage) => void
}

export interface ClaudeLink {
  readonly claudeState: ClaudeStateTracker
  readonly delivery: Delivery
  readonly hooks: HookLink
  readonly publishStatus: () => void
  readonly setNotifications: (on: boolean) => void
  readonly setListeningPaused: (paused: boolean) => void
  /** The notice for the window's first trip to the tray. */
  readonly stillRunning: () => void
  /** The tray item and notice for a downloaded app update (S7.4). */
  readonly updateReady: (version: string) => void
}

/** What VoiceUp knows of Claude, and what reaches it: state, status, hooks and voice delivery. */
export function createClaudeLink({
  settings,
  overlay,
  terminalWindow,
  parentWindow,
  showWindow,
  openSettings,
  pauseListening,
  restartToUpdate,
  write,
  steps,
  onClaudeState,
  onHook
}: ClaudeLinkOptions): ClaudeLink {
  const claudeState = new ClaudeStateTracker({
    schedule,
    onChange: (state, previous) => {
      log.debug(`Claude state: ${previous} -> ${state}`)
      publishStatus()
      claudeStatus.notify(previous, state)
      delivery.kick()
      onClaudeState(state)
    },
    onEffect: (effect) => {
      // Only a short code from Claude. Anything else might quote more than it should.
      const code = /^[a-z_]{1,40}$/.test(effect.error ?? '') ? effect.error : 'other'
      log.warn(`Claude's turn failed: ${String(code)}`)
    }
  })
  const claudeStatus = new ClaudeStatus({
    window: terminalWindow,
    notifications: settings.current.ui.notifications,
    reArm: () => {
      claudeState.reArm()
    },
    showWindow,
    openSettings,
    pauseListening,
    restartToUpdate,
    quit: () => {
      app.quit()
    }
  })
  steps.tray ??= () => {
    claudeStatus.destroy()
  }
  const publishStatus = (): void => {
    const queue = delivery.queued.map(({ id, text }) => ({
      id,
      preview: text.trim().slice(0, QUEUE_PREVIEW_CHARS)
    }))
    claudeStatus.show(statusView(claudeState.state, hooks.voiceBlock, queue))
  }
  registerStatusIpc(
    () => claudeStatus.current,
    () => {
      claudeState.reArm()
    },
    (id) => {
      delivery.cancelQueued(id)
    }
  )
  // Step 4: stale files go, then the hook server and this launch's hook files.
  const browserFollow = new BrowserFollow()
  const failureNotices = new FailureNotices()
  const hooks = new HookLink({
    runDir: join(app.getPath('userData'), 'run'),
    curlPath: system32Path('curl.exe'),
    readPolicies: (projectDir) => readHookPolicies({ projectDir }),
    onMessage: (message) => {
      if (message.kind === 'hook' && message.hook.hook_event_name === 'SessionStart') {
        log.info('Claude session started')
      }
      claudeState.onHook(message)
      delivery.onHook(message)
      onHook(message)
      const failure = failureNotices.onHook(message)
      // During setup the wizard explains its own tests' failures.
      if (failure !== null && settings.current.wizard.done) {
        log.warn(failure)
        overlay.failed(failure)
      }
      const browser = settings.current.claude.showBrowser
      if (browser !== 'off' && browserFollow.onHook(message, claudeState.state)) {
        void showBrowser(browser)
      }
    },
    onUnavailable: (code, setting) => {
      publishStatus()
      const { title, detail } = MESSAGES[code]
      const parent = parentWindow()
      if (parent === undefined) return
      dialog
        .showMessageBox(parent, {
          type: 'warning',
          title: 'VoiceUp',
          message: title,
          detail: setting === null ? detail : `Setting: ${setting}. ${detail}`
        })
        .catch((error: unknown) => {
          log.error('Could not show the hooks message', error)
        })
    },
    onStartingSlow: () => {
      overlay.failed('STARTING_SLOW')
    }
  })
  steps.hookServer ??= () => hooks.stopServer()
  steps.hookFiles ??= () => {
    hooks.removeFiles()
  }
  const delivery = new Delivery({
    claude: claudeState,
    // Never through onInput: this isn't the user's typing.
    write,
    schedule,
    overlay,
    escape: escapeKey,
    settings: () => ({
      queueEnabled: settings.current.delivery.queue,
      maxQueue: settings.current.delivery.maxQueue
    }),
    onQueueChange: () => {
      publishStatus()
    },
    onBlocked: (reason) => {
      log.info(`Voice text blocked: ${reason}`)
    }
  })
  publishStatus()
  return {
    claudeState,
    delivery,
    hooks,
    publishStatus,
    setNotifications: (on) => {
      claudeStatus.setNotifications(on)
    },
    setListeningPaused: (paused) => {
      claudeStatus.setListeningPaused(paused)
    },
    stillRunning: () => {
      claudeStatus.stillRunning()
    },
    updateReady: (version) => {
      claudeStatus.updateReady(version)
    }
  }
}

// User-facing error text, keyed by the codes in TECH_SPEC §6.5. Logs always carry the code.
export const MESSAGES = {
  APP_START_FAILED: {
    title: 'VoiceUp could not start',
    detail: 'Reinstall VoiceUp. If that does not help, send the error below to whoever gave you it.'
  },
  CLAUDE_NOT_FOUND: {
    title: "Claude Code isn't installed",
    detail: 'Run this command in PowerShell to install it, then check again.',
    command: 'irm https://claude.ai/install.ps1 | iex',
    action: 'Check again'
  },
  CLAUDE_EXITED: {
    title: 'Claude Code stopped',
    detail: 'Restart the session to continue.',
    action: 'Restart session'
  },
  WORKER_CRASHED: {
    title: 'Speech engine stopped',
    detail: 'Restart VoiceUp. If it keeps happening, send the logs from Help > Open logs folder.'
  },
  NO_PROJECT_FOLDER: {
    title: 'No project folder chosen',
    detail: 'Press Alt and choose File > Change folder to start Claude Code.'
  }
} as const

export type MessageCode = keyof typeof MESSAGES

import { INSTALL_COMMAND, MIN_CLAUDE_VERSION, UPDATE_COMMAND } from './claudeVersion'

// User-facing error text, keyed by the codes in TECH_SPEC §6.5. Logs always carry the code.
export const MESSAGES = {
  APP_START_FAILED: {
    title: 'VoiceUp could not start',
    detail: 'Reinstall VoiceUp. If that does not help, send the error below to whoever gave you it.'
  },
  CLAUDE_NOT_FOUND: {
    title: "Claude Code isn't installed",
    detail: 'Run this command in PowerShell to install it, then check again.',
    command: INSTALL_COMMAND,
    action: 'Check again'
  },
  CLAUDE_TOO_OLD: {
    title: 'Claude Code needs updating',
    detail: `VoiceUp needs version ${MIN_CLAUDE_VERSION} or newer. Run this command in PowerShell, then check again.`,
    command: UPDATE_COMMAND,
    action: 'Check again'
  },
  CLAUDE_NOT_LOGGED_IN: {
    title: "Claude isn't signed in",
    detail: 'Type /login in the terminal window and sign in, then try again.'
  },
  CLAUDE_TURN_FAILED: {
    title: 'Claude couldn’t answer',
    detail:
      'Claude’s own message is in the terminal window. If you are offline, reconnect, then say it again.'
  },
  CHROME_NOT_DETECTED: {
    title: 'Claude can’t reach your browser',
    detail:
      'Check that Chrome or Brave is open with the Claude extension on. In the terminal, type /chrome and choose Reconnect extension, or restart the browser and Claude.'
  },
  BROWSER_NOT_CONNECTED: {
    title: 'Claude couldn’t use your browser',
    detail:
      'Check that Chrome or Brave is open, with the Claude extension turned on and signed in to the same Claude account. Then, in the terminal, type /chrome and choose Reconnect extension. If that doesn’t help, restart the browser and Claude. Then test again.'
  },
  API_KEY_SET: {
    title: 'An API key overrides your subscription and bills the API',
    detail:
      'ANTHROPIC_API_KEY is set on this PC. To use your subscription, remove it from your environment variables and restart VoiceUp. You can also continue with it.'
  },
  CLAUDE_EXITED: {
    title: 'Claude Code stopped',
    detail: 'Restart the session to continue.',
    action: 'Restart session'
  },
  HOTKEY_TAKEN: {
    title: 'Hotkey taken, pick another',
    detail: 'Close the app using it, or set a different "hotkey" in this file and restart VoiceUp:'
  },
  NO_SPEECH: {
    title: "Didn't hear anything",
    detail: 'Check the mic and press the hotkey again.'
  },
  MODEL_MISSING: {
    title: 'Speech model needs downloading',
    detail:
      'It downloads once, and the VoiceUp title bar shows how far along it is. If it stopped, press Alt and choose Speech model > Retry download.'
  },
  MODEL_CORRUPT: {
    title: 'Speech model needs downloading',
    detail:
      'The download could not be used, so it was deleted. Check you have 1 GB free, then press Alt and choose Speech model > Retry download.'
  },
  MODEL_DOWNLOAD_FAILED: {
    title: 'Speech model download failed',
    detail:
      'Check your internet connection and free disk space, then press Alt and choose Speech model > Retry download.'
  },
  MIC_DENIED: {
    title: 'Windows is blocking the microphone',
    detail:
      'In Settings > Privacy > Microphone, turn on "Allow desktop apps to access your microphone".'
  },
  MIC_MISSING: {
    title: 'No microphone found',
    detail: 'It may have been unplugged. Connect one and press the hotkey again.'
  },
  MIC_FAILED: {
    title: 'The microphone could not start',
    detail:
      'Check that "Allow desktop apps to access your microphone" is on in Settings > Privacy > Microphone, and press the hotkey again.'
  },
  WORKER_ERROR: {
    title: 'Speech engine had a problem',
    detail: 'Press the hotkey again. If it keeps happening, send the logs.'
  },
  HOOKS_BLOCKED: {
    title: "Your Claude settings block VoiceUp's status hooks",
    detail:
      'Voice is off, because VoiceUp cannot tell when Claude is ready. Change this setting, then restart the session. See https://code.claude.com/docs/en/hooks'
  },
  HOOKS_FAILED: {
    title: "VoiceUp's status hooks could not start",
    detail: 'Voice is off, because VoiceUp cannot tell when Claude is ready. Restart VoiceUp.'
  },
  STARTING_SLOW: {
    title: 'Waiting for Claude to start',
    detail: 'Finish any prompt in the terminal. If there is none, check your Claude hook settings.'
  },
  TRANSCRIPT_TOO_LONG: {
    title: 'That was too long to send safely',
    detail: 'Nothing was sent. Say it in shorter parts.'
  },
  DELIVERY_UNCONFIRMED: {
    title: 'Your command may not have been sent',
    detail:
      "It may still be in Claude's prompt. Check the terminal: press Enter, or Ctrl+C to clear it."
  },
  DELIVERY_GARBLED: {
    title: 'Claude received something different',
    detail: 'Claude was interrupted. Check what it got in the terminal before going on.'
  },
  TRANSCRIPT_DROPPED: {
    title: 'Nothing usable was heard',
    detail: 'Press the hotkey and try again.'
  },
  TRANSCRIBE_TIMEOUT: {
    title: 'Transcription took too long',
    detail: 'The speech engine restarted. Press the hotkey and try again.'
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

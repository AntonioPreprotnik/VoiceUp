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

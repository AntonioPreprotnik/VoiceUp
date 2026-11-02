import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { chunkInput } from '../../shared/chunkInput'
import type { TerminalApi } from '../../shared/ipcChannels'
import { hasVisibleText } from '../../shared/terminalText'

declare global {
  interface Window {
    readonly voiceup: TerminalApi
  }
}

// Mirrors MAX_TERM_INPUT_CHARS in shared/ipc.ts, which can't be imported here without bundling zod.
const MAX_INPUT_CHARS = 64 * 1024

const api = window.voiceup
const container = document.getElementById('terminal')
if (container === null) throw new Error('The terminal page has no #terminal element')

const terminal = new Terminal({
  allowProposedApi: true, // the unicode11 addon needs it
  cursorBlink: true,
  fontFamily: "'Cascadia Mono', Consolas, monospace",
  fontSize: 14,
  // Tells xterm how ConPTY wraps lines, which keeps resizing from garbling the text.
  windowsPty: { backend: 'conpty', buildNumber: api.windowsBuild }
})

const fit = new FitAddon()
terminal.loadAddon(fit)
terminal.loadAddon(new Unicode11Addon())
terminal.unicode.activeVersion = '11'
terminal.open(container)

// WebGL is faster, but not always available. xterm's default renderer takes over without it.
try {
  const webgl = new WebglAddon()
  webgl.onContextLoss(() => {
    webgl.dispose()
  })
  terminal.loadAddon(webgl)
} catch (error: unknown) {
  console.warn('WebGL renderer unavailable, using the default renderer', error)
}

terminal.onData((data) => {
  for (const chunk of chunkInput(data, MAX_INPUT_CHARS)) api.input(chunk)
})

const exitBanner = document.getElementById('session-exited')
const exitText = document.getElementById('session-exited-text')
const restartButton = document.getElementById('restart-session')
if (exitBanner === null || exitText === null || !(restartButton instanceof HTMLButtonElement)) {
  throw new Error('The terminal page is missing its session banner')
}

let restarting = false

// An arrow function, because a hoisted declaration would lose the null checks above.
const setRestarting = (active: boolean): void => {
  restarting = active
  restartButton.disabled = active
  restartButton.textContent = active ? 'Waiting ...' : 'Restart session'
}

// Acknowledged only once xterm has drawn it, which is what makes the flow control work.
api.onData((data) => {
  // The banner stays until there is something to look at. A new session's first second of output
  // is only setup codes, and hiding on those would leave a blank screen.
  if (restarting && hasVisibleText(data)) {
    setRestarting(false)
    exitBanner.hidden = true
    terminal.focus()
  }
  terminal.write(data, () => {
    api.ack(data.length)
  })
})

// The text comes from main and is shown with textContent, never as markup.
api.onSessionExit(({ title, detail, exitCode }) => {
  setRestarting(false)
  const code = exitCode === null ? '' : ` (exit code ${String(exitCode)})`
  exitText.textContent = `${title}${code}. ${detail}`
  exitBanner.hidden = false
  // Focused, so Enter restarts right away.
  restartButton.focus()
})

restartButton.addEventListener('click', () => {
  setRestarting(true)
  exitText.textContent = 'Starting Claude Code...'
  api.restartSession()
})

function fitAndReport(): void {
  fit.fit()
  api.resize(terminal.cols, terminal.rows)
}

new ResizeObserver(fitAndReport).observe(container)
fitAndReport()
terminal.focus()

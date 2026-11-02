import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
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
  fontSize: 14, // replaced by the saved size below, before the first size is reported
  scrollback: 10000, // Claude's long replies still don't reach it: see TECH_SPEC §11
  // Links written with OSC 8. Plain text links use the addon below. Main checks both.
  linkHandler: {
    activate: (_event, url) => {
      api.openLink(url)
    }
  },
  // Tells xterm how ConPTY wraps lines, which keeps resizing from garbling the text.
  windowsPty: { backend: 'conpty', buildNumber: api.windowsBuild }
})

const fit = new FitAddon()
terminal.loadAddon(fit)
terminal.loadAddon(new Unicode11Addon())
terminal.loadAddon(
  new WebLinksAddon((_event, url) => {
    api.openLink(url)
  })
)
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
const commandRow = document.getElementById('session-command')
const commandText = document.getElementById('session-command-text')
const copyCommand = document.getElementById('copy-command')
if (
  exitBanner === null ||
  exitText === null ||
  !(restartButton instanceof HTMLButtonElement) ||
  commandRow === null ||
  commandText === null ||
  copyCommand === null
) {
  throw new Error('The terminal page is missing its session banner')
}

let restarting = false
let actionLabel = 'Restart session'

// An arrow function, because a hoisted declaration would lose the null checks above.
const setRestarting = (active: boolean): void => {
  restarting = active
  restartButton.disabled = active
  restartButton.textContent = active ? 'Waiting ...' : actionLabel
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
api.onSessionExit(({ title, detail, action, command, exitCode }) => {
  actionLabel = action
  setRestarting(false)
  commandText.textContent = command
  commandRow.hidden = command === null
  copyCommand.textContent = 'Copy command'
  const code = exitCode === null ? '' : ` (exit code ${String(exitCode)})`
  exitText.textContent = `${title}${code}. ${detail}`
  exitBanner.hidden = false
  // Focused, so Enter restarts right away.
  restartButton.focus()
})

copyCommand.addEventListener('click', () => {
  api.copy(commandText.textContent)
  copyCommand.textContent = 'Copied'
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

function copySelection(): void {
  const selection = terminal.getSelection()
  if (selection !== '') api.copy(selection)
}

function pasteClipboard(): void {
  api
    .readClipboard()
    .then((text) => {
      // paste() wraps it for programs in bracketed paste mode, such as Claude's prompt.
      if (text !== '') terminal.paste(text)
    })
    .catch((error: unknown) => {
      console.warn('Could not read the clipboard', error)
    })
}

// Ctrl+C stays with the terminal, where it means interrupt.
const SHORTCUTS: Readonly<Record<string, () => void>> = {
  KeyC: copySelection,
  KeyV: pasteClipboard
}

terminal.attachCustomKeyEventHandler((event) => {
  const action =
    event.ctrlKey && event.shiftKey && !event.altKey ? SHORTCUTS[event.code] : undefined
  if (action === undefined) return true
  // False on every event type, so xterm never sees the key. Acting on keydown only runs it once.
  if (event.type === 'keydown') {
    event.preventDefault()
    action()
  }
  return false
})

container.addEventListener('contextmenu', (event) => {
  event.preventDefault()
  api.showContextMenu(terminal.hasSelection())
})

api.onMenuAction((action) => {
  if (action === 'copy') copySelection()
  else pasteClipboard()
  terminal.focus()
})

api.onFontSize((size) => {
  terminal.options.fontSize = size
  fitAndReport()
})

// The saved size comes first: the first report starts Claude, which should draw at the real size.
function startReporting(): void {
  new ResizeObserver(fitAndReport).observe(container as HTMLElement)
  fitAndReport()
  terminal.focus()
}

api
  .fontSize()
  .then((size) => {
    terminal.options.fontSize = size
  })
  .catch((error: unknown) => {
    console.warn('Using the default font size', error)
  })
  .finally(startReporting)

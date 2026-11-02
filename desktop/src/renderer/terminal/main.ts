import { FitAddon } from '@xterm/addon-fit'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { chunkInput } from '../../shared/chunkInput'
import type { TerminalApi } from '../../shared/ipcChannels'

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

// Acknowledged only once xterm has drawn it, which is what makes the flow control work.
api.onData((data) => {
  terminal.write(data, () => {
    api.ack(data.length)
  })
})

function fitAndReport(): void {
  fit.fit()
  api.resize(terminal.cols, terminal.rows)
}

new ResizeObserver(fitAndReport).observe(container)
fitAndReport()
terminal.focus()

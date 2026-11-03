import { writeFile } from 'node:fs/promises'
import { app, MessageChannelMain } from 'electron'
import { FRAME_SAMPLES } from '../shared/worker'
import { log } from './log'
import { cmdExePath } from './pty/resolveClaude'
import { SpeechSupervisor } from './speech/supervisor'
import { workerInit } from './speech/workerInit'
import { createWindow, loadRenderer } from './windows/factory'

type Check = 'ok' | 'failed'

const PTY_TIMEOUT_MS = 15000
const SPEECH_TIMEOUT_MS = 30000
const SPEECH_FRAMES = 40

// xterm's layers have their own z-index, and once covered the button by taking its clicks. A
// script's click() can't catch that, so this asks what a real click at its center would hit.
const RESTART_BUTTON_ON_TOP = `(() => {
  const banner = document.getElementById('session-exited')
  banner.hidden = false
  const box = document.getElementById('restart-session').getBoundingClientRect()
  const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)
  banner.hidden = true
  return top !== null && top.id === 'restart-session'
})()`

/**
 * Loads the terminal page in a hidden window. A failed load, a console error or a page that never
 * built its terminal is a failure. No IPC handlers are registered, so this can't start Claude.
 */
async function checkRenderer(): Promise<Check> {
  const window = createWindow('terminal', { showWhenReady: false })
  const consoleErrors: string[] = []
  window.webContents.on('console-message', (details) => {
    if (details.level === 'error') {
      consoleErrors.push(details.message)
      log.error(`Smoke test renderer error: ${details.message}`)
    }
  })

  try {
    await loadRenderer(window, 'terminal')
    const built: unknown = await window.webContents.executeJavaScript(
      "document.querySelector('.xterm') !== null"
    )
    if (built !== true) log.error('Smoke test: the page did not build its terminal')
    const clickable: unknown = await window.webContents.executeJavaScript(RESTART_BUTTON_ON_TOP)
    if (clickable !== true) log.error('Smoke test: something covers the Restart session button')
    return consoleErrors.length === 0 && built === true && clickable === true ? 'ok' : 'failed'
  } catch (error: unknown) {
    log.error('Smoke test could not load the renderer', error)
    return 'failed'
  }
}

/** Spawns `cmd.exe /c exit 0` through node-pty, proving the native module loads and runs. */
async function checkPty(): Promise<Check> {
  try {
    const { spawn } = await import('node-pty')
    const exitCode = await new Promise<number>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`No exit within ${String(PTY_TIMEOUT_MS)} ms`))
      }, PTY_TIMEOUT_MS)
      const pty = spawn(cmdExePath(), ['/c', 'exit', '0'], { cols: 80, rows: 24 })
      pty.onExit((event) => {
        clearTimeout(timer)
        resolve(event.exitCode)
      })
    })
    if (exitCode !== 0) log.error(`Smoke test: cmd.exe exited with ${String(exitCode)}`)
    return exitCode === 0 ? 'ok' : 'failed'
  } catch (error: unknown) {
    log.error('Smoke test could not run node-pty', error)
    return 'failed'
  }
}

/**
 * Starts the real worker, creates a VAD from the bundled Silero model and sends it frames over the
 * real port. Any worker error fails this, including Electron's external-buffer error.
 */
async function checkSpeech(): Promise<Check> {
  const errors: string[] = []
  let markReady: () => void = () => undefined
  const ready = new Promise<void>((resolve) => {
    markReady = resolve
  })
  const supervisor = new SpeechSupervisor({
    onEvent: (event) => {
      if (event.type === 'ready') markReady()
      // NO_SPEECH is the right answer to the silence this sends. Anything else is a failure.
      if (event.type === 'error' && event.code !== 'NO_SPEECH') {
        errors.push(event.message)
        log.error(`Smoke test speech error: ${event.message}`)
      }
    },
    onGaveUp: () => {
      errors.push('The speech worker kept crashing')
      markReady()
    }
  })
  try {
    supervisor.start(workerInit(undefined))
    await Promise.race([
      ready,
      new Promise((_resolve, reject) => {
        setTimeout(() => {
          reject(new Error(`No worker ready within ${String(SPEECH_TIMEOUT_MS)} ms`))
        }, SPEECH_TIMEOUT_MS)
      })
    ])
    const { port1, port2 } = new MessageChannelMain()
    supervisor.attachFramePort(port2)
    supervisor.send({ type: 'start', recordingId: 'smoke' })
    const silence = new Float32Array(FRAME_SAMPLES)
    for (let frame = 0; frame < SPEECH_FRAMES; frame++) port1.postMessage(silence)
    supervisor.send({ type: 'stop', recordingId: 'smoke' })
    // Long enough for the frames to arrive and the VAD to answer.
    await new Promise((resolve) => setTimeout(resolve, 1000))
    return errors.length === 0 ? 'ok' : 'failed'
  } catch (error: unknown) {
    log.error('Smoke test could not run the speech worker', error)
    return 'failed'
  } finally {
    await supervisor.stop()
  }
}

/**
 * Proves a packaged build starts, serves its renderer over app://, can run node-pty and can run the
 * speech worker (TECH_SPEC §7.2): writes a JSON result and exits 0, or exits 1. The result goes to a
 * file because a GUI exe has no reliable stdout.
 */
export async function runSmokeTest(resultPath: string): Promise<void> {
  try {
    const renderer = await checkRenderer()
    const pty = await checkPty()
    const speech = await checkSpeech()
    await writeFile(resultPath, JSON.stringify({ app: 'ok', renderer, pty, speech }))
    app.exit(renderer === 'ok' && pty === 'ok' && speech === 'ok' ? 0 : 1)
  } catch (error: unknown) {
    log.error(`Smoke test failed writing ${resultPath}`, error)
    app.exit(1)
  }
}

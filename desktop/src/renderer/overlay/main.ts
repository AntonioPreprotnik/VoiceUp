import type { OverlayApi, OverlaySound, OverlayState } from '../../shared/ipcChannels'

// The overlay: display only. It has no buttons, because it never takes focus or clicks.

declare global {
  interface Window {
    readonly voiceupOverlay: OverlayApi
  }
}

const pill = document.getElementById('pill')
const text = document.getElementById('text')
const meter = document.getElementById('meter')
const level = document.getElementById('level')
const hint = document.getElementById('hint')
if (pill === null || text === null || meter === null || level === null || hint === null) {
  throw new Error('The overlay page is missing an element')
}

// Speech sits low on a linear scale, so this spreads it across the meter.
function meterPercent(rms: number): number {
  return Math.min(100, Math.sqrt(rms) * 200)
}

/** From full to empty over the countdown, which the compositor can run without any messages. */
function runCountdown(bar: HTMLElement, ms: number): void {
  bar.style.transition = 'none'
  bar.style.width = '100%'
  // Reading this applies the full width first, or the transition would have nothing to run from.
  bar.getBoundingClientRect()
  bar.style.transition = `width ${String(ms)}ms linear`
  bar.style.width = '0%'
}

function show(state: OverlayState): void {
  if (pill === null || text === null || meter === null || level === null || hint === null) return
  pill.hidden = state.phase === 'hidden'
  pill.dataset['kind'] =
    state.phase === 'error' || state.phase === 'blocked'
      ? 'error'
      : state.phase === 'preview'
        ? 'preview'
        : 'info'
  const counting = state.phase === 'preview' && state.countdownMs !== null
  meter.hidden = state.phase !== 'listening' && !counting
  hint.hidden = state.phase !== 'preview' && state.phase !== 'blocked'
  if (state.phase === 'listening') {
    text.textContent = 'Listening…'
    level.style.transition = 'none'
    level.style.width = `${String(meterPercent(state.level))}%`
  } else if (state.phase === 'preview') {
    // Shown with textContent, never as markup: this is what the microphone heard.
    text.textContent = state.text
    hint.textContent =
      state.countdownMs === null
        ? 'Hotkey sends · Esc cancels'
        : 'Sending soon · Hotkey sends now · Esc cancels'
    if (state.countdownMs !== null) runCountdown(level, state.countdownMs)
  } else if (state.phase === 'blocked') {
    text.textContent = state.reason
    hint.textContent = 'Not sent yet · Hotkey tries again · Esc discards'
  } else if (state.phase === 'transcribing') {
    text.textContent = 'Transcribing…'
  } else if (state.phase === 'error') {
    // Shown with textContent, never as markup.
    text.textContent = state.message
  }
}

// Generated, so there are no audio files to ship. Short and quiet, because the start sound plays
// just before the microphone opens, and it must not read as speech.
const TONES: Readonly<Record<OverlaySound, readonly number[]>> = {
  start: [660, 880],
  stop: [880, 660]
}
const TONE_SECONDS = 0.045
const VOLUME = 0.05

function play(sound: OverlaySound): void {
  const context = new AudioContext()
  const gain = context.createGain()
  gain.gain.value = VOLUME
  gain.connect(context.destination)
  TONES[sound].forEach((frequency, index) => {
    const oscillator = context.createOscillator()
    oscillator.frequency.value = frequency
    oscillator.connect(gain)
    oscillator.start(context.currentTime + index * TONE_SECONDS)
    oscillator.stop(context.currentTime + (index + 1) * TONE_SECONDS)
  })
  window.setTimeout(
    () => {
      context.close().catch((error: unknown) => {
        console.warn('Could not close the sound context', error)
      })
    },
    TONES[sound].length * TONE_SECONDS * 1000 + 200
  )
}

window.voiceupOverlay.onShow(show)
window.voiceupOverlay.onSound(play)

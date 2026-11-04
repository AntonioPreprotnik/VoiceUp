import { MESSAGES, type MessageCode } from '../messages'
import type { StatusView } from '../../shared/ipcChannels'
import type { ClaudeState } from './reducer'

// What each state looks like, in one place, so the status bar and the tray can't disagree.

const VIEWS: Readonly<Record<ClaudeState, Omit<StatusView, 'canReArm'>>> = {
  starting: {
    state: 'starting',
    label: 'Starting',
    detail: 'Voice is off until Claude is ready. Finish any prompt in the terminal.',
    color: '#9d9d9d'
  },
  idle: {
    state: 'idle',
    label: 'Ready',
    detail: 'Claude is waiting for you.',
    color: '#4ec96f'
  },
  busy: {
    state: 'busy',
    label: 'Working',
    detail: 'Claude is working on your request.',
    color: '#4aa3f0'
  },
  awaitingPermission: {
    state: 'awaitingPermission',
    label: 'Needs permission',
    detail: 'Answer the prompt in the terminal. Voice is off until you do.',
    color: '#f0b429'
  },
  awaitingInput: {
    state: 'awaitingInput',
    label: 'Needs an answer',
    detail: 'Answer the question in the terminal. Voice is off until you do.',
    color: '#c586e8'
  },
  unknown: {
    state: 'unknown',
    label: 'Paused',
    detail: "Can't tell if Claude is ready. If you see its main prompt, choose Re-arm voice.",
    color: '#ff8c42'
  },
  exited: {
    state: 'exited',
    label: 'Session ended',
    detail: 'Restart the session to continue.',
    color: '#f14c4c'
  }
}

/** A block on voice outranks the state, which would otherwise say Starting forever. */
export function statusView(state: ClaudeState, voiceBlock: MessageCode | null): StatusView {
  if (voiceBlock !== null) {
    return {
      state: 'blocked',
      label: 'Voice off',
      detail: MESSAGES[voiceBlock].title,
      color: VIEWS.exited.color,
      canReArm: false
    }
  }
  return { ...VIEWS[state], canReArm: state === 'unknown' }
}

export interface StateNotice {
  readonly title: string
  readonly body: string
}

/** Fixed wording: nothing Claude said or the user said ever reaches a notification. */
export function noticeFor(previous: ClaudeState, state: ClaudeState): StateNotice | null {
  if (state === 'awaitingPermission' && previous !== 'awaitingPermission') {
    return { title: 'Claude needs your permission', body: 'Open VoiceUp to answer the prompt.' }
  }
  if (state === 'awaitingInput' && previous !== 'awaitingInput') {
    return { title: 'Claude has a question', body: 'Open VoiceUp to answer it.' }
  }
  if (state === 'idle' && previous === 'busy') {
    return { title: 'Claude finished', body: 'It is ready for your next command.' }
  }
  return null
}

/** A filled circle as premultiplied BGRA, which is what a native bitmap holds. No files needed. */
export function dotBitmap(color: string, size: number): Uint8Array {
  const value = Number.parseInt(color.slice(1), 16)
  const [red, green, blue] = [(value >> 16) & 255, (value >> 8) & 255, value & 255]
  const pixels = new Uint8Array(size * size * 4)
  const centre = (size - 1) / 2
  const radius = size / 2 - size / 16
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const distance = Math.hypot(x - centre, y - centre)
      const alpha = Math.min(1, Math.max(0, radius - distance + 0.5))
      const at = (y * size + x) * 4
      pixels[at] = Math.round(blue * alpha)
      pixels[at + 1] = Math.round(green * alpha)
      pixels[at + 2] = Math.round(red * alpha)
      pixels[at + 3] = Math.round(255 * alpha)
    }
  }
  return pixels
}

// App updates (S7.4): what the updater is doing, and what happens to a downloaded update on exit.

/** Long enough that a check never competes with Claude starting or the model download. */
export const UPDATE_FIRST_CHECK_DELAY_MS = 30_000
/** VoiceUp sits in the tray all day, so it checks again now and then. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

export type UpdateStatus =
  | { readonly kind: 'idle' }
  | { readonly kind: 'checking' }
  | { readonly kind: 'downloading'; readonly version: string }
  | { readonly kind: 'ready'; readonly version: string }
  | { readonly kind: 'failed' }

export type UpdateEvent =
  | { readonly type: 'checking' }
  | { readonly type: 'available'; readonly version: string }
  | { readonly type: 'notAvailable' }
  | { readonly type: 'downloaded'; readonly version: string }
  | { readonly type: 'error' }

/** Why the app is exiting. */
export type ExitReason = 'quit' | 'restart' | 'sessionEnd'

export function nextUpdateStatus(status: UpdateStatus, event: UpdateEvent): UpdateStatus {
  // A downloaded update stays ready until a newer one has downloaded in its place.
  if (status.kind === 'ready' && event.type !== 'downloaded') return status
  switch (event.type) {
    case 'checking':
      return { kind: 'checking' }
    case 'available':
      return { kind: 'downloading', version: event.version }
    case 'notAvailable':
      return { kind: 'idle' }
    case 'downloaded':
      return { kind: 'ready', version: event.version }
    case 'error':
      return { kind: 'failed' }
  }
}

export function shouldCheck(status: UpdateStatus): boolean {
  return status.kind !== 'checking' && status.kind !== 'downloading'
}

/** Once per downloaded version: when to tell the user. */
export function isNewlyReady(previous: UpdateStatus, next: UpdateStatus): boolean {
  return next.kind === 'ready' && (previous.kind !== 'ready' || previous.version !== next.version)
}

/**
 * The installer runs silently as VoiceUp exits, so Claude is never cut off by an update. Not while
 * Windows signs out or shuts down, which could stop the installer halfway: it waits for the next quit.
 */
export function installOnExit(
  status: UpdateStatus,
  reason: ExitReason
): { readonly relaunch: boolean } | null {
  if (status.kind !== 'ready' || reason === 'sessionEnd') return null
  return { relaunch: reason === 'restart' }
}

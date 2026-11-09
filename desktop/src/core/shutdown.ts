// Shutdown order from TECH_SPEC §3. Later stories fill in the steps they own.
export const SHUTDOWN_ORDER = [
  'shortcuts',
  'tray',
  'recording',
  'pty',
  'worker',
  'hookServer',
  'hookFiles',
  // Last before the logs, so the app has let go of everything the installer replaces (S7.4).
  'update',
  'logs'
] as const

export type ShutdownStep = (typeof SHUTDOWN_ORDER)[number]
export type ShutdownSteps = Partial<Record<ShutdownStep, () => Promise<void> | void>>

/** Runs the steps in order. A failed step is reported and does not stop the ones after it. */
export async function runShutdown(
  steps: ShutdownSteps,
  onError: (step: ShutdownStep, error: unknown) => void
): Promise<void> {
  for (const name of SHUTDOWN_ORDER) {
    try {
      await steps[name]?.()
    } catch (error: unknown) {
      onError(name, error)
    }
  }
}

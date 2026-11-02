/**
 * node-pty's kill() calls child_process.fork, which throws under the runAsNode fuse and leaves one
 * unhandled rejection per kill. The native kill still runs, so it is harmless (decision note S0.6).
 */
export function isKnownPtyKillRejection(reason: unknown): boolean {
  return (
    reason instanceof Error && reason.message.startsWith('child_process.fork() is not supported')
  )
}

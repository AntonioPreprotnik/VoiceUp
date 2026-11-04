/** A timer that returns its own cancel, for the pure classes in core/ that can't use timers. */
export function schedule(callback: () => void, ms: number): () => void {
  const timer = setTimeout(callback, ms)
  return () => {
    clearTimeout(timer)
  }
}

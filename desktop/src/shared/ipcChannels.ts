// Channel names only, with no imports: a sandboxed preload can't load zod at runtime, so it must
// not pull in ipc.ts. Payloads are in TECH_SPEC §6.1.
export const Channels = {
  termData: 'term:data',
  termInput: 'term:input',
  termResize: 'term:resize',
  termAck: 'term:ack',
  sessionExited: 'session:exited',
  sessionRestart: 'session:restart'
} as const

/** Why the session ended, in words the terminal window can show as they are. */
export interface SessionExit {
  readonly title: string
  readonly detail: string
  /** Null when Claude never started, so there is no code to show. */
  readonly exitCode: number | null
}

/** What the terminal preload exposes as window.voiceup. */
export interface TerminalApi {
  /** Windows build number, which xterm needs to handle ConPTY's line wrapping. */
  readonly windowsBuild: number
  input(data: string): void
  resize(cols: number, rows: number): void
  ack(chars: number): void
  /** Returns the function that unsubscribes. */
  onData(listener: (data: string) => void): () => void
  /** Returns the function that unsubscribes. */
  onSessionExit(listener: (exit: SessionExit) => void): () => void
  restartSession(): void
}

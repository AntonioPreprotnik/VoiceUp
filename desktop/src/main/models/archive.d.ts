// These packages ship no types. This declares only what manager.ts uses.
declare module 'unbzip2-stream' {
  import type { Duplex } from 'node:stream'

  export default function unbzip2(): Duplex
}

declare module 'tar-stream' {
  import type { Duplex, Readable } from 'node:stream'

  interface Header {
    readonly name: string
    readonly type: string | null
  }

  interface Extract extends Duplex {
    on(
      event: 'entry',
      listener: (header: Header, stream: Readable, next: (error?: Error) => void) => void
    ): this
    on(event: string, listener: (...args: never[]) => void): this
  }

  const tar: { extract(): Extract }
  export default tar
}

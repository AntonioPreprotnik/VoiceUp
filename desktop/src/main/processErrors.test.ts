import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import fakeLog from '../../test/fakes/electronLog'
import { installProcessErrorLogging } from './processErrors'

vi.mock('electron', () => import('../../test/fakes/electron'))
vi.mock('electron-log/main', () => import('../../test/fakes/electronLog'))

let removeAdded: () => void

beforeEach(() => {
  fakeLog.reset()
  const rejectionsBefore = process.listeners('unhandledRejection')
  const exceptionsBefore = process.listeners('uncaughtException')
  installProcessErrorLogging()
  // Vitest has its own listeners, so only the ones this install added are removed afterwards.
  removeAdded = () => {
    for (const listener of process.listeners('unhandledRejection')) {
      if (!rejectionsBefore.includes(listener)) process.off('unhandledRejection', listener)
    }
    for (const listener of process.listeners('uncaughtException')) {
      if (!exceptionsBefore.includes(listener)) process.off('uncaughtException', listener)
    }
  }
})

afterEach(() => {
  removeAdded()
})

function rejectWith(reason: unknown): void {
  process.listeners('unhandledRejection').at(-1)?.(reason, Promise.resolve())
}

describe('process error logging', () => {
  it('logs an unhandled rejection as an error', () => {
    const error = new Error('boom')
    rejectWith(error)
    expect(fakeLog.messages('error')).toEqual([['Unhandled rejection', error]])
  })

  it('logs the known node-pty rejection at debug only', () => {
    rejectWith(new Error('child_process.fork() is not supported when the runAsNode fuse is off'))
    expect(fakeLog.messages('error')).toEqual([])
    expect(fakeLog.messages('debug')).toHaveLength(1)
  })

  it('logs an uncaught exception ahead of the existing handlers', () => {
    const error = new Error('boom')
    process.listeners('uncaughtException').at(0)?.(error, 'uncaughtException')
    expect(fakeLog.messages('error')).toEqual([['Uncaught exception', error]])
  })
})

import { describe, expect, it } from 'vitest'
import { runShutdown, SHUTDOWN_ORDER, type ShutdownStep, type ShutdownSteps } from './shutdown'

describe('runShutdown', () => {
  it('follows the TECH_SPEC §3 order', () => {
    expect(SHUTDOWN_ORDER).toEqual([
      'shortcuts',
      'recording',
      'pty',
      'worker',
      'hookServer',
      'hookFiles',
      'logs'
    ])
  })

  it('runs steps in order whatever order they were given in', async () => {
    const ran: ShutdownStep[] = []
    const steps: ShutdownSteps = {
      logs: () => {
        ran.push('logs')
      },
      pty: () => {
        ran.push('pty')
      },
      shortcuts: () => {
        ran.push('shortcuts')
      }
    }
    await runShutdown(steps, () => undefined)
    expect(ran).toEqual(['shortcuts', 'pty', 'logs'])
  })

  it('waits for an async step before the next one', async () => {
    const ran: string[] = []
    await runShutdown(
      {
        pty: async () => {
          await Promise.resolve()
          ran.push('pty')
        },
        worker: () => {
          ran.push('worker')
        }
      },
      () => undefined
    )
    expect(ran).toEqual(['pty', 'worker'])
  })

  it('reports a failed step and still runs the rest', async () => {
    const ran: string[] = []
    const failures: [ShutdownStep, unknown][] = []
    const boom = new Error('boom')
    await runShutdown(
      {
        pty: () => {
          throw boom
        },
        worker: () => Promise.reject(boom),
        logs: () => {
          ran.push('logs')
        }
      },
      (step, error) => {
        failures.push([step, error])
      }
    )
    expect(failures).toEqual([
      ['pty', boom],
      ['worker', boom]
    ])
    expect(ran).toEqual(['logs'])
  })
})

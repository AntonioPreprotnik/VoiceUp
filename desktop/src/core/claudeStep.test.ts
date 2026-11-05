import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ClaudeCommand } from './claudeCommand'
import { ClaudeStep } from './claudeStep'
import { INSTALL_COMMAND, MIN_CLAUDE_VERSION, UPDATE_COMMAND } from './claudeVersion'

const CLAUDE: ClaudeCommand = { file: 'claude.exe', args: [] }
const find = vi.fn<() => Promise<ClaudeCommand | null>>()
const readVersion = vi.fn<(command: ClaudeCommand) => Promise<string | null>>()
const install = vi.fn<() => Promise<void>>()
const onChange = vi.fn()
const onError = vi.fn()
let step: ClaudeStep

beforeEach(() => {
  vi.resetAllMocks()
  find.mockResolvedValue(CLAUDE)
  readVersion.mockResolvedValue(MIN_CLAUDE_VERSION)
  install.mockResolvedValue()
  step = new ClaudeStep({ find, readVersion, install, onChange, onError })
})

async function missing(): Promise<void> {
  find.mockResolvedValueOnce(null)
  await step.check()
}

describe('check', () => {
  it('starts out checking, and can not continue', () => {
    expect(step.status).toEqual({ status: 'checking' })
    expect(step.canContinue).toBe(false)
  })

  it('is ready with a good version', async () => {
    await step.check()
    expect(step.status).toEqual({ status: 'ready', version: MIN_CLAUDE_VERSION })
    expect(step.canContinue).toBe(true)
  })

  it('offers the install command when Claude is missing', async () => {
    await missing()
    expect(step.status).toEqual({ status: 'missing', command: INSTALL_COMMAND })
    expect(step.canContinue).toBe(false)
  })

  it('offers the update command for an old version, and can not continue', async () => {
    readVersion.mockResolvedValue('2.0.0')
    await step.check()
    expect(step.status).toEqual({
      status: 'tooOld',
      version: '2.0.0',
      minimum: MIN_CLAUDE_VERSION,
      command: UPDATE_COMMAND
    })
    expect(step.canContinue).toBe(false)
  })

  it('goes on when the version can not be read', async () => {
    readVersion.mockResolvedValue(null)
    await step.check()
    expect(step.status).toEqual({ status: 'ready', version: null })
    expect(step.canContinue).toBe(true)
  })

  it('reports a failure, and never stays on checking', async () => {
    find.mockRejectedValue(new Error('no'))
    await step.check()
    expect(step.status.status).toBe('failed')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('announces each change', async () => {
    await step.check()
    expect(onChange).toHaveBeenCalledTimes(2)
  })

  it('runs one at a time', async () => {
    const first = step.check()
    await step.check()
    await first
    expect(find).toHaveBeenCalledOnce()
  })
})

describe('install', () => {
  it('never runs until Claude is known to be missing', async () => {
    await step.install()
    expect(install).not.toHaveBeenCalled()
  })

  it('never runs over a working or an old Claude', async () => {
    await step.check()
    await step.install()
    readVersion.mockResolvedValue('2.0.0')
    await step.check()
    await step.install()
    expect(install).not.toHaveBeenCalled()
  })

  it('looks again afterwards, finding the new Claude', async () => {
    await missing()
    const running = step.install()
    expect(step.status).toEqual({ status: 'installing' })
    await running
    expect(step.status).toEqual({ status: 'ready', version: MIN_CLAUDE_VERSION })
  })

  it('has failed if Claude is still missing afterwards', async () => {
    await missing()
    find.mockResolvedValueOnce(null)
    await step.install()
    expect(step.status).toEqual({ status: 'failed', command: INSTALL_COMMAND })
    expect(step.canContinue).toBe(false)
  })

  it('can try again after a failure', async () => {
    await missing()
    find.mockResolvedValueOnce(null)
    await step.install()
    await step.install()
    expect(install).toHaveBeenCalledTimes(2)
    expect(step.canContinue).toBe(true)
  })

  it('reports an installer that could not run', async () => {
    await missing()
    install.mockRejectedValue(new Error('no PowerShell'))
    await step.install()
    expect(step.status.status).toBe('failed')
    expect(onError).toHaveBeenCalledOnce()
  })

  it('starts only one, however often it is clicked', async () => {
    await missing()
    await Promise.all([step.install(), step.install()])
    expect(install).toHaveBeenCalledOnce()
  })

  it('does not check during an install', async () => {
    await missing()
    find.mockClear()
    const running = step.install()
    await step.check()
    expect(step.status).toEqual({ status: 'installing' })
    await running
    expect(find).toHaveBeenCalledOnce()
  })
})

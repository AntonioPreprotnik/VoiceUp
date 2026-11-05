import { describe, expect, it } from 'vitest'
import { WizardFlow } from './wizardFlow'

const IDS = [
  'claudeCode',
  'projectFolder',
  'signIn',
  'speechModel',
  'claudeInChrome',
  'micAndHotkey'
]

function current(flow: WizardFlow): string | undefined {
  return flow.view.steps[flow.view.index]?.id
}

describe('WizardFlow', () => {
  it('has the steps of the plan, in order', () => {
    expect(new WizardFlow([]).view.steps.map(({ id }) => id)).toEqual(IDS)
  })

  it('starts at the first step', () => {
    expect(current(new WizardFlow([]))).toBe('claudeCode')
  })

  it('resumes at the first unfinished step', () => {
    expect(current(new WizardFlow(['claudeCode', 'projectFolder']))).toBe('signIn')
  })

  it('resumes at a gap, not after the last finished step', () => {
    expect(current(new WizardFlow(['claudeCode', 'signIn']))).toBe('projectFolder')
  })

  it('moves on and records the step', () => {
    const flow = new WizardFlow([])
    flow.next()
    expect(current(flow)).toBe('projectFolder')
    expect(flow.completed).toEqual(['claudeCode'])
    expect(flow.view.steps[0]?.done).toBe(true)
    expect(flow.finished).toBe(false)
  })

  it('finishes only from the last step', () => {
    const flow = new WizardFlow(IDS.slice(0, -1))
    expect(flow.finished).toBe(false)
    flow.next()
    expect(flow.finished).toBe(true)
    expect(flow.completed).toEqual(IDS)
  })

  it('goes back without undoing a finished step', () => {
    const flow = new WizardFlow([])
    flow.next()
    flow.back()
    expect(current(flow)).toBe('claudeCode')
    expect(flow.completed).toEqual(['claudeCode'])
  })

  it('stays on the first step when going back from it', () => {
    const flow = new WizardFlow([])
    flow.back()
    expect(flow.view.index).toBe(0)
  })

  it('does nothing after it has finished', () => {
    const flow = new WizardFlow(IDS.slice(0, -1))
    flow.next()
    const { index } = flow.view
    flow.next()
    flow.back()
    expect(flow.view.index).toBe(index)
    expect(flow.finished).toBe(true)
  })

  it('ignores a saved step it does not know, and keeps it', () => {
    const flow = new WizardFlow(['fromANewerVersion', 'claudeCode'])
    expect(current(flow)).toBe('projectFolder')
    expect(flow.completed).toContain('fromANewerVersion')
  })

  it('shows the last step when all are saved but the wizard never finished', () => {
    const flow = new WizardFlow(IDS)
    expect(current(flow)).toBe('micAndHotkey')
    expect(flow.finished).toBe(false)
  })
})

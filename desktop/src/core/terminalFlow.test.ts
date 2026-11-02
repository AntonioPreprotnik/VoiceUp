import { describe, expect, it } from 'vitest'
import { clampTermSize, FlowControl, OutputBatcher, PAUSE_ABOVE_CHARS } from './terminalFlow'

describe('clampTermSize', () => {
  it('keeps a size in range', () => {
    expect(clampTermSize({ cols: 80, rows: 24 })).toEqual({ cols: 80, rows: 24 })
  })

  it.each([
    [
      { cols: 1, rows: 1 },
      { cols: 10, rows: 5 }
    ],
    [
      { cols: 10, rows: 5 },
      { cols: 10, rows: 5 }
    ],
    [
      { cols: 1000, rows: 500 },
      { cols: 1000, rows: 500 }
    ],
    [
      { cols: 5000, rows: 5000 },
      { cols: 1000, rows: 500 }
    ],
    [
      { cols: -3, rows: 0 },
      { cols: 10, rows: 5 }
    ]
  ])('clamps %j', (size, expected) => {
    expect(clampTermSize(size)).toEqual(expected)
  })
})

describe('OutputBatcher', () => {
  function setup(): { delivered: string[]; ticks: (() => void)[]; batcher: OutputBatcher } {
    const delivered: string[] = []
    const ticks: (() => void)[] = []
    const batcher = new OutputBatcher(
      (data) => delivered.push(data),
      (callback) => ticks.push(callback)
    )
    return { delivered, ticks, batcher }
  }

  it('joins output from one tick into one delivery', () => {
    const { delivered, ticks, batcher } = setup()
    batcher.push('a')
    batcher.push('b')
    expect(delivered).toEqual([])
    expect(ticks).toHaveLength(1)
    ticks[0]?.()
    expect(delivered).toEqual(['ab'])
  })

  it('schedules again after a tick', () => {
    const { delivered, ticks, batcher } = setup()
    batcher.push('a')
    ticks[0]?.()
    batcher.push('b')
    ticks[1]?.()
    expect(delivered).toEqual(['a', 'b'])
  })

  it('delivers at once on flush, and the pending tick then delivers nothing', () => {
    const { delivered, ticks, batcher } = setup()
    batcher.push('a')
    batcher.flush()
    expect(delivered).toEqual(['a'])
    ticks[0]?.()
    expect(delivered).toEqual(['a'])
  })

  it('delivers nothing on flush when empty', () => {
    const { delivered, batcher } = setup()
    batcher.flush()
    expect(delivered).toEqual([])
  })
})

describe('FlowControl', () => {
  it('does not pause at the limit', () => {
    expect(new FlowControl().sent(PAUSE_ABOVE_CHARS)).toBe(false)
  })

  it('pauses once above the limit, and only says so once', () => {
    const flow = new FlowControl()
    expect(flow.sent(PAUSE_ABOVE_CHARS + 1)).toBe(true)
    expect(flow.sent(1)).toBe(false)
  })

  it('resumes when acknowledgements bring it back to the limit', () => {
    const flow = new FlowControl()
    flow.sent(PAUSE_ABOVE_CHARS + 10)
    expect(flow.acknowledged(5)).toBe(false)
    expect(flow.acknowledged(5)).toBe(true)
  })

  it('does not resume when it is not paused', () => {
    const flow = new FlowControl()
    flow.sent(10)
    expect(flow.acknowledged(10)).toBe(false)
  })

  it('can pause again after resuming', () => {
    const flow = new FlowControl()
    flow.sent(PAUSE_ABOVE_CHARS + 1)
    flow.acknowledged(PAUSE_ABOVE_CHARS + 1)
    expect(flow.sent(PAUSE_ABOVE_CHARS + 1)).toBe(true)
  })

  it('ignores an over-acknowledgement rather than going negative', () => {
    const flow = new FlowControl()
    flow.acknowledged(100)
    expect(flow.sent(PAUSE_ABOVE_CHARS)).toBe(false)
    expect(flow.sent(1)).toBe(true)
  })
})

// The limits match settings.ui.fontSize in TECH_SPEC §6.4.
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 32
const DEFAULT_FONT_SIZE = 14

export type FontSizeChange = 'larger' | 'smaller' | 'reset'

export function adjustFontSize(current: number, change: FontSizeChange): number {
  if (change === 'reset') return DEFAULT_FONT_SIZE
  const next = change === 'larger' ? current + 1 : current - 1
  return Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, next))
}

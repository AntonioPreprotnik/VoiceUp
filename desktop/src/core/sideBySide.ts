export interface Rect {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const WIZARD_WIDTH = 560
const MIN_TERMINAL_WIDTH = 480

/**
 * The terminal on the left and the wizard on the right, filling the work area. On a screen too
 * narrow for both, the wizard overlaps the terminal's right edge rather than leaving the screen.
 */
export function sideBySide(workArea: Rect): { terminal: Rect; wizard: Rect } {
  const { x, y, width, height } = workArea
  const wizardWidth = Math.min(WIZARD_WIDTH, width)
  return {
    terminal: {
      x,
      y,
      width: Math.max(width - wizardWidth, Math.min(MIN_TERMINAL_WIDTH, width)),
      height
    },
    wizard: { x: x + width - wizardWidth, y, width: wizardWidth, height }
  }
}

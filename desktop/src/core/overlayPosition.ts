export interface Rectangle {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

const MARGIN = 16

/** Centered just above the taskbar. The work area already leaves out the taskbar, wherever it is. */
export function overlayBounds(
  workArea: Rectangle,
  size: { width: number; height: number }
): Rectangle {
  return {
    x: Math.round(workArea.x + (workArea.width - size.width) / 2),
    y: Math.round(workArea.y + workArea.height - size.height - MARGIN),
    width: size.width,
    height: size.height
  }
}

import { app } from 'electron'
import type { RendererMode } from '../core/appUrl'

/** Dev-mode exceptions apply only when !app.isPackaged (TECH_SPEC §7.1). */
export function rendererMode(): RendererMode {
  return { isPackaged: app.isPackaged, devServerUrl: process.env['ELECTRON_RENDERER_URL'] }
}

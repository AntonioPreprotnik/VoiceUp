import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// One preload and one HTML entry per window (TECH_SPEC §7.1).
export default defineConfig({
  main: {},
  preload: {
    build: {
      rollupOptions: {
        input: { terminal: resolve(__dirname, 'src/preload/terminal.ts') }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: { terminal: resolve(__dirname, 'src/renderer/terminal/index.html') }
      }
    }
  }
})

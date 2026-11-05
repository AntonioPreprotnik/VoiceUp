import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

// One preload and one HTML entry per window (TECH_SPEC §7.1).
export default defineConfig({
  // The speech worker is a second entry, because it runs in its own utilityProcess.
  main: {
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          speechWorker: resolve(__dirname, 'src/worker/speechWorker.ts')
        },
        // Beside the entries: main finds the worker, preload and renderer relative to __dirname.
        output: { chunkFileNames: '[name]-[hash].js' }
      }
    }
  },
  preload: {
    build: {
      rollupOptions: {
        input: {
          terminal: resolve(__dirname, 'src/preload/terminal.ts'),
          recorder: resolve(__dirname, 'src/preload/recorder.ts'),
          overlay: resolve(__dirname, 'src/preload/overlay.ts'),
          wizard: resolve(__dirname, 'src/preload/wizard.ts')
        }
      }
    }
  },
  renderer: {
    build: {
      rollupOptions: {
        input: {
          terminal: resolve(__dirname, 'src/renderer/terminal/index.html'),
          recorder: resolve(__dirname, 'src/renderer/recorder/index.html'),
          overlay: resolve(__dirname, 'src/renderer/overlay/index.html'),
          wizard: resolve(__dirname, 'src/renderer/wizard/index.html')
        }
      }
    }
  }
})

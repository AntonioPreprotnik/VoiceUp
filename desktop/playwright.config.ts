import { defineConfig } from '@playwright/test'

// Against the unpackaged app, since the packaged fuses turn off what Playwright needs (TECH_SPEC §8).
// One at a time: each test holds the global hotkey.
export default defineConfig({
  testDir: './test/e2e',
  testMatch: '*.e2e.ts',
  workers: 1,
  timeout: 60000,
  // On CI, failures also become annotations, which can be read without opening the job log.
  reporter: process.env['CI'] === undefined ? 'line' : [['line'], ['github']]
})

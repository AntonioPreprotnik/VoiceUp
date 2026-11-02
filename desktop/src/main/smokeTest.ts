import { writeFile } from 'node:fs/promises'
import { app } from 'electron'

/**
 * Proves a packaged build starts (TECH_SPEC §7.2): writes a JSON result and exits 0, or exits 1.
 * S1.1 adds node-pty and S4.2 adds speech. The result goes to a file because a GUI exe has no
 * reliable stdout.
 */
export async function runSmokeTest(resultPath: string): Promise<void> {
  try {
    await writeFile(resultPath, JSON.stringify({ app: 'ok' }))
    app.exit(0)
  } catch (error: unknown) {
    console.error(`Smoke test failed writing ${resultPath}`, error)
    app.exit(1)
  }
}

import { app } from 'electron'
import { browserForTest, browserFromAppName } from '../core/chromeStep'
import type { ChromeBrowser } from '../shared/ipcChannels'
import { browserPlaces, findBrowsers, openForTest, openStore } from './browser/chromeExtension'
import { readClaudeVersion } from './pty/claudeVersion'
import { installScript, runInstaller } from './pty/installClaude'
import { isDirectory, pickProjectFolder } from './pty/projectFolder'
import { resolveClaude } from './pty/resolveClaude'
import { schedule } from './schedule'
import type { WizardOptions } from './wizard'

/** What the wizard asks of Windows itself, apart from the running session. */
export type WizardSystem = Pick<
  WizardOptions,
  | 'findClaude'
  | 'readClaudeVersion'
  | 'runInstaller'
  | 'chooseFolder'
  | 'isFolder'
  | 'schedule'
  | 'apiKeySet'
  | 'browsers'
>

export function wizardSystem(): WizardSystem {
  // Windows' default browser, by name, so setup uses the one the user browses with.
  const defaultBrowser = (): ChromeBrowser | null =>
    browserFromAppName(app.getApplicationNameForProtocol('https://example.com'))
  return {
    findClaude: () => resolveClaude(app.isPackaged),
    readClaudeVersion,
    runInstaller: (onOutput) => runInstaller(installScript(app.isPackaged), onOutput),
    chooseFolder: pickProjectFolder,
    isFolder: isDirectory,
    schedule,
    // Whether it is set, and never its value.
    apiKeySet: (process.env['ANTHROPIC_API_KEY'] ?? '') !== '',
    browsers: {
      find: () => findBrowsers(browserPlaces(app.isPackaged)),
      open: (browser) => {
        openStore(browser, browserPlaces(app.isPackaged))
      },
      defaultBrowser,
      openForTest: () => {
        const places = browserPlaces(app.isPackaged)
        return openForTest(browserForTest(findBrowsers(places), defaultBrowser()), places)
      }
    }
  }
}

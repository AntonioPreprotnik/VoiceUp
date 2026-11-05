import { execFile } from 'node:child_process'
import type { Settings } from '../../shared/settings'
import { log } from '../log'
import { system32Path } from '../pty/resolveClaude'

export type BrowserChoice = Exclude<Settings['claude']['showBrowser'], 'off'>

/** The only values that ever reach the script below, so a settings file can't add to it. */
const PROCESS_NAMES: Record<BrowserChoice, string> = {
  brave: 'brave',
  chrome: 'chrome',
  edge: 'msedge'
}

const EXIT_NOT_RUNNING = 10
const EXIT_NO_WINDOW = 11
const EXIT_BLOCKED = 12
const TIMEOUT_MS = 15000

/**
 * Electron can't move another app's window, so this asks Windows through PowerShell. It finds the
 * browser's topmost window, the one used last, and reports whether it really came to the front.
 */
export function showBrowserScript(browser: BrowserChoice): string {
  return `
Add-Type -Namespace VoiceUp -Name Win -MemberDefinition @'
public delegate bool EnumProc(IntPtr h, IntPtr l);
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc c, IntPtr l);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
[DllImport("user32.dll")] public static extern int GetWindowTextLength(IntPtr h);
'@
$ids = @(Get-Process -Name '${PROCESS_NAMES[browser]}' -ErrorAction SilentlyContinue | ForEach-Object { $_.Id })
if ($ids.Count -eq 0) { exit ${String(EXIT_NOT_RUNNING)} }
$script:found = [IntPtr]::Zero
$callback = [VoiceUp.Win+EnumProc]{
  param($h, $l)
  $owner = [uint32]0
  [void][VoiceUp.Win]::GetWindowThreadProcessId($h, [ref]$owner)
  if (($ids -contains [int]$owner) -and [VoiceUp.Win]::IsWindowVisible($h) -and ([VoiceUp.Win]::GetWindowTextLength($h) -gt 0)) {
    $script:found = $h
    return $false
  }
  return $true
}
[void][VoiceUp.Win]::EnumWindows($callback, [IntPtr]::Zero)
if ($script:found -eq [IntPtr]::Zero) { exit ${String(EXIT_NO_WINDOW)} }
if ([VoiceUp.Win]::IsIconic($script:found)) { [void][VoiceUp.Win]::ShowWindow($script:found, 9) }
[void][VoiceUp.Win]::SetForegroundWindow($script:found)
Start-Sleep -Milliseconds 200
if ([VoiceUp.Win]::GetForegroundWindow() -ne $script:found) { exit ${String(EXIT_BLOCKED)} }
exit 0
`
}

/** The exit code, or null if PowerShell didn't run or was stopped. */
export type RunScript = (script: string) => Promise<number | null>

const runPowerShell: RunScript = (script) =>
  new Promise((resolve) => {
    execFile(
      system32Path('WindowsPowerShell\\v1.0\\powershell.exe'),
      [
        '-NoProfile',
        '-NonInteractive',
        '-EncodedCommand',
        Buffer.from(script, 'utf16le').toString('base64')
      ],
      { windowsHide: true, timeout: TIMEOUT_MS },
      (error) => {
        if (error === null) {
          resolve(0)
          return
        }
        resolve(typeof error.code === 'number' ? error.code : null)
      }
    )
  })

/** A convenience, so a failure is logged and nothing else: Claude's work goes on regardless. */
export async function showBrowser(
  browser: BrowserChoice,
  run: RunScript = runPowerShell
): Promise<void> {
  let code: number | null
  try {
    code = await run(showBrowserScript(browser))
  } catch (error: unknown) {
    log.warn('Could not start PowerShell:', error instanceof Error ? error.message : String(error))
    return
  }
  if (code === 0) log.info(`Showed the browser (${browser})`)
  else if (code === EXIT_NOT_RUNNING) log.info(`Could not show the browser: ${browser} isn't open`)
  else if (code === EXIT_NO_WINDOW) log.info(`Could not show the browser: ${browser} has no window`)
  else if (code === EXIT_BLOCKED) log.warn('Windows did not let the browser come to the front')
  else log.warn(`Could not show the browser: PowerShell ended with ${String(code)}`)
}

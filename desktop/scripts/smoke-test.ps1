# Runs --smoke-test on a packaged build and checks the exit code and the result file.
# A GUI exe has no reliable stdout and PowerShell does not wait for one (TECH_SPEC 7.2).
param(
  [string]$Exe = 'dist/win-unpacked/VoiceUp.exe',
  [string]$Result = (Join-Path $PWD 'smoke.json')
)
$ErrorActionPreference = 'Stop'

if (Test-Path $Result) { Remove-Item $Result }
# From System32, where an app launched from Explorer starts: node-pty has a bug that only shows
# there, and it is also the hardest place for a relative path to work by accident.
$exePath = (Resolve-Path $Exe).Path
$process = Start-Process -FilePath $exePath -WorkingDirectory "$env:SystemRoot\System32" -ArgumentList "--smoke-test=`"$Result`"" -Wait -PassThru
Write-Output "Exit code: $($process.ExitCode)"
if (-not (Test-Path $Result)) { throw "Smoke test wrote no result file at $Result" }

$content = Get-Content $Result -Raw
Write-Output "Result: $content"
if ($process.ExitCode -ne 0) { throw "Smoke test exited with $($process.ExitCode)" }
$parsed = ConvertFrom-Json $content
if ($parsed.app -ne 'ok' -or $parsed.renderer -ne 'ok' -or $parsed.pty -ne 'ok' -or $parsed.speech -ne 'ok' -or $parsed.models -ne 'ok') { throw 'Smoke test did not report app, renderer, pty, speech and models ok' }
Write-Output 'Smoke test passed'

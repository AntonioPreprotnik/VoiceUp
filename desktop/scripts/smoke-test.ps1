# Runs --smoke-test on a packaged build and checks the exit code and the result file.
# A GUI exe has no reliable stdout and PowerShell does not wait for one (TECH_SPEC 7.2).
param(
  [string]$Exe = 'dist/win-unpacked/VoiceUp.exe',
  [string]$Result = (Join-Path $PWD 'smoke.json')
)
$ErrorActionPreference = 'Stop'

if (Test-Path $Result) { Remove-Item $Result }
$process = Start-Process -FilePath $Exe -ArgumentList "--smoke-test=`"$Result`"" -Wait -PassThru
Write-Output "Exit code: $($process.ExitCode)"
if (-not (Test-Path $Result)) { throw "Smoke test wrote no result file at $Result" }

$content = Get-Content $Result -Raw
Write-Output "Result: $content"
if ($process.ExitCode -ne 0) { throw "Smoke test exited with $($process.ExitCode)" }
if ((ConvertFrom-Json $content).app -ne 'ok') { throw 'Smoke test did not report app=ok' }
Write-Output 'Smoke test passed'

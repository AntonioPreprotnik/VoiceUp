# Packages the spike and runs it. Usage from spikes/S0.6:
#   ./run-variant.ps1 -Label a -Rebuild false [-Dll]
param(
  [Parameter(Mandatory)][string]$Label,
  [ValidateSet('true', 'false')][string]$Rebuild = 'false',
  [switch]$Dll,
  [switch]$RunAsNodeOn,
  [switch]$NoListener
)
$out = "dist-$Label"
if (Test-Path $out) { Remove-Item $out -Recurse -Force }

$extra = @()
if ($RunAsNodeOn) { $extra += '-c.electronFuses.runAsNode=true' }

$builderArgs = @(
  'electron-builder', '--win', '--dir', '--publish', 'never',
  "-c.npmRebuild=$Rebuild", "-c.directories.output=$out"
) + $extra
$builder = Start-Process -FilePath 'npx.cmd' -NoNewWindow -Wait -PassThru -RedirectStandardOutput "$out.builder.log" -RedirectStandardError "$out.builder.err" -ArgumentList $builderArgs
Write-Output "[$Label] npmRebuild=$Rebuild dll=$Dll builder exit: $($builder.ExitCode)"
if ($builder.ExitCode -ne 0) {
  Get-Content "$out.builder.log", "$out.builder.err" | Select-Object -Last 25
  exit 1
}

$unpacked = "$out/win-unpacked/resources/app.asar.unpacked/node_modules/node-pty"
$built = @(Get-ChildItem "$unpacked/build/Release/*.node" -ErrorAction SilentlyContinue).Name -join ', '
$prebuilt = @(Get-ChildItem "$unpacked/prebuilds/win32-x64/*.node" -ErrorAction SilentlyContinue).Name -join ', '
$sizeMb = [math]::Round((Get-ChildItem "$unpacked" -Recurse -File | Measure-Object Length -Sum).Sum / 1MB, 1)
Write-Output "[$Label] build/Release: [$built]; prebuilds: [$prebuilt]; unpacked node-pty: $sizeMb MB"

$result = Join-Path $PWD "result-$Label.json"
$runArgs = @("--result=`"$result`"")
if ($Dll) { $runArgs += '--dll' }
if ($NoListener) { $runArgs += '--no-listener' }
$app = Start-Process -FilePath "$out/win-unpacked/S06Spike.exe" -ArgumentList $runArgs -Wait -PassThru
Write-Output "[$Label] app exit: $($app.ExitCode)"
if (Test-Path $result) { Get-Content $result -Raw } else { Write-Output "[$Label] NO RESULT FILE" }
exit $app.ExitCode

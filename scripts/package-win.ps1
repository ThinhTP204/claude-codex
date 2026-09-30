# Build release\win\AgentDesk (portable), release\AgentDesk-<version>-win-x64.zip and, when Inno Setup
# is installed, release\AgentDesk-<version>-win-x64-setup.exe. Run on Windows (GitHub Actions does it).
#   $env:NODE_BIN  path of the node.exe to bundle (default: the one on PATH, >= 23.6)
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root
$Version = (node -p "require('./package.json').version").Trim()
$Node = if ($env:NODE_BIN) { $env:NODE_BIN } else { (Get-Command node).Source }
$Out = Join-Path $Root 'release'
$App = Join-Path $Out 'win\AgentDesk'
Write-Host "> AgentDesk $Version (win-x64), Node $(& $Node -v)"
if (Test-Path $App) { Remove-Item -Recurse -Force $App }
New-Item -ItemType Directory -Force -Path (Join-Path $App 'app\node_modules') | Out-Null

Write-Host '> build giao dien'
npx vite build | Out-Null

Write-Host '> Node + code app'
Copy-Item $Node (Join-Path $App 'node.exe')
foreach ($d in 'bin', 'server', 'shared', 'dist') { Copy-Item -Recurse $d (Join-Path $App "app\$d") }
Copy-Item package.json, LICENSE (Join-Path $App 'app')
Copy-Item -Recurse node_modules\ws (Join-Path $App 'app\node_modules\ws')
Copy-Item native\AgentDesk.ico (Join-Path $App 'AgentDesk.ico')

Write-Host '> AgentDesk.exe'
$csc = Get-ChildItem "$env:WINDIR\Microsoft.NET\Framework64\v4*\csc.exe" | Select-Object -Last 1
& $csc.FullName /nologo /target:winexe /optimize "/win32icon:native\AgentDesk.ico" "/out:$App\AgentDesk.exe" /r:System.Windows.Forms.dll native\AgentDeskLauncher.cs
if ($LASTEXITCODE -ne 0) { throw 'csc failed' }

Write-Host '> zip'
$Zip = Join-Path $Out "AgentDesk-$Version-win-x64.zip"
if (Test-Path $Zip) { Remove-Item $Zip }
Compress-Archive -Path $App -DestinationPath $Zip
Write-Host "OK $Zip"

$iscc = @("${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe", "$env:ProgramFiles\Inno Setup 6\ISCC.exe") | Where-Object { Test-Path $_ } | Select-Object -First 1
if ($iscc) {
  Write-Host '> bo cai (Inno Setup)'
  & $iscc /Q "/DAppVersion=$Version" "/DSourceDir=$App" "/DOutDir=$Out" scripts\agentdesk.iss
  if ($LASTEXITCODE -ne 0) { throw 'ISCC failed' }
  Write-Host "OK $Out\AgentDesk-$Version-win-x64-setup.exe"
} else {
  Write-Host 'Khong co Inno Setup: bo qua file cai dat, chi co ban zip.'
}

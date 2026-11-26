param([ValidateSet('','orbit','multcloud','both','1','2','3')][string]$Mode='',[switch]$InstallOnly)
$ErrorActionPreference='Stop'
$base=Join-Path $env:LOCALAPPDATA 'OrbitCompanion'
$src=Join-Path $base 'orbit-player'
New-Item -ItemType Directory -Force -Path $base | Out-Null
function Refresh-Path {
  $env:Path=[Environment]::GetEnvironmentVariable('Path','Machine')+';'+[Environment]::GetEnvironmentVariable('Path','User')+';'+$env:Path
  foreach($p in @("$env:ProgramFiles\nodejs","$env:ProgramFiles\Git\cmd","$env:LOCALAPPDATA\Microsoft\WinGet\Links")){if(Test-Path $p){$env:Path+=";$p"}}
}
function Require-Exit([string]$Message){if($LASTEXITCODE -ne 0){throw $Message}}
function Install-Package([string]$Id){
  if(-not(Get-Command winget.exe -ErrorAction SilentlyContinue)){throw 'WinGet unavailable; install dependencies manually and rerun.'}
  & winget.exe install --exact --id $Id --accept-package-agreements --accept-source-agreements --disable-interactivity
  if($LASTEXITCODE -ne 0){Write-Warning "WinGet returned $LASTEXITCODE for $Id; verifying installation."}
  Refresh-Path
}
Refresh-Path
if(-not(Get-Command git.exe -ErrorAction SilentlyContinue)){Install-Package 'Git.Git'}
$nodeOk=$false
if(Get-Command node.exe -ErrorAction SilentlyContinue){& node.exe -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)';$nodeOk=($LASTEXITCODE -eq 0)}
if(-not $nodeOk){Install-Package 'OpenJS.NodeJS.LTS'}
if(-not(Get-Command ffmpeg.exe -ErrorAction SilentlyContinue)){try{Install-Package 'Gyan.FFmpeg'}catch{Write-Warning 'FFmpeg unavailable; direct playback only.'}}
Refresh-Path
& node.exe -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)'
Require-Exit 'Node 22+ is required. Restart PowerShell after installation if necessary.'
if(-not(Get-Command npm.cmd -ErrorAction SilentlyContinue)){throw 'npm not available.'}
if(Test-Path (Join-Path $src '.git')){
  $remote=& git.exe -C $src remote get-url origin
  if($remote -ne 'https://github.com/mickyd124/orbit-player.git'){throw 'Unexpected Git remote.'}
  & git.exe -C $src diff --quiet
  Require-Exit 'Back up local changes before updating.'
  & git.exe -C $src diff --cached --quiet
  Require-Exit 'Back up staged changes before updating.'
  & git.exe -C $src fetch --depth=1 origin main
  Require-Exit 'Fetch failed.'
  & git.exe -C $src checkout --detach FETCH_HEAD
  Require-Exit 'Checkout failed.'
}else{
  if(Test-Path $src){throw 'Existing non-Git directory.'}
  & git.exe clone --depth=1 https://github.com/mickyd124/orbit-player.git $src
  Require-Exit 'Clone failed.'
}
Push-Location $src
try{
  & npm.cmd ci --omit=dev --no-audit --no-fund
  if($LASTEXITCODE -ne 0){
    Write-Warning 'Native dependencies failed; retrying cloud-only mode.'
    & npm.cmd ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
    Require-Exit 'npm install failed.'
    New-Item -ItemType File -Force (Join-Path $base 'cloud-only') | Out-Null
  }else{Remove-Item (Join-Path $base 'cloud-only') -ErrorAction SilentlyContinue}
  & npm.cmd run vendor
  Require-Exit 'Browser asset preparation failed.'
}finally{Pop-Location}
@'
@echo off
node "%~dp0orbit-player\scripts\companion-launch.mjs" %*
pause
'@ | Set-Content -Encoding ASCII (Join-Path $base 'Start-Companion.cmd')
Write-Host "Restart: $base\Start-Companion.cmd"
Write-Host 'If Windows Firewall prompts, allow private networks only. Never forward port 3000.'
if(-not $InstallOnly){
  if($Mode){& node.exe (Join-Path $src 'scripts\companion-launch.mjs') $Mode}else{& node.exe (Join-Path $src 'scripts\companion-launch.mjs')}
  Require-Exit 'Companion exited with an error.'
}

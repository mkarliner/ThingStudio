# SPDX-License-Identifier: Apache-2.0
# Tests for packaging/install.ps1 that run on any OS with PowerShell 7 (pwsh), so CI's Linux job can run
# them. The real install, uninstall and PATH handling on Windows are covered by the Windows installer test in
# .github/workflows/release.yml; here the two Windows-only steps (the platform check and running the
# installed command) and the registry PATH are replaced with stand-ins, and everything else runs for real
# against fake releases in a temporary folder.
#
#   pwsh -NoProfile -File packaging/test/install-ps1.tests.ps1
#
# No Pester, so it runs on a stock pwsh. Exit status 0 = pass; each failure is named.

$ErrorActionPreference = 'Stop'
$script:failures = 0

function Check([string]$What, [bool]$Ok) {
    if ($Ok) { Write-Host "ok   $What" } else { Write-Host "FAIL $What" -ForegroundColor Red; $script:failures++ }
}

function Throws([scriptblock]$Block, [string]$Like) {
    try { & $Block; return $false } catch { return ($_.Exception.Message -like $Like) }
}

$env:THINGSTUDIO_INSTALL_LIBRARY = '1'
. (Join-Path $PSScriptRoot '..' 'install.ps1')
Remove-Item Env:THINGSTUDIO_INSTALL_LIBRARY

# Stand-ins for the Windows-only parts.
function Assert-Platform { }
function Test-InstalledCommand([string]$Shim) { return (Test-Path -LiteralPath $Shim) }
$script:fakeUserPath = 'C:\Windows;%USERPROFILE%\tools'
function Get-UserPathRaw { return $script:fakeUserPath }
function Set-UserPathRaw([string]$Value) { $script:fakeUserPath = $Value }

$root = Join-Path ([IO.Path]::GetTempPath()) ('ts-install-test-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $root | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem

function New-FakeRelease([string]$Version, [switch]$NoLauncher, [switch]$BadHash) {
    # A release folder holding one Windows bundle and its SHA256SUMS, as release.yml publishes them.
    $name = "thingstudio-$Version-windows-x86_64"
    $dir = Join-Path $root "release-$Version"
    $stage = Join-Path $dir 'stage'
    New-Item -ItemType Directory -Force -Path (Join-Path $stage "$name\python") | Out-Null
    if (-not $NoLauncher) { Set-Content -LiteralPath (Join-Path $stage "$name\thingstudio.cmd") -Value "@echo off`r`nrem $Version" }
    Set-Content -LiteralPath (Join-Path $stage "$name\python\python.exe") -Value 'not really'
    $zip = Join-Path $dir "$name.zip"
    [IO.Compression.ZipFile]::CreateFromDirectory($stage, $zip)
    Remove-Item -LiteralPath $stage -Recurse
    $hash = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    if ($BadHash) { $hash = '0' * 64 }
    Set-Content -LiteralPath (Join-Path $dir 'SHA256SUMS') -Value @("$hash  $name.zip", "$('1' * 64)  install.sh", "$('2' * 64)  thingstudio-$Version-linux-x86_64.tar.gz")
    return $dir
}

function Install-From([string]$Dir, [string]$Version) {
    $env:THINGSTUDIO_DOWNLOAD_BASE = $Dir
    $env:THINGSTUDIO_VERSION = "v$Version"
    try { return (Invoke-ThingstudioInstaller $false) } finally {
        Remove-Item Env:THINGSTUDIO_DOWNLOAD_BASE, Env:THINGSTUDIO_VERSION -ErrorAction SilentlyContinue
    }
}

try {
    $env:THINGSTUDIO_HOME = Join-Path $root 'home'
    $bin = Join-Path $env:THINGSTUDIO_HOME 'bin'
    $shim = Join-Path $bin 'thingstudio.cmd'
    $versions = Join-Path $env:THINGSTUDIO_HOME 'versions'

    # -- pure helpers --
    $sumsFile = Join-Path $root 'sums'
    Set-Content -LiteralPath $sumsFile -Value @("$('a' * 64)  thingstudio-1.2.3-windows-x86_64.zip", "$('B' * 64) *install.ps1", 'garbage line')
    $sums = Read-Checksums $sumsFile
    Check 'Read-Checksums reads both sha256sum formats and lowercases' ($sums['install.ps1'] -eq ('b' * 64) -and $sums.Count -eq 2)
    Check 'Find-BundleName finds the latest bundle without a version' ((Find-BundleName $sums '') -eq 'thingstudio-1.2.3-windows-x86_64')
    Check 'Find-BundleName uses a given version' ((Find-BundleName $sums 'v1.2.3') -eq 'thingstudio-1.2.3-windows-x86_64')
    Check 'Find-BundleName refuses a version the release lacks' (Throws { Find-BundleName $sums 'v9.9.9' } '*isn''t listed*')
    Check 'Add-PathDir appends once' ((Add-PathDir 'C:\a;C:\b' 'C:\t\bin') -eq 'C:\a;C:\b;C:\t\bin' -and (Add-PathDir 'C:\a;C:\T\bin\' 'C:\t\bin') -eq 'C:\a;C:\T\bin\')
    Check 'Remove-PathDir removes only that entry, keeping %VARS%' ((Remove-PathDir '%USERPROFILE%\x;C:\t\bin;C:\b' 'C:\t\bin') -eq '%USERPROFILE%\x;C:\b')
    Check 'Get-ShimText runs the launcher with all arguments, CRLF endings' ((Get-ShimText 'C:\v\thingstudio.cmd') -eq "@echo off`r`nrem Thingstudio command, written by install.ps1. Runs the installed version.`r`n`"C:\v\thingstudio.cmd`" %*`r`n")

    # -- install, upgrade, prune --
    $r1 = New-FakeRelease '0.9.1'
    Check 'fresh install succeeds' (Install-From $r1 '0.9.1')
    Check 'shim points at 0.9.1' ((Get-Content -LiteralPath $shim -Raw) -like '*versions?thingstudio-0.9.1-windows-x86_64?thingstudio.cmd*')
    Check 'bin added to the user PATH, existing entries kept unexpanded' ($script:fakeUserPath -eq "C:\Windows;%USERPROFILE%\tools;$bin")
    Check 'no download folder left behind' (@(Get-ChildItem -LiteralPath $env:THINGSTUDIO_HOME -Force -Filter '.download-*').Count -eq 0)

    Check 'reinstalling the same version succeeds' (Install-From $r1 '0.9.1')
    Check 'PATH not added twice' ($script:fakeUserPath -eq "C:\Windows;%USERPROFILE%\tools;$bin")

    $r2 = New-FakeRelease '0.9.2'
    $r3 = New-FakeRelease '0.9.3'
    Check 'upgrade to 0.9.2' (Install-From $r2 '0.9.2')
    Check 'upgrade to 0.9.3' (Install-From $r3 '0.9.3')
    $kept = @(Get-ChildItem -LiteralPath $versions -Directory | ForEach-Object Name | Sort-Object)
    Check 'keeps the new version and the one it replaced, removes older' (($kept -join ',') -eq 'thingstudio-0.9.2-windows-x86_64,thingstudio-0.9.3-windows-x86_64')
    Check 'shim points at 0.9.3' ((Get-Content -LiteralPath $shim -Raw) -like '*thingstudio-0.9.3-windows-x86_64*')

    # -- failures leave the working install alone --
    $bad = New-FakeRelease '0.9.4' -BadHash
    Check 'a tampered bundle is refused' (-not (Install-From $bad '0.9.4'))
    Check '...and nothing of it is installed' (-not (Test-Path -LiteralPath (Join-Path $versions 'thingstudio-0.9.4-windows-x86_64')))
    Check '...and the shim still points at 0.9.3' ((Get-Content -LiteralPath $shim -Raw) -like '*thingstudio-0.9.3-windows-x86_64*')
    $nolaunch = New-FakeRelease '0.9.5' -NoLauncher
    Check 'a bundle without a launcher is refused' (-not (Install-From $nolaunch '0.9.5'))
    Check 'a missing release is refused' (-not (Install-From (Join-Path $root 'nowhere') '0.9.6'))
    Check 'no download folders left after failures' (@(Get-ChildItem -LiteralPath $env:THINGSTUDIO_HOME -Force -Filter '.download-*').Count -eq 0)
    $env:THINGSTUDIO_DOWNLOAD_BASE = $r3
    Check 'a download folder without a version is refused' (-not (Invoke-ThingstudioInstaller $false))
    Remove-Item Env:THINGSTUDIO_DOWNLOAD_BASE

    # -- uninstall --
    Check 'uninstall succeeds' (Invoke-ThingstudioInstaller $true)
    Check '...and removes the install folder' (-not (Test-Path -LiteralPath $env:THINGSTUDIO_HOME))
    Check 'uninstall with nothing installed still succeeds' (Invoke-ThingstudioInstaller $true)

    # -- as the one-liner and as a file --
    # Piped into iex (as `irm | iex` does), a failure must not exit the caller's session.
    $script = Get-Content -LiteralPath (Join-Path $PSScriptRoot '..' 'install.ps1') -Raw
    $env:THINGSTUDIO_HOME = Join-Path $root 'iex-home'
    $out = & pwsh -NoProfile -Command "`$env:OS=''; Invoke-Expression ([IO.File]::ReadAllText('$(Join-Path $PSScriptRoot '..' 'install.ps1')')); 'still here'" 2>&1 | Out-String
    Check 'piped into iex on a non-Windows OS: one clear message, session not closed' ($out -like '*Thingstudio install failed: this installer is for Windows*' -and $out -like '*still here*')
    & pwsh -NoProfile -File (Join-Path $PSScriptRoot '..' 'install.ps1') *> $null
    Check 'run as a file, a failure sets exit code 1' ($LASTEXITCODE -eq 1)
    $out = & pwsh -NoProfile -File (Join-Path $PSScriptRoot '..' 'install.ps1') -Uninstall 2>&1 | Out-String
    Check 'run as a file, -Uninstall is recognised' ($out -like '*Nothing removed*')
    $out = & pwsh -NoProfile -Command "& ([scriptblock]::Create([IO.File]::ReadAllText('$(Join-Path $PSScriptRoot '..' 'install.ps1')'))) -Uninstall" 2>&1 | Out-String
    Check 'the documented scriptblock form passes -Uninstall' ($out -like '*Nothing removed*')
} finally {
    Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    Remove-Item Env:THINGSTUDIO_HOME -ErrorAction SilentlyContinue
}

if ($script:failures -gt 0) { Write-Host "$($script:failures) check(s) failed" -ForegroundColor Red; exit 1 }
Write-Host 'all checks passed'

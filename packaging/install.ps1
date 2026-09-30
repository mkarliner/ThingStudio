# SPDX-License-Identifier: Apache-2.0
# Thingstudio installer for Windows (packaging/install.ps1), the counterpart of install.sh. In PowerShell:
#
#   irm https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1 | iex
#
# Downloads the Windows bundle from a GitHub release, checks it against the release's SHA256SUMS, unpacks
# it under %LOCALAPPDATA%\Thingstudio\versions, and puts a `thingstudio` command in
# %LOCALAPPDATA%\Thingstudio\bin, which it adds to your user PATH. Rerunning it upgrades; the previous
# version is kept for one upgrade, as install.sh does. No administrator rights needed. Never touches
# %USERPROFILE%\.thingstudio (your flows and settings).
#
# To remove the program (keeps %USERPROFILE%\.thingstudio):
#
#   & ([scriptblock]::Create((irm https://github.com/mkarliner/ThingStudio/releases/latest/download/install.ps1))) -Uninstall
#
# or, from a copy of this file, `powershell -ExecutionPolicy Bypass -File install.ps1 -Uninstall`.
#
# Environment overrides: THINGSTUDIO_VERSION (e.g. v0.1.2; default: latest release), THINGSTUDIO_HOME
# (install folder), THINGSTUDIO_DOWNLOAD_BASE (a release download URL, or a local folder holding the
# release files; for testing), THINGSTUDIO_INSTALL_LIBRARY=1 (define the functions only; for tests).
#
# Runs under Windows PowerShell 5.1 (preinstalled on Windows 10 and 11) and PowerShell 7. Never calls
# `exit` when piped into iex, which would close the user's window. Everything runs from the last lines,
# so a download cut off halfway runs nothing.

$ThingstudioRepo = 'mkarliner/ThingStudio'
$ThingstudioPlatform = 'windows-x86_64'
# Captured here: inside a function, $args is that function's own.
$ThingstudioUninstall = ($args -contains '-Uninstall') -or ($env:THINGSTUDIO_UNINSTALL -eq '1')

function Say([string]$Text) { Write-Host $Text }

function Fail([string]$Text) { throw [System.Exception]::new("Thingstudio install failed: $Text") }

function Get-InstallHome {
    if ($env:THINGSTUDIO_HOME) { return $env:THINGSTUDIO_HOME }
    if (-not $env:LOCALAPPDATA) { Fail 'LOCALAPPDATA is not set, so there is nowhere to install.' }
    return (Join-Path $env:LOCALAPPDATA 'Thingstudio')
}

function Assert-Platform {
    if ($env:OS -ne 'Windows_NT') {
        Fail 'this installer is for Windows. On macOS and Linux use: curl -fsSL https://github.com/mkarliner/ThingStudio/releases/latest/download/install.sh | sh'
    }
    # PROCESSOR_ARCHITEW6432 is set when 32-bit PowerShell runs on 64-bit Windows.
    $arch = $env:PROCESSOR_ARCHITEW6432
    if (-not $arch) { $arch = $env:PROCESSOR_ARCHITECTURE }
    if ($arch -ne 'AMD64') {
        Fail "there is no Thingstudio build for Windows on $arch yet, only for x64 (AMD64). See https://github.com/$ThingstudioRepo/releases"
    }
}

function Get-ReleaseFile([string]$Base, [string]$Name, [string]$OutFile, [string]$What) {
    # $Base is an http(s) URL or a local folder (tests).
    try {
        if ($Base -match '^https?://') {
            Invoke-WebRequest -Uri "$Base/$Name" -OutFile $OutFile -UseBasicParsing
        } else {
            Copy-Item -LiteralPath (Join-Path $Base $Name) -Destination $OutFile
        }
    } catch {
        Fail "$What ($Base/$Name): $($_.Exception.Message)"
    }
}

function Read-Checksums([string]$Path) {
    # sha256sum's format: "<hash>  <file>", or "<hash> *<file>" in binary mode. Returns file -> lowercase hash.
    $sums = @{}
    foreach ($line in Get-Content -LiteralPath $Path) {
        if ($line -match '^([0-9a-fA-F]{64})\s+\*?(\S+)\s*$') { $sums[$Matches[2]] = $Matches[1].ToLower() }
    }
    return $sums
}

function Find-BundleName($Sums, [string]$Version) {
    # With a version: its bundle name. Without (latest): the one Windows bundle SHA256SUMS lists, so no
    # GitHub API call or redirect handling is needed to learn the latest version.
    if ($Version) {
        $name = "thingstudio-$($Version.TrimStart('v'))-$ThingstudioPlatform"
        if (-not $Sums.ContainsKey("$name.zip")) { Fail "$name.zip isn't listed in the release's SHA256SUMS." }
        return $name
    }
    $found = @($Sums.Keys | Where-Object { $_ -match "^thingstudio-.+-$ThingstudioPlatform\.zip$" })
    if ($found.Count -ne 1) {
        Fail "expected one Windows bundle in the release's SHA256SUMS, found $($found.Count). See https://github.com/$ThingstudioRepo/releases"
    }
    return $found[0] -replace '\.zip$', ''
}

function Get-ShimText([string]$Launcher) {
    # A small .cmd in bin that runs the chosen version's own launcher. Rewritten on each upgrade, so bin
    # never needs to change and no link (which needs administrator rights on Windows) is needed.
    return "@echo off`r`nrem Thingstudio command, written by install.ps1. Runs the installed version.`r`n`"$Launcher`" %*`r`n"
}

function Test-InstalledCommand([string]$Shim) {
    & $Shim --help *> $null
    return ($LASTEXITCODE -eq 0)
}

# -- user PATH -----------------------------------------------------------------------------------------
# Read and written as the raw registry value, so entries like %USERPROFILE%\bin stay unexpanded
# ([Environment]::SetEnvironmentVariable would expand them and store a plain string).

function Get-UserPathRaw {
    $key = Get-Item -LiteralPath 'HKCU:\Environment'
    return [string]$key.GetValue('Path', '', [Microsoft.Win32.RegistryValueOptions]::DoNotExpandEnvironmentNames)
}

function Set-UserPathRaw([string]$Value) {
    Set-ItemProperty -LiteralPath 'HKCU:\Environment' -Name 'Path' -Value $Value -Type ExpandString
    # Tell Explorer the environment changed, so terminals opened from now on see it: setting any user
    # variable through .NET broadcasts WM_SETTINGCHANGE.
    [Environment]::SetEnvironmentVariable('THINGSTUDIO_PATH_UPDATED', '1', 'User')
    [Environment]::SetEnvironmentVariable('THINGSTUDIO_PATH_UPDATED', $null, 'User')
}

function Get-PathEntries([string]$PathValue) {
    return @($PathValue -split ';' | Where-Object { $_ -ne '' })
}

function Test-PathHasDir([string]$PathValue, [string]$Dir) {
    $want = $Dir.TrimEnd('\')
    foreach ($entry in Get-PathEntries $PathValue) {
        if ([Environment]::ExpandEnvironmentVariables($entry).TrimEnd('\') -ieq $want) { return $true }
    }
    return $false
}

function Add-PathDir([string]$PathValue, [string]$Dir) {
    if (Test-PathHasDir $PathValue $Dir) { return $PathValue }
    return ((@(Get-PathEntries $PathValue) + $Dir) -join ';')
}

function Remove-PathDir([string]$PathValue, [string]$Dir) {
    $want = $Dir.TrimEnd('\')
    $kept = Get-PathEntries $PathValue | Where-Object { [Environment]::ExpandEnvironmentVariables($_).TrimEnd('\') -ine $want }
    return (@($kept) -join ';')
}

# -- install and uninstall -----------------------------------------------------------------------------

function Install-Thingstudio {
    Assert-Platform
    $homeDir = Get-InstallHome
    $binDir = Join-Path $homeDir 'bin'
    $version = $env:THINGSTUDIO_VERSION
    if ($env:THINGSTUDIO_DOWNLOAD_BASE) {
        if (-not $version) { Fail 'THINGSTUDIO_DOWNLOAD_BASE needs THINGSTUDIO_VERSION set too.' }
        $base = $env:THINGSTUDIO_DOWNLOAD_BASE.TrimEnd('/', '\')
    } elseif ($version) {
        $base = "https://github.com/$ThingstudioRepo/releases/download/$version"
    } else {
        $base = "https://github.com/$ThingstudioRepo/releases/latest/download"
    }

    New-Item -ItemType Directory -Force -Path $homeDir | Out-Null
    $tmp = Join-Path $homeDir ('.download-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Get-ReleaseFile $base 'SHA256SUMS' (Join-Path $tmp 'SHA256SUMS') "couldn't download the release's SHA256SUMS. Check your internet connection, and that the release exists at https://github.com/$ThingstudioRepo/releases"
        $sums = Read-Checksums (Join-Path $tmp 'SHA256SUMS')
        $name = Find-BundleName $sums $version
        $archive = "$name.zip"
        Say "Installing $name"
        Get-ReleaseFile $base $archive (Join-Path $tmp $archive) "couldn't download $archive"
        $got = (Get-FileHash -LiteralPath (Join-Path $tmp $archive) -Algorithm SHA256).Hash.ToLower()
        if ($got -ne $sums[$archive]) {
            Fail "$archive is corrupt or has been altered (SHA-256 $got, expected $($sums[$archive])). Nothing was installed."
        }

        Add-Type -AssemblyName System.IO.Compression.FileSystem
        try {
            [System.IO.Compression.ZipFile]::ExtractToDirectory((Join-Path $tmp $archive), $tmp)
        } catch {
            Fail "couldn't unpack $archive`: $($_.Exception.Message)"
        }
        if (-not (Test-Path -LiteralPath (Join-Path $tmp "$name\thingstudio.cmd"))) {
            Fail "$archive doesn't contain a thingstudio.cmd launcher."
        }

        $versionsDir = Join-Path $homeDir 'versions'
        New-Item -ItemType Directory -Force -Path $versionsDir | Out-Null
        $target = Join-Path $versionsDir $name
        if (Test-Path -LiteralPath $target) {
            try {
                Remove-Item -LiteralPath $target -Recurse -Force
            } catch {
                Fail "$name is already installed and in use. Stop Thingstudio (Ctrl-C in its window), then run this again."
            }
        }
        Move-Item -LiteralPath (Join-Path $tmp $name) -Destination $target

        # Point the command at the new version: write the new shim beside the old one, then swap it in.
        New-Item -ItemType Directory -Force -Path $binDir | Out-Null
        $shim = Join-Path $binDir 'thingstudio.cmd'
        $previous = $null
        if (Test-Path -LiteralPath $shim) {
            $old = Get-Content -LiteralPath $shim -Raw
            if ($old -match '[\\/]versions[\\/]([^\\/]+)[\\/]thingstudio\.cmd') { $previous = $Matches[1] }
        }
        $launcher = Join-Path $target 'thingstudio.cmd'
        [IO.File]::WriteAllText("$shim.new", (Get-ShimText $launcher), [Text.Encoding]::ASCII)
        Move-Item -LiteralPath "$shim.new" -Destination $shim -Force

        # Keep the new version and the one it replaced; remove anything older. A version still running
        # can't be deleted; it's left for the next upgrade.
        foreach ($dir in Get-ChildItem -LiteralPath $versionsDir -Directory) {
            if ($dir.Name -ne $name -and $dir.Name -ne $previous) {
                try { Remove-Item -LiteralPath $dir.FullName -Recurse -Force } catch { }
            }
        }

        if (-not (Test-InstalledCommand $shim)) { Fail "the installed copy doesn't start. Run `"$shim`" --help to see why." }

        # This window first, so `thingstudio` works straight away; then the user PATH, for new windows.
        if (-not (Test-PathHasDir $env:Path $binDir)) { $env:Path = "$env:Path;$binDir" }
        $pathNote = $null
        try {
            $userPath = Get-UserPathRaw
            if (-not (Test-PathHasDir $userPath $binDir)) { Set-UserPathRaw (Add-PathDir $userPath $binDir) }
        } catch {
            $pathNote = "Couldn't add $binDir to your PATH ($($_.Exception.Message)). Start Thingstudio with: `"$shim`""
        }

        Say "Installed to $target"
        if ($pathNote) { Say $pathNote }
        Say ''
        Say 'Start it with: thingstudio'
        Say 'Stop it with Ctrl-C. Run this installer again to upgrade.'
        Say 'Docs: https://docs.thingstudio.net/'
    } finally {
        Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

function Uninstall-Thingstudio {
    $homeDir = Get-InstallHome
    $binDir = Join-Path $homeDir 'bin'
    $removed = @()
    if ($env:OS -eq 'Windows_NT') {
        $userPath = Get-UserPathRaw
        if (Test-PathHasDir $userPath $binDir) {
            Set-UserPathRaw (Remove-PathDir $userPath $binDir)
            $removed += "$binDir from your PATH"
        }
    }
    if (Test-Path -LiteralPath $homeDir) {
        try {
            Remove-Item -LiteralPath $homeDir -Recurse -Force
        } catch {
            Fail "couldn't remove $homeDir, probably because Thingstudio is still running. Stop it (Ctrl-C in its window), then run this again."
        }
        $removed += $homeDir
    }
    if ($removed.Count -eq 0) {
        Say "Thingstudio isn't installed in $homeDir. Nothing removed."
    } else {
        Say ('Removed: ' + ($removed -join ', '))
    }
    Say 'Your flows and settings in %USERPROFILE%\.thingstudio were left alone. Delete that folder yourself if you want them gone.'
}

function Invoke-ThingstudioInstaller([bool]$Uninstall) {
    # Returns $true on success. Errors are printed, never thrown out of here, so `irm | iex` shows one
    # clear line instead of a PowerShell stack trace.
    $oldProgress = $ProgressPreference
    $oldErrors = $ErrorActionPreference
    $ProgressPreference = 'SilentlyContinue'  # Windows PowerShell 5.1's progress bar makes downloads crawl
    $ErrorActionPreference = 'Stop'
    try {
        # Windows PowerShell 5.1 may default to TLS 1.0, which github.com refuses.
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        if ($Uninstall) { Uninstall-Thingstudio } else { Install-Thingstudio }
        return $true
    } catch {
        $message = $_.Exception.Message
        if ($message -notlike 'Thingstudio install failed:*') { $message = "Thingstudio install failed: $message" }
        Write-Host $message -ForegroundColor Red
        return $false
    } finally {
        $ProgressPreference = $oldProgress
        $ErrorActionPreference = $oldErrors
    }
}

if ($env:THINGSTUDIO_INSTALL_LIBRARY -ne '1') {
    $ThingstudioOk = Invoke-ThingstudioInstaller $ThingstudioUninstall
    # Run as a file (`-File install.ps1`): report failure in the exit code. Piped into iex: no exit, which
    # would close the user's PowerShell window.
    if ($PSCommandPath -and -not $ThingstudioOk) { exit 1 }
}

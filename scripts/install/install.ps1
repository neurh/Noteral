# Noteral installer for Windows.
#
#   irm https://github.com/neurh/Noteral/releases/latest/download/install.ps1 | iex
#
# Environment variables:
#   NOTERAL_VERSION=vX.Y.Z   install a specific release (default: latest)
#   NOTERAL_UNINSTALL=1      remove Noteral (your notes are kept)
#
# Installs for the current user, without admin rights, into
# %LOCALAPPDATA%\Programs\Noteral, with Start menu and desktop shortcuts.
# Noteral uses Microsoft Edge WebView2, which Windows 10 and 11 already include.

$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Install-Noteral {
    $repo = 'neurh/Noteral'
    $version = if ($env:NOTERAL_VERSION) { $env:NOTERAL_VERSION } else { 'latest' }
    $dir = Join-Path $env:LOCALAPPDATA 'Programs\Noteral'
    $startMenu = Join-Path ([Environment]::GetFolderPath('Programs')) 'Noteral.lnk'
    $desktop = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Noteral.lnk'
    $uninstallKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\Noteral'

    if ($env:NOTERAL_UNINSTALL) {
        Write-Host 'Removing Noteral' -ForegroundColor Cyan
        Get-Process noteral -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
        Remove-Item $startMenu, $desktop -Force -ErrorAction SilentlyContinue
        Remove-Item $uninstallKey -Recurse -Force -ErrorAction SilentlyContinue
        Write-Host '  Your notes were not touched.'
        return
    }

    $arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { 'arm64' } else { 'amd64' }
    if (-not [Environment]::Is64BitOperatingSystem) { throw 'Noteral needs 64-bit Windows 10 or later.' }
    $asset = "noteral-windows-$arch.zip"
    if ($version -eq 'latest') {
        $base = "https://github.com/$repo/releases/latest/download"
    } else {
        if (-not $version.StartsWith('v')) { $version = "v$version" }
        $base = "https://github.com/$repo/releases/download/$version"
    }

    [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
    $tmp = Join-Path ([IO.Path]::GetTempPath()) ("noteral-" + [guid]::NewGuid())
    New-Item -ItemType Directory -Path $tmp | Out-Null
    try {
        Write-Host "Downloading Noteral ($version, windows $arch)" -ForegroundColor Cyan
        $zip = Join-Path $tmp $asset
        Invoke-WebRequest -UseBasicParsing -Uri "$base/$asset" -OutFile $zip

        $sums = $null
        try { $sums = (Invoke-WebRequest -UseBasicParsing -Uri "$base/SHA256SUMS.txt").Content } catch { }
        if ($sums -is [byte[]]) { $sums = [Text.Encoding]::UTF8.GetString($sums) }
        $line = if ($sums) { ($sums -split "`n") | Where-Object { $_ -match "\s$([regex]::Escape($asset))\s*$" } | Select-Object -First 1 }
        if ($line) {
            $want = ($line -split '\s+')[0].ToLower()
            $got = (Get-FileHash -Algorithm SHA256 $zip).Hash.ToLower()
            if ($want -ne $got) { throw "Checksum mismatch for $asset. Try again, or download it from https://github.com/$repo/releases" }
            Write-Host '  checksum ok'
        }

        Get-Process noteral -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
        Expand-Archive -Path $zip -DestinationPath $tmp -Force
        if (Test-Path $dir) { Remove-Item $dir -Recurse -Force }
        New-Item -ItemType Directory -Path (Split-Path $dir) -Force | Out-Null
        Move-Item (Join-Path $tmp 'Noteral') $dir
        $exe = Join-Path $dir 'noteral.exe'

        $shell = New-Object -ComObject WScript.Shell
        foreach ($path in @($startMenu, $desktop)) {
            $link = $shell.CreateShortcut($path)
            $link.TargetPath = $exe
            $link.WorkingDirectory = $dir
            $link.Description = 'Noteral'
            $link.Save()
        }

        # Show Noteral in Settings > Apps so it can be removed from there too.
        $uninstall = "powershell -NoProfile -ExecutionPolicy Bypass -Command `"`$env:NOTERAL_UNINSTALL='1'; irm https://github.com/$repo/releases/latest/download/install.ps1 | iex`""
        New-Item -Path $uninstallKey -Force | Out-Null
        $shown = if ($version -eq 'latest') { '' } else { $version.TrimStart('v') }
        $props = @{ DisplayName = 'Noteral'; Publisher = 'Noteral'; DisplayIcon = $exe; InstallLocation = $dir; UninstallString = $uninstall; NoModify = 1; NoRepair = 1 }
        if ($shown) { $props.DisplayVersion = $shown }
        foreach ($k in $props.Keys) { Set-ItemProperty -Path $uninstallKey -Name $k -Value $props[$k] }

        Write-Host 'Noteral is installed' -ForegroundColor Green
        Write-Host "  Open it from the Start menu or the desktop shortcut."
    } finally {
        Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Install-Noteral

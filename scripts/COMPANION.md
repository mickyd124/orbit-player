# Shared companion installers

Use one device on the same trusted Wi-Fi as the TV; both apps use one token and shared cloud accounts. Select 1 Orbit, 2 MultCloud, 3 Both. Port 3000 by default.

## Android (Termux, Android 7+)
Install Termux from https://f-droid.org/packages/com.termux/ or https://github.com/termux/termux-app/releases (same source for all Termux add-ons). This is an Android server running in Termux, not a standalone APK. Android TV/Fire TV compatibility depends on device and OS. Android 5/6 are not supported. Install and run:

    pkg update && pkg install -y curl
    curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/companion-linux-android.sh -o companion-install.sh
    sh companion-install.sh

Restart: `sh ~/orbit-companion/start.sh both`. Keep Termux running, disable battery optimisation for it if needed, and stop with Ctrl+C. Android uses direct streaming plus optional FFmpeg; BitTorrent disabled because of native dependencies.

## Linux
Supports apt/dnf/pacman/apk package managers with sudo or root for packages; runs the server as the invoking account. Official Node 22 binary fallback for glibc x64/arm64/armv7 when available. Alpine needs a compatible packaged Node. Run:

    curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/companion-linux-android.sh -o companion-install.sh
    sh companion-install.sh

Restart: `sh ~/orbit-companion/start.sh both`. Allow TCP 3000 only from trusted LAN clients if firewall blocks access.

## Windows 10/11
In PowerShell:

    Invoke-WebRequest https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/companion-windows.ps1 -OutFile companion-windows.ps1
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\companion-windows.ps1

WinGet installs Node LTS, Git and optional FFmpeg. Allow private networks only if prompted. Restart with `%LOCALAPPDATA%\OrbitCompanion\Start-Companion.cmd` (double click in Explorer). If PATH was changed, reopen the shell. Execution policy bypass applies to this PowerShell process only; review the script before running.

## iPhone iSH
Use scripts/ish-install.sh; the existing iSH settings and account store remain separate.

## Connect the TV
Find your host LAN IP and enter http://HOST-IP:3000 in Orbit Settings or MultCloud TV. Enter the token printed by the server. Dashboard /companion. Credentials for optional providers go into companion-settings.json beside the cloned repository on Windows/Linux/Android (see README for key names). Google redirect http://localhost:3000/cloud/google/callback must match port. Do not share token/config or .runtime; account credentials are not encrypted at rest. No internet exposure. FFmpeg conversion and P2P depend on host and codec; desktop fallback cloud-only mode disables P2P. Installers do not automatically configure port forwarding or system startup.

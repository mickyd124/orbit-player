# Shared companion installers

Use one device on the same trusted Wi-Fi as the TV; both apps use one token and shared cloud accounts. Both apps start by default; select Orbit, MultCloud or Both in the browser dashboard. Port 3000 by default.

## Android (Termux, Android 7+)
Install Termux from https://f-droid.org/packages/com.termux/ or https://github.com/termux/termux-app/releases (same source for all Termux add-ons). This is an Android server running in Termux, not a standalone APK. Android TV/Fire TV compatibility depends on device and OS. Android 5/6 are not supported. Install and run:

    pkg update && pkg install -y curl
    curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/companion-linux-android.sh -o companion-install.sh
    sh companion-install.sh

Restart: `sh ~/orbit-companion/start.sh both`. An optional Termux:Widget shortcut named Orbit-Companion is installed in ~/.shortcuts (install the matching Termux:Widget add-on separately). Keep Termux running, disable battery optimisation for it if needed, and stop with Ctrl+C. Android uses direct streaming plus optional FFmpeg; BitTorrent disabled because of native dependencies.

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
Use scripts/ish-install.sh for the Python edition (no Node/npm). See [iSH Python guide](ISH-PYTHON.md). Original Node installer: scripts/ish-node-install.sh. Existing token and settings retained; cloud accounts not automatically migrated.

## Connect the TV
Find your host LAN IP and enter http://HOST-IP:3000 in Orbit Settings or MultCloud TV. Enter the token printed by the server. Dashboard /companion. Credentials for optional providers go into companion-settings.json beside the cloned repository on Windows/Linux/Android (see README for key names). Google redirect http://localhost:3000/cloud/google/callback must match port. Do not share token/config or .runtime; account credentials are not encrypted at rest. No internet exposure. FFmpeg conversion and P2P depend on host and codec; desktop fallback cloud-only mode disables P2P. Installers do not automatically configure port forwarding or system startup.

## Browser control centre

After installation, open **http://127.0.0.1:3000/companion** on the host or **http://HOST-IP:3000/companion** from another trusted LAN device. The desktop/Termux launcher attempts to open the browser after a successful health check; iSH requires opening Safari manually. Set ORBIT_NO_BROWSER=1 to suppress automatic browser opening. Unlock with the terminal's existing access token. No token is embedded in links or stored by the dashboard. The TV client retains its existing token storage.

Choose Orbit, MultCloud, Both or Pause both. This controls the shared server's browser entry points, not separate processes: native TV API access and existing streams are not interrupted. The choice is in memory and resets to Both at restart unless a launch argument is provided. The dashboard shows actual health, conversion count, IP addresses, cloud provider readiness, connected account names and recent mode changes. Use Manage cloud accounts to open the existing cloud library and its account authorization dialogs. OAuth client configuration remains in the host settings file; full server logs are in the terminal. Ctrl+C stops the whole server. There is no remote shell or public internet support. HTTP is unencrypted, so only use trusted Wi-Fi. iSH may suspend when switching apps; use a second device or another host for persistent service. Browser home-screen shortcuts can be added manually; this is not an offline PWA.

## Smart webOS media compatibility (1.4.0)

The existing installers install FFmpeg and FFprobe when the platform package is available. Restart after updating. Dashboard Diagnostics shows the detected decoder/encoder inventory and H.264/AAC fallback readiness. The companion probes inputs for up to 10 seconds and copies conservative H.264 8-bit progressive video up to 1080p30 and AAC-LC stereo when compatible. Other streams use H.264 Main 4.1 (up to 1080p30) / AAC-LC stereo in MPEG-TS HLS. Compatible video can remain unchanged while unsupported audio is converted. Audio-only files are now included in companion cloud browsing; supported audio-only streams can use AAC HLS. The updated TV player tries native playback first and retries once in safe mode on playback errors if a companion is configured. Smart convert starts the probed conversion immediately. Existing clients can still request conversion using the same API. Safe mode is software-based and may be slow on iSH and low-power Android hosts. Installed FFmpeg determines actual decoder support; no DRM, hardware acceleration, HDR tone mapping, subtitle conversion or all-TV compatibility guarantee. Direct MEGA without a companion and local browser-only files are not sent to the server. Conversion uses temporary HLS segments and existing session cleanup. Only use trusted LAN and media you have permission to access.

## Separate platform installers and Linux desktop manager

Android Termux: run scripts/termux-install.sh (Node, cloud-only on Android). iPhone: run scripts/iphone-install.sh in iSH (Python); Termux is not available on iOS. Windows: existing scripts/companion-windows.ps1. Linux desktop: run scripts/linux-desktop-install.sh as your normal desktop user. It installs a Tk desktop manager and existing Node companion. Start server in the GUI, add MEGA or WebDAV credentials locally, or open Cloud authorization for OAuth/QR providers; the browser may request the existing companion token. Paste a magnet or choose a local .torrent metadata file (up to 1 MiB) and start streaming. The largest supported media file is selected automatically. Once ready, on either TV client open Cloud library and select Desktop streams — refresh, then select the stream. Alternatively copy the LAN HLS link. Stop the stream from the GUI. Only use media you have permission to share; BitTorrent may upload to peers. Native torrent dependencies and FFmpeg are required; if installation falls back to cloud-only mode torrents are unavailable. No automatic service startup. Do not expose the companion to the internet.

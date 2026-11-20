# Orbit Player for LG webOS

A remote-friendly media player with direct HTTP(S), HLS, DASH, local-file playback where a file picker is available, recent history, and an optional LAN companion for BitTorrent magnets and FFmpeg conversion. Targets webOS 6+; physical TV testing is still required.

## Start on your computer

Requires Node.js 22+ and FFmpeg installed on PATH.

```sh
npm ci
npm run vendor
npm start
```

Open http://localhost:3000 to preview. On the TV, set Settings → Companion server URL to `http://YOUR-COMPUTER-LAN-IP:3000` and enter the access token printed by the server. Save, then test the connection. Set `ORBIT_TOKEN` for a persistent token. Allow inbound TCP 3000 on your private network. The companion must keep running for conversion and P2P playback.

The server listens on your LAN. Keep it on a trusted private network; do not expose it to the internet. Tokens and bearer-style media URLs use HTTP and are not encrypted. Media URLs grant temporary access to one playback session. The companion accepts authenticated HTTP sources, including LAN sources, so only share the token with trusted devices. Tokens are stored locally on the TV. Do not paste URLs containing secrets you do not want saved in recent history.

## Install on LG webOS

1. Install LG's webOS TV CLI (`ares-package`, `ares-setup-device`, `ares-install`, `ares-launch`) and the Developer Mode app on the TV. Enable Developer Mode and Key Server.
2. Run `ares-setup-device` and add your TV using LG's documented Developer Mode connection settings, then `ares-novacom --device YOUR_TV --getkey`.
3. Build and install:

```sh
npm run package:webos
# The CLI outputs the exact .ipk filename in dist/.
ares-install --device YOUR_TV dist/com.orbit.mediaplayer_1.1.0_all.ipk
ares-launch --device YOUR_TV com.orbit.mediaplayer
```

`app/` is the complete packaged web app, including locally bundled HLS/DASH libraries. The Google font is optional; system fonts work offline. A Developer Mode installation is not an LG Content Store submission. Follow LG's requirements for store distribution.

## Playback

- **Open a stream:** enter an HTTP(S) URL. HLS uses native playback when available, otherwise bundled hls.js. DASH uses bundled dash.js and requires Media Source Extensions. Sources used by JS playback engines must permit CORS.
- **Conversion:** check “Convert with companion” for formats/codecs your TV cannot play. The companion converts to H.264/AAC HLS at up to 1080p. HTTP(S) conversion is also useful for sources without browser CORS support. Embedded subtitles, multiple audio-track selection, and DRM are not implemented.
- **Peer-to-peer:** paste a BitTorrent magnet. The companion retrieves metadata, picks the largest video file, and converts it to HLS. It uses the computer's BitTorrent client; this is not a browser WebRTC-only torrent client. Peer availability, tracker access, and network configuration determine whether it can start. P2P here means BitTorrent, not Ace Stream, SopCast, or every proprietary P2P protocol. Use media you have permission to access.
- **Files:** direct device file playback uses the browser's picker and supported codecs; webOS may not expose USB browsing to web apps. For unsupported files, host the file over HTTP on your LAN and use companion conversion.
- **Remote:** directional keys navigate controls; OK selects; Back returns to the library; Play/Pause/Stop media keys control playback. Left/right seek 10 seconds during playback when duration is available. Native video controls expose volume and seeking.

There is no universal “all formats” guarantee: containers, codecs, device firmware, DRM, and stream servers all affect playback. FFmpeg expands support substantially but cannot bypass DRM. Conversion starts at the beginning; there is no source-level random seeking. HLS only seeks within media already converted. Conversion consumes CPU and disk, and torrent content is cached temporarily under `.runtime/`. Stop playback to remove its session; inactive sessions expire after 20 minutes. A crash can leave cache files; remove `.runtime/` while the server is stopped. There is no disk quota or bandwidth limiter, so monitor free space for long videos. Maximum three concurrent sessions; duplicate active torrent magnets may be rejected by the torrent engine.

## Validation

```sh
npm test
node --check app/app.js
node --check server/index.js
```

Tests cover source validation. The optional integration check is `node test/integration.mjs` after generating `/tmp/orbit-test.mp4` with FFmpeg (a five-second H.264/AAC test video). A local FFmpeg → companion → HLS integration check was also performed during development. Verify remote navigation, native decoding, MSE support, HTTP LAN access, and package installation on your actual TV before relying on it. No physical TV or real peer swarm was available in the development environment.


## Cloud library (Orbit 1.1.0)

The **Cloud library** tab brings multiple accounts into the same TV app. Add as many accounts as you like, view videos and folders across your connected cloud roots, switch between accounts, browse subfolders, filter visible entries, and play or convert files without leaving Orbit.

**The companion is required for cloud browsing, sign-in and playback.** Run it on a computer on your private network (npm ci, then npm start), connect to it from Settings on the TV, then open Cloud library → Connect an account. Your credentials and OAuth refresh tokens are held **only on the companion computer**, in the .runtime/cloud-accounts.json file with owner-only file permissions. Do not commit that file. The TV stores the companion URL and access token in localStorage, as it does for other companion features.

Supported connectors:

| Service | Setup on the companion | How you connect |
| --- | --- | --- |
| **WebDAV / Nextcloud / ownCloud** | No API registration | Enter an HTTPS WebDAV folder URL, username and an app-specific password in the TV dialog. Multiple servers and users are supported. |
| **Microsoft OneDrive personal** | Register an app in Microsoft Entra, enable **public client flows**, support personal Microsoft accounts, and set MS_CLIENT_ID | Open the verification URL and enter the code shown on TV. Requested delegated permissions: Files.Read, User.Read, offline_access. |
| **Dropbox** | Create a scoped Dropbox application with files.metadata.read, files.content.read and account_info.read; set DROPBOX_APP_KEY | Open the authorization link on a phone/computer, approve, then paste the resulting code into the TV dialog. Uses OAuth PKCE and offline refresh tokens, without embedding an app secret. |
| **Google Drive** | Enable Drive API; create a Google OAuth **Web application** client; register redirect http://localhost:3000/cloud/google/callback; set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET | Start linking on TV, then open the provided localhost URL **on the computer running the companion**. Sign in with your own Google account; the TV updates when linked. Uses read-only Drive scope. |

Example startup on macOS/Linux:

```sh
export ORBIT_TOKEN='use-a-long-unique-private-token'
export MS_CLIENT_ID='your-entra-app-client-id'
export DROPBOX_APP_KEY='your-dropbox-app-key'
export GOOGLE_CLIENT_ID='your-google-web-app-client-id'
export GOOGLE_CLIENT_SECRET='your-google-web-app-client-secret'
npm start
```

Set only the providers you need. On Windows PowerShell use the normal $env:NAME="value" form. For non-default PORT, also change the registered Google OAuth redirect URI to match that port. Provider app registrations, OAuth consent configuration and (for Google Drive's restricted read scope) Google's verification/testing rules are your responsibility; no cloud credentials or provider app registrations are included in this repository.

**Security and playback constraints:**
- Keep the companion on a trusted private network; by default the TV accesses it over unencrypted HTTP. Do **not** expose port 3000 directly to the internet. Secure a remote deployment separately with TLS and proper access controls.
- Cloud downloads are streamed through the companion with HTTP Range support for seeking. Temporary signed video URLs expire after four hours. Each video URL is a bearer capability: anyone who gets the URL can play it until expiry. Do not share these URLs.
- Direct playback relies on webOS codec/container support. If a file does not play, choose **Convert** to transcode it to H.264/AAC using FFmpeg on the companion. No DRM bypass or guaranteed support for all formats.
- The unified landing screen shows root-level entries from each account (up to one provider page per account); you can browse and paginate deeper within a selected account. Search filters the **currently loaded** items, not an entire cloud.
- WebDAV requires HTTPS by default. ORBIT_ALLOW_INSECURE_WEBDAV=1 permits HTTP only if you knowingly accept cleartext WebDAV credentials on a trusted private LAN. For Nextcloud, use an app password where available.
- Credential files are not encrypted at rest and are readable by the local operating-system account running Orbit. Protect that computer and its backups. Disconnecting an account removes its stored credentials; revoke the app's access at the provider to invalidate any issued OAuth tokens.
- Google Drive testing-mode apps may require that you explicitly add your account as a test user, and public production distribution may require Google's restricted-scope verification.
- Google OAuth callbacks must be completed in a browser on the **companion computer**. A localhost callback in a phone's browser points at the phone, not the companion.

Validate before sideloading:

```sh
npm ci
npm test
node --check server/cloud.js
node --check app/cloud.js
npm run package:webos
```

The verification workflow in .github/workflows/cloud-verify.yml builds an IPK artifact for the cloud feature. Full playback, OAuth and remote-control behavior still require testing on a physical LG TV with real cloud accounts.

## Homebrew Channel installation

In Homebrew Channel, open Settings → Add repository and enter:

https://raw.githubusercontent.com/mickyd124/orbit-player/main/apps.json

The webOS TV app requires an optional computer companion for conversion and BitTorrent playback. Physical TV testing remains outstanding.

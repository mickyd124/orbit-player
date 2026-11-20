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
ares-install --device YOUR_TV dist/com.orbit.mediaplayer_1.2.0_all.ipk
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


## Cloud library (Orbit 1.2.0 beta: direct MEGA)

The **Cloud library** tab brings multiple accounts into the same TV app. Add as many accounts as you like, view videos and folders across your connected cloud roots, switch between accounts, browse subfolders, filter visible entries, and play or convert files without leaving Orbit.

**For Google Drive, TeraBox, OneDrive, Dropbox, WebDAV and full-size MEGA videos, the companion is still required.** Run it on a computer on your private network (npm ci, then npm start), connect to it from Settings on the TV, then open Cloud library → Connect an account. Your credentials and OAuth refresh tokens are held **only on the companion computer**, in the .runtime/cloud-accounts.json file with owner-only file permissions. Do not commit that file. The TV stores the companion URL and access token in localStorage, as it does for other companion features.

### Direct MEGA on LG webOS — no PC companion (experimental)

Orbit's TV app now includes **MEGA — Direct on TV (small videos)** in Cloud library → Connect an account. You can connect a MEGA account while **Companion server URL** is empty. The browser MEGAJS library lists your folders and decrypts video on the TV; the TV player opens the decrypted file as a local Blob URL.

**Restrictions:**
- Files must be **96 MiB or smaller**. Full-length films generally exceed this size; they still need the companion for reliable streaming. Direct playback requires enough available TV memory and a codec supported by LG webOS. Orbit deliberately does not claim otherwise.
- MEGA email and password remain in the TV app's JavaScript memory for the current session and are **not persisted to localStorage**. Reconnect after restarting Orbit. Do not enter credentials on a TV you do not trust. MEGA account 2FA and API quotas may prevent sign-in.
- Only the TV app needs internet access. No separate iPhone app is required, but this mode does **not** provide iPhone QR-code login or unrestricted movie-size streaming.
- Direct playback does **not** offer FFmpeg conversion. Use **MEGA — Companion** for large movies and unsupported formats.
- The TV build bundles a local MEGAJS browser library at packaging time; no externally hosted script is required. Test on real TV hardware and with a real account before treating the feature as production-ready.

**Why not the same direct connection for Google Drive and TeraBox?**
Google's OAuth **TV device** flow presently permits `drive.file` (files opened or created by the app), but **not** `drive.readonly` for browsing an existing complete personal Drive library. Browsers cannot reliably play private Google Drive videos requiring an Authorization header as standard `video.src` URLs. TeraBox's Open Platform requires developer `client_secret` and `private_secret` values that must not be embedded in a public webOS app, and it can restrict access to an application-specific folder. The existing computer companion is the supported, full-library path for those providers; replacing it safely would require a separately hosted authenticated service, not simply changing an app button.

Google TV OAuth scopes: https://developers.google.com/identity/protocols/oauth2/limited-input-device#allowedscopes
TeraBox platform documentation: https://www.terabox.com/integrations/docs/hindi

Supported connectors:

| Service | Setup on the companion | How you connect |
| --- | --- | --- |
| **WebDAV / Nextcloud / ownCloud** | No API registration | Enter an HTTPS WebDAV folder URL, username and an app-specific password in the TV dialog. Multiple servers and users are supported. |
| **Microsoft OneDrive personal** | Register an app in Microsoft Entra, enable **public client flows**, support personal Microsoft accounts, and set MS_CLIENT_ID | Open the verification URL and enter the code shown on TV. Requested delegated permissions: Files.Read, User.Read, offline_access. |
| **Dropbox** | Create a scoped Dropbox application with files.metadata.read, files.content.read and account_info.read; set DROPBOX_APP_KEY | Open the authorization link on a phone/computer, approve, then paste the resulting code into the TV dialog. Uses OAuth PKCE and offline refresh tokens, without embedding an app secret. |
| **Google Drive** | Enable Drive API; create a Google OAuth **Web application** client; register redirect http://localhost:3000/cloud/google/callback; set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET | Start linking on TV, then open the provided localhost URL **on the computer running the companion**. Sign in with your own Google account; the TV updates when linked. Uses read-only Drive scope. |
| **MEGA** | Included `megajs` dependency; no app registration | Enter account email/password on TV. Credentials remain on companion; streamed files are decrypted server-side. |
| **TeraBox** | Obtain TeraBox Open Platform client ID, secret and private secret | Scan QR code using TeraBox app. Open Platform may expose only the app-authorized folder. |

### MEGA and TeraBox (additional cloud services)

**MEGA (mega.io / mega.nz):** On the TV open Cloud library → Connect an account → **MEGA** and enter the email and password for the MEGA account. The companion uses the `megajs` library for encrypted file listings and downloads; downloads are decrypted by the companion and served to the TV with byte-range support. MEGA is not OAuth: **the email and password are stored in plaintext in `.runtime/cloud-accounts.json` on the companion**, with owner-only file permissions. Keep that computer protected. MEGA two-factor-authenticated accounts may need additional login support; this integration does not implement persistent 2FA sign-in. Streaming may be limited by MEGA transfer quotas.

**TeraBox:** This uses TeraBox's **official Open Platform** (not a third-party link scraper). Apply for Open Platform credentials through TeraBox and configure `TERABOX_CLIENT_ID`, `TERABOX_CLIENT_SECRET`, and `TERABOX_PRIVATE_SECRET` on the companion. On the TV choose **TeraBox**, then scan the displayed QR code using the TeraBox mobile app and authorize. The companion exchanges the device code for access and refresh tokens and obtains the account-specific API domain. TeraBox file listings and time-limited downloads are proxied by the companion. **Important:** the Open Platform restricts accessible paths to the application's authorized directory, not necessarily the entirety of your personal TeraBox storage. Set `TERABOX_ROOT` to the app's authorized folder, for example `/From: Other Applications/Orbit-APPID/`, if required by your TeraBox app registration. This folder access limitation cannot be bypassed by Orbit.

TeraBox documentation: https://www.terabox.com/integrations/docs/hindi
MEGAJS documentation: https://mega.js.org/

Example startup on macOS/Linux:

```sh
export ORBIT_TOKEN='use-a-long-unique-private-token'
export MS_CLIENT_ID='your-entra-app-client-id'
export DROPBOX_APP_KEY='your-dropbox-app-key'
export GOOGLE_CLIENT_ID='your-google-web-app-client-id'
export GOOGLE_CLIENT_SECRET='your-google-web-app-client-secret'
export TERABOX_CLIENT_ID='your-terabox-client-id'
export TERABOX_CLIENT_SECRET='your-terabox-client-secret'
export TERABOX_PRIVATE_SECRET='your-terabox-private-secret'
# export TERABOX_ROOT='/From: Other Applications/Orbit-APPID/'
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

The new direct MEGA mode can connect without a companion, but large films, Google Drive, TeraBox, conversion and BitTorrent still need it. The Homebrew catalog listing may continue pointing to the older published v1.1.0 package until a new v1.2.0 GitHub Release is uploaded with its exact SHA-256 and size. For the new beta build, use the IPK artifact from the GitHub Actions verification run, then sideload with ares-install. Physical TV testing remains outstanding.

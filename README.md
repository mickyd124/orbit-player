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
ares-install --device YOUR_TV dist/com.orbit.mediaplayer_1.0.0_all.ipk
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


## Homebrew Channel installation

In Homebrew Channel, open Settings → Add repository and enter:

https://raw.githubusercontent.com/mickyd124/orbit-player/main/apps.json

The webOS TV app requires an optional computer companion for conversion and BitTorrent playback. Physical TV testing remains outstanding.

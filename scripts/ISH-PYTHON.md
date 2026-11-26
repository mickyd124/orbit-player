# iSH Python companion

Python 3.8+ standard library, prebuilt browser assets, optional FFmpeg/FFprobe and rclone. No Node.js, npm or pip. Alpine repository URLs are unchanged.

```sh
apk add curl
curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/ish-install.sh -o install.sh
sh install.sh
```

Open http://127.0.0.1:3000/companion in Safari or http://IPHONE-WIFI-IP:3000/companion from another device. Unlock with the printed token. Enter the base Wi-Fi URL and token in Orbit or MultCloud. Both start by default. Restart with `sh ~/orbit-ish/start.sh`. Ctrl+C stops the server. Existing token and settings.sh are reused; previous launcher backed up. Keep iSH foreground: iOS may suspend it when opening Safari.

## Cloud storage

Native HTTPS WebDAV can be added through the existing cloud library. Optional rclone provides MEGA, Google Drive, OneDrive and Dropbox. Stop the server and run `sh ~/orbit-ish/cloud-config.sh`. Choose New remote, name it using letters, numbers, underscores or hyphens, select the provider and follow its authorization flow. For OAuth use the official headless instructions https://rclone.org/remote_setup/ if needed. Restart; configured supported remotes appear automatically. Remove rclone accounts through rclone config. Direct MEGA on TV is separate. TeraBox and original in-app OAuth/MEGA sign-in are not supported. Node account files remain untouched; reconnect accounts. Credentials stored privately but not necessarily encrypted at rest. Private LAN only.

## Media

Native playback depends on TV codecs. FFprobe detects streams; conservative H.264/AAC can be copied, unsupported audio converted, other video converted to H.264 up to 720p25 / AAC stereo HLS. Audio-only conversion supported. One conversion at a time, temporary HLS storage limit approximately 512 MiB checked every 10 seconds; long conversions may stop. iSH emulation may be too slow for real-time conversion or rclone. Missing optional helpers do not prevent server startup. No BitTorrent, DRM, hardware acceleration or HDR tone mapping. Physical iSH and TV testing outstanding. Other platforms retain Node.js.

## Troubleshooting

Run python3 --version, ffmpeg -version, ffprobe -version and rclone version separately. If rclone fails, use WebDAV or direct HTTP. Do not mix Alpine versions.

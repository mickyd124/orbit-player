#!/bin/sh
set -eu
umask 077
BASE="${HOME:-/root}/orbit-ish"
SRC="$BASE/orbit-player"
die(){ echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Run as root in iSH."
command -v apk >/dev/null || die "Alpine iSH required."
mkdir -p "$BASE"
apk update && apk add ca-certificates curl git python3 || die "Python packages unavailable; do not mix Alpine repositories."
python3 -c 'import sys,ssl,http.server; assert sys.version_info >= (3,8); print(sys.version)' || die "Python 3.8+ cannot run."
apk add ffmpeg || echo "FFmpeg unavailable; direct playback still works."
apk add rclone || echo "rclone unavailable; WebDAV and direct playback still work."
if [ -d "$SRC/.git" ]; then
  [ "$(git -C "$SRC" remote get-url origin)" = https://github.com/mickyd124/orbit-player.git ] || die "Unexpected Git remote."
  git -C "$SRC" diff --quiet && git -C "$SRC" diff --cached --quiet || die "Back up tracked changes first."
  git -C "$SRC" fetch --depth=1 origin main
  git -C "$SRC" checkout --detach FETCH_HEAD
else
  [ ! -e "$SRC" ] || die "Existing non-Git directory: $SRC"
  git clone --depth=1 https://github.com/mickyd124/orbit-player.git "$SRC"
fi
for asset in hls.min.js dash.all.min.js mega.browser.js; do
  test -s "$SRC/app/vendor/$asset" || die "Prebuilt browser asset missing: $asset"
done
python3 -m py_compile "$SRC/server/ish/companion.py"
[ -s "$BASE/token" ] || python3 -c 'import secrets;print(secrets.token_hex(24))' > "$BASE/token"
chmod 600 "$BASE/token"
[ -e "$BASE/settings.sh" ] || printf 'PORT=3000\n' > "$BASE/settings.sh"
chmod 600 "$BASE/settings.sh"
if [ -f "$BASE/start.sh" ] && [ ! -e "$BASE/start-previous.sh" ]; then cp "$BASE/start.sh" "$BASE/start-previous.sh"; fi
cat > "$BASE/start-python.sh" <<'START'
#!/bin/sh
set -eu
umask 077
BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
set -a
. "$BASE/settings.sh"
set +a
export ORBIT_ISH_HOME="$BASE"
export PORT="${PORT:-3000}"
export ORBIT_TOKEN="$(cat "$BASE/token")"
case "${1:-both}" in 1|orbit) ORBIT_CLIENT_MODE=orbit;; 2|multcloud) ORBIT_CLIENT_MODE=multcloud;; 3|both) ORBIT_CLIENT_MODE=both;; *) echo "Select orbit, multcloud or both."; exit 2;; esac
export ORBIT_CLIENT_MODE
exec python3 -u "$BASE/orbit-player/server/ish/companion.py"
START
chmod 700 "$BASE/start-python.sh"
cat > "$BASE/start.sh" <<'START'
#!/bin/sh
BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
exec sh "$BASE/start-python.sh" "$@"
START
chmod 700 "$BASE/start.sh"
cat > "$BASE/cloud-config.sh" <<'CLOUD'
#!/bin/sh
set -eu
umask 077
BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
command -v rclone >/dev/null || { echo "rclone unavailable; use WebDAV in browser."; exit 1; }
exec rclone --config "$BASE/rclone.conf" config
CLOUD
chmod 700 "$BASE/cloud-config.sh"
printf '\nRestart: sh %s/start.sh\nCloud setup: sh %s/cloud-config.sh\n' "$BASE" "$BASE"
[ "${1:-}" != --install-only ] || exit 0
exec sh "$BASE/start.sh" "${1:-both}"

#!/bin/sh
set -eu
umask 077
BASE="${HOME:-/root}/orbit-ish"
SRC="$BASE/orbit-player"
die(){ echo "ERROR: $*" >&2; exit 1; }
[ "$(id -u)" = 0 ] || die "Run as root in iSH."
command -v apk >/dev/null || die "Alpine iSH required."
mkdir -p "$BASE"
apk update && apk add ca-certificates curl git nodejs npm || die "Alpine dependencies unavailable. Do not mix Alpine versions."
apk add ffmpeg || echo "FFmpeg unavailable: direct playback only."
PROBE='if(+process.versions.node.split(".")[0]<22)process.exit(42);console.log(require("node:crypto").randomBytes(8).toString("hex"));'
unset NODE_OPTIONS
MODE=normal
if ! node -e "$PROBE"; then
  export NODE_OPTIONS=--jitless
  MODE=jitless
  node -e "$PROBE" || die "Node 22+ cannot run in this iSH installation."
fi
if [ ! -d "$SRC/.git" ]; then
  [ ! -e "$SRC" ] || die "Existing non-Git directory: $SRC"
  git clone --depth=1 https://github.com/mickyd124/orbit-player.git "$SRC"
else
  [ "$(git -C "$SRC" remote get-url origin)" = https://github.com/mickyd124/orbit-player.git ] || die "Unexpected Git remote."
  git -C "$SRC" diff --quiet && git -C "$SRC" diff --cached --quiet || die "Back up local tracked changes before updating."
  git -C "$SRC" fetch --depth=1 origin main
  git -C "$SRC" checkout --detach FETCH_HEAD
fi
cd "$SRC"
grep -q ORBIT_CLIENT_MODE server/index.js || die "Shared companion source missing."
npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
npm run vendor
printf '%s\n' "$MODE" > "$BASE/node-mode"
# Probe real HTTP streaming (some V8/undici builds fail on iSH).
cat > "$BASE/http-check.mjs" <<'JS'
import http from 'node:http';
import {once} from 'node:events';
import {Readable} from 'node:stream';
const s=http.createServer((q,r)=>r.end('ok'));s.listen(0,'127.0.0.1');
try {await once(s,'listening');const r=await fetch('http://127.0.0.1:'+s.address().port,{signal:AbortSignal.timeout(8000)});let out='';for await(const c of Readable.fromWeb(r.body))out+=c.toString();if(out!=='ok')throw Error('HTTP check failed');}finally{s.closeAllConnections?.();s.close();}
JS
cat > "$BASE/fetch-shim.mjs" <<'JS'
import fetch from './compat/node_modules/node-fetch/src/index.js';
import {Readable} from 'node:stream';
globalThis.fetch=async(input,init)=>{const r=await fetch(input,init);const body=[204,205,304].includes(r.status)||!r.body?null:Readable.toWeb(r.body);const x=new Response(body,{status:r.status,statusText:r.statusText,headers:r.headers});Object.defineProperties(x,{url:{value:r.url},redirected:{value:r.redirected}});return x;};
JS
FETCH=native
if ! node "$BASE/http-check.mjs"; then
  FETCH=shim
  mkdir -p "$BASE/compat"
  npm install --prefix "$BASE/compat" --ignore-scripts --omit=dev --no-audit --no-fund --save-exact node-fetch@3.3.2
  node --import "$BASE/fetch-shim.mjs" "$BASE/http-check.mjs" || die "HTTP runtime incompatible."
fi
printf '%s\n' "$FETCH" > "$BASE/fetch-mode"
[ -s "$BASE/token" ] || od -An -N24 -tx1 /dev/urandom | tr -d ' \n' > "$BASE/token"
chmod 600 "$BASE/token"
[ -e "$BASE/settings.sh" ] || cat > "$BASE/settings.sh" <<'CFG'
PORT=3000
# GOOGLE_CLIENT_ID=''
# GOOGLE_CLIENT_SECRET=''
# MS_CLIENT_ID=''
# DROPBOX_APP_KEY=''
# TERABOX_CLIENT_ID=''
# TERABOX_CLIENT_SECRET=''
# TERABOX_PRIVATE_SECRET=''
# TERABOX_ROOT=''
CFG
chmod 600 "$BASE/settings.sh"
cat > "$BASE/start.sh" <<'START'
#!/bin/sh
set -eu
umask 077
BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$BASE/orbit-player"
set -a
. "$BASE/settings.sh"
set +a
PORT=${PORT:-3000}
case "$PORT" in ''|*[!0-9]*) echo "Invalid port"; exit 1;; esac
[ "$PORT" -ge 1024 ] && [ "$PORT" -le 65535 ] || exit 1
export PORT
choice=${1:-both}
case "$choice" in 1|orbit) ORBIT_CLIENT_MODE=orbit;; 2|multcloud) ORBIT_CLIENT_MODE=multcloud;; 3|both|'') ORBIT_CLIENT_MODE=both;; *) echo "Invalid selection"; exit 2;; esac
export ORBIT_CLIENT_MODE
ORBIT_TOKEN=$(cat "$BASE/token")
[ "${#ORBIT_TOKEN}" -ge 32 ] || exit 1
export ORBIT_TOKEN
if [ "$(cat "$BASE/node-mode")" = jitless ]; then export NODE_OPTIONS=--jitless; else unset NODE_OPTIONS; fi
if curl -s --max-time 2 -o /dev/null "http://127.0.0.1:$PORT/api/health"; then echo "Port already in use"; exit 1; fi
if [ "$(cat "$BASE/fetch-mode")" = shim ]; then node --import "$BASE/fetch-shim.mjs" server/index.js & else node server/index.js & fi
pid=$!
cleanup(){ kill "$pid" 2>/dev/null || true; wait "$pid" 2>/dev/null || true; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM HUP
n=0
while [ "$n" -lt 60 ]; do
  kill -0 "$pid" 2>/dev/null || { echo "Server exited"; exit 1; }
  if health=$(curl -fsS --max-time 2 -H "Authorization: Bearer $ORBIT_TOKEN" "http://127.0.0.1:$PORT/api/health" 2>/dev/null); then
    printf '\nREADY: %s\nServer URL: http://YOUR-IPHONE-WIFI-IP:%s\nDashboard: http://127.0.0.1:%s/companion\nAccess token: %s\nOpen the Dashboard URL in Safari manually. Keep iSH open. Ctrl+C stops server.\n' "$health" "$PORT" "$PORT" "$ORBIT_TOKEN"
    wait "$pid"; exit $?
  fi
  n=$((n+1)); sleep 1
done
echo "Health check failed"; exit 1
START
chmod 700 "$BASE/start.sh"
if [ "${1:-}" = --install-only ]; then echo "Run: sh $BASE/start.sh"; exit 0; fi
exec sh "$BASE/start.sh" "${1:-}"

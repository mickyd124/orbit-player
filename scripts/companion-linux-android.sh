#!/bin/sh
set -eu
umask 077
BASE="$HOME/orbit-companion"
SRC="$BASE/orbit-player"
die(){ printf 'ERROR: %s\n' "$*" >&2; exit 1; }
mkdir -p "$BASE"
MOBILE=0
if [ -n "${TERMUX_VERSION:-}" ] || [ -n "${PREFIX:-}" ] && [ -x "$PREFIX/bin/pkg" ]; then MOBILE=1; fi
rootrun(){ if [ "$(id -u)" = 0 ]; then "$@"; else sudo "$@"; fi; }
if [ "$MOBILE" = 1 ]; then
  pkg update -y
  pkg install -y git curl ca-certificates nodejs-lts
  if ! command -v npm >/dev/null; then pkg install -y npm; fi
  pkg install -y ffmpeg || echo "FFmpeg unavailable; direct playback only."
else
  if command -v apt-get >/dev/null; then
    rootrun apt-get update
    rootrun apt-get install -y git curl ca-certificates xz-utils
    rootrun apt-get install -y ffmpeg || echo "FFmpeg unavailable."
  elif command -v dnf >/dev/null; then
    rootrun dnf install -y git curl ca-certificates xz
    rootrun dnf install -y ffmpeg || echo "FFmpeg unavailable."
  elif command -v pacman >/dev/null; then
    rootrun pacman -S --needed git curl ca-certificates xz nodejs npm ffmpeg
  elif command -v apk >/dev/null; then
    rootrun apk add git curl ca-certificates nodejs npm
    rootrun apk add ffmpeg || echo "FFmpeg unavailable."
  else
    echo "Unrecognised package manager; install Git, curl, Node 22+, npm and FFmpeg first."
  fi
  if [ -d "$BASE/node/bin" ]; then PATH="$BASE/node/bin:$PATH"; export PATH; fi
  if ! command -v node >/dev/null || ! node -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)'; then
    # Official glibc Linux build; Alpine needs its own musl package.
    if command -v apk >/dev/null; then die "Alpine repository must provide Node 22+."; fi
    case "$(uname -m)" in x86_64) arch=x64;; aarch64|arm64) arch=arm64;; armv7l) arch=armv7l;; *) die "Install Node 22+ for this CPU manually.";; esac
    command -v sha256sum >/dev/null || die "sha256sum required."
    tmp=$(mktemp -d)
    trap 'rm -rf "$tmp"' EXIT
    url=https://nodejs.org/dist/latest-v22.x
    curl -fsSL "$url/SHASUMS256.txt" -o "$tmp/SHASUMS256.txt"
    archive=$(awk -v a="$arch" '$2 ~ ("^node-v[0-9.]+-linux-" a "\\.tar\\.xz$"){print $2;exit}' "$tmp/SHASUMS256.txt")
    [ -n "$archive" ] || die "Official Node archive unavailable for $arch."
    curl -fsSL "$url/$archive" -o "$tmp/$archive"
    (cd "$tmp"; grep "  $archive$" SHASUMS256.txt | sha256sum -c -)
    mkdir -p "$BASE/node"
    tar -xJf "$tmp/$archive" --strip-components=1 -C "$BASE/node"
    PATH="$BASE/node/bin:$PATH"; export PATH
    rm -rf "$tmp"; trap - EXIT
  fi
fi
node -e 'process.exit(+process.versions.node.split(".")[0]>=22?0:1)' || die "Node 22+ required."
command -v npm >/dev/null || die "npm not installed."
if [ -d "$SRC/.git" ]; then
  [ "$(git -C "$SRC" remote get-url origin)" = https://github.com/mickyd124/orbit-player.git ] || die "Unexpected remote."
  git -C "$SRC" diff --quiet && git -C "$SRC" diff --cached --quiet || die "Local changes exist; back up before updating."
  git -C "$SRC" fetch --depth=1 origin main
  git -C "$SRC" checkout --detach FETCH_HEAD
else
  [ ! -e "$SRC" ] || die "Existing non-Git directory: $SRC"
  git clone --depth=1 https://github.com/mickyd124/orbit-player.git "$SRC"
fi
cd "$SRC"
if [ "$MOBILE" = 1 ]; then
  npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
  touch "$BASE/cloud-only"
else
  if npm ci --omit=dev --no-audit --no-fund; then rm -f "$BASE/cloud-only"; else
    echo "Native dependencies failed. Retrying in cloud-only mode."
    npm ci --omit=dev --omit=optional --ignore-scripts --no-audit --no-fund
    touch "$BASE/cloud-only"
  fi
fi
npm run vendor
cat > "$BASE/start.sh" <<'START'
#!/bin/sh
set -eu
BASE=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
if [ -d "$BASE/node/bin" ]; then PATH="$BASE/node/bin:$PATH"; export PATH; fi
if command -v termux-wake-lock >/dev/null; then
  termux-wake-lock || true
  trap 'termux-wake-unlock || true' EXIT
  node "$BASE/orbit-player/scripts/companion-launch.mjs" "$@"
else
  exec node "$BASE/orbit-player/scripts/companion-launch.mjs" "$@"
fi
START
chmod 700 "$BASE/start.sh"
echo "Restart: sh $BASE/start.sh"
if [ "${1:-}" = --install-only ]; then exit 0; fi
exec sh "$BASE/start.sh" "$@"

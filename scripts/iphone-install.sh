#!/bin/sh
set -eu
command -v apk >/dev/null || { echo "Run in iPhone iSH."; exit 1; }
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/ish-python-install.sh -o "$tmp"
sh "$tmp" "$@"

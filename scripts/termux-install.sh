#!/bin/sh
set -eu
[ -n "${TERMUX_VERSION:-}" ] || { echo "Run in Android Termux; on iPhone use iSH."; exit 1; }
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/companion-linux-android.sh -o "$tmp"
sh "$tmp" "$@"

#!/bin/sh
# Default iSH installer: Python, no Node.js or npm.
set -eu
tmp=$(mktemp)
trap 'rm -f "$tmp"' EXIT
curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/ish-python-install.sh -o "$tmp"
sh "$tmp" "$@"

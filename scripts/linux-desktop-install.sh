#!/bin/sh
set -eu
umask 077
[ "$(id -u)" != 0 ] || { echo "Run as your desktop user, not root."; exit 1; }
if command -v apt-get >/dev/null; then sudo apt-get update && sudo apt-get install -y python3-tk python3 curl
elif command -v dnf >/dev/null; then sudo dnf install -y python3-tkinter python3 curl
elif command -v pacman >/dev/null; then sudo pacman -S --needed python tk curl
elif command -v apk >/dev/null; then sudo apk add python3 tk py3-tkinter curl
else echo "Install Python 3 with Tk and curl before continuing."; fi
tmp=$(mktemp);trap 'rm -f "$tmp"' EXIT
curl -fsSL https://raw.githubusercontent.com/mickyd124/orbit-player/main/scripts/companion-linux-android.sh -o "$tmp"
sh "$tmp" --install-only
BASE="$HOME/orbit-companion"
mkdir -p "$HOME/.local/share/applications" "$HOME/.local/bin"
cat > "$HOME/.local/bin/orbit-companion-gui" <<'START'
#!/bin/sh
exec python3 "$HOME/orbit-companion/orbit-player/scripts/linux-companion-gui.py"
START
chmod 700 "$HOME/.local/bin/orbit-companion-gui"
printf '[Desktop Entry]\nType=Application\nName=Orbit MultCloud Companion\nExec="%s/.local/bin/orbit-companion-gui"\nTerminal=false\nCategories=AudioVideo;Network;\n' "$HOME" > "$HOME/.local/share/applications/orbit-companion.desktop"
echo "Launch Orbit MultCloud Companion from your desktop menu."
[ "${1:-}" = --install-only ] || exec "$HOME/.local/bin/orbit-companion-gui"

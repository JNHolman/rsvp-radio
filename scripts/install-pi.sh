#!/usr/bin/env bash
set -euo pipefail

if [[ "${EUID}" -eq 0 ]]; then
  echo "Run this installer as the desktop user, not with sudo. It elevates only the system install steps." >&2
  exit 2
fi

APP_USER="${APP_USER:-$(id -un)}"
APP_GROUP="${APP_GROUP:-$(id -gn)}"
APP_HOME="${APP_HOME:-$HOME}"
APP_DIR="${APP_DIR:-$(pwd)}"

if [[ "$(pwd -P)" != "$(cd "$APP_DIR" 2>/dev/null && pwd -P)" ]]; then
  echo "Run this script from APP_DIR ($APP_DIR)." >&2
  exit 2
fi

command -v node >/dev/null || { echo "Node.js is required." >&2; exit 3; }
NODE_BIN="$(command -v node)"
NODE_MAJOR="$(node -p 'Number(process.versions.node.split(".")[0])')"
(( NODE_MAJOR >= 18 )) || { echo "Node.js 18+ is required." >&2; exit 3; }
command -v npm >/dev/null || { echo "npm is required." >&2; exit 3; }
command -v curl >/dev/null || { echo "curl is required." >&2; exit 3; }
command -v systemctl >/dev/null || { echo "systemd is required." >&2; exit 3; }
command -v python3 >/dev/null || { echo "Python 3 is required." >&2; exit 3; }

if [[ ! -f .env ]]; then
  cp .env.example .env
  chmod 600 .env
  echo "Created $APP_DIR/.env. Fill in Plex and Hue values, then rerun this script." >&2
  exit 4
fi

node scripts/preflight.js .env

if ! python3 -c 'import numpy' >/dev/null 2>&1 || ! command -v pactl >/dev/null 2>&1 || ! command -v parec >/dev/null 2>&1; then
  echo "Installing Raspberry Pi audio-analyzer dependencies..."
  sudo apt-get update
  sudo apt-get install -y python3-numpy pulseaudio-utils
fi

if [[ -f package-lock.json ]]; then
  npm ci --omit=dev --no-audit --no-fund
else
  echo "WARNING: package-lock.json is absent; npm install is not fully reproducible." >&2
  echo "Generate and commit the lockfile from an npm-connected machine for a frozen release." >&2
  npm install --omit=dev --no-audit --no-fund
fi

render_unit() {
  local src="$1" dst="$2"
  sed \
    -e "s|User=pi|User=$APP_USER|g" \
    -e "s|Group=pi|Group=$APP_GROUP|g" \
    -e "s|/home/pi/rsvp-radio|$APP_DIR|g" \
    -e "s|/usr/bin/node|$NODE_BIN|g" \
    "$src" | sudo tee "$dst" >/dev/null
  sudo chmod 0644 "$dst"
}

render_user_unit() {
  local src="$1" dst="$2"
  sed -e "s|/home/pi/rsvp-radio|$APP_DIR|g" "$src" > "$dst"
  chmod 0644 "$dst"
}

render_unit deploy/systemd/rsvp-hue.service /etc/systemd/system/rsvp-hue.service
render_unit deploy/systemd/rsvp-radio.service /etc/systemd/system/rsvp-radio.service

install -d -m 0755 "$APP_HOME/.config/systemd/user"
render_user_unit deploy/systemd-user/rsvp-analyzer.service "$APP_HOME/.config/systemd/user/rsvp-analyzer.service"

install -d -m 0755 "$APP_HOME/.config/autostart"
sed "s|/home/pi/rsvp-radio|$APP_DIR|g" deploy/autostart/rsvp-kiosk.desktop \
  > "$APP_HOME/.config/autostart/rsvp-kiosk.desktop"
chmod 0644 "$APP_HOME/.config/autostart/rsvp-kiosk.desktop"

sudo systemctl daemon-reload
sudo systemctl enable rsvp-hue.service rsvp-radio.service
sudo systemctl restart rsvp-hue.service
sudo systemctl restart rsvp-radio.service

systemctl --user daemon-reload
systemctl --user enable rsvp-analyzer.service
systemctl --user restart rsvp-analyzer.service

APP_DIR="$APP_DIR" APP_HOME="$APP_HOME" scripts/verify-pi.sh

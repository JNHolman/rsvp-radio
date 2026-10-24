#!/usr/bin/env bash
# Deploy ONLY the reviewed RSVP TV display-layer fix to port 3000.
# Stop without writing if the running Pi files diverge from the reviewed base.
set -euo pipefail

BASE="c5494ec699031dbcac14a63588e942473873c9b9"
FIX="ff4acaf39b60b4049aeb1afc90f2c383d56e1350"
REMOTE="https://raw.githubusercontent.com/JNHolman/rsvp-radio"
FILES=(public/app/background.js public/tv-refined.css)

if (( EUID == 0 )); then
  echo "STOP: run as the Pi desktop user, not with sudo." >&2
  exit 2
fi
for command in systemctl curl cmp mktemp node cp; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "STOP: missing required command: $command" >&2
    exit 2
  fi
done

APP="$(systemctl show -p WorkingDirectory --value rsvp-radio.service 2>/dev/null)"
if [[ -z "$APP" || ! -f "$APP/server.js" || ! -f "$APP/.env" ]]; then
  echo "STOP: could not identify the running RSVP production work directory." >&2
  exit 2
fi
if grep -Eq '^[[:space:]]*PUBLIC_DIR[[:space:]]*=' "$APP/.env"; then
  echo "STOP: custom PUBLIC_DIR in .env; inspect the active frontend location first." >&2
  exit 2
fi
if ! systemctl is-active --quiet rsvp-radio.service; then
  echo "STOP: production service is not active." >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/base/public/app" "$TMP/fix/public/app" "$TMP/served/public/app"

echo "Checking live port 3000 and existing frontend files..."
for file in "${FILES[@]}"; do
  [[ -f "$APP/$file" && -w "$APP/$file" ]] || {
    echo "STOP: $APP/$file missing or not writable." >&2
    exit 3
  }
  curl -fsSL --retry 2 "$REMOTE/$BASE/$file" -o "$TMP/base/$file"
  curl -fsSL --retry 2 "$REMOTE/$FIX/$file" -o "$TMP/fix/$file"
  curl -fsSL --max-time 8 "http://127.0.0.1:3000/$file" -o "$TMP/served/$file"
  if ! cmp -s "$APP/$file" "$TMP/base/$file"; then
    echo "STOP: local $file differs from the GitHub base; no files changed." >&2
    exit 3
  fi
  if ! cmp -s "$TMP/served/$file" "$APP/$file"; then
    echo "STOP: port 3000 serves a different $file; no files changed." >&2
    exit 3
  fi
done

node --check "$TMP/fix/public/app/background.js"

BACKUP="$HOME/rsvp-tv-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP/public/app"
for file in "${FILES[@]}"; do
  cp -p "$APP/$file" "$BACKUP/$file"
done
printf '%s\n' "$APP" > "$BACKUP/app-dir.txt"

restore() {
  echo "Deployment check failed. Restoring original frontend files..." >&2
  for file in "${FILES[@]}"; do
    cp -p "$BACKUP/$file" "$APP/$file"
  done
}

for file in "${FILES[@]}"; do
  if ! cp "$TMP/fix/$file" "$APP/$file"; then
    restore
    exit 4
  fi
done
for file in "${FILES[@]}"; do
  if ! curl -fsSL --max-time 8 "http://127.0.0.1:3000/$file" -o "$TMP/served/$file" ||
     ! cmp -s "$TMP/served/$file" "$TMP/fix/$file"; then
    restore
    exit 4
  fi
done

echo "PASS: both corrected TV files are served on port 3000."
echo "BACKUP: $BACKUP"
echo "No server or Hue restart was performed."
echo "Reload the actual Pi Chromium kiosk page to activate the new code."
echo "Rollback (if needed):"
printf '  cp -p %q %q\n' "$BACKUP/public/app/background.js" "$APP/public/app/background.js"
printf '  cp -p %q %q\n' "$BACKUP/public/tv-refined.css" "$APP/public/tv-refined.css"

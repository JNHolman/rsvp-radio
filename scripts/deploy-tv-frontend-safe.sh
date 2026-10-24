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
# config.js uses PUBLIC_DIR when it names an existing directory, otherwise
# falls back to APP/public. Parse ONLY that variable; never source or print .env.
# The port-3000 file comparison below independently confirms this is the web root.
WEBROOT="$(APP="$APP" node <<'NODE'
const fs = require("node:fs");
const path = require("node:path");
const app = process.env.APP;
const dotenv = require(path.join(app, "node_modules", "dotenv"));
const env = dotenv.parse(fs.readFileSync(path.join(app, ".env")));
const configured = env.PUBLIC_DIR || "";
const candidate = configured ? path.resolve(app, configured) : "";
const fallback = path.join(app, "public");
const directory = candidate && fs.existsSync(candidate) ? candidate : fallback;
if (!fs.statSync(directory).isDirectory()) process.exit(3);
process.stdout.write(directory);
NODE
)" || { echo "STOP: failed to resolve active PUBLIC_DIR safely." >&2; exit 2; }
echo "Detected frontend directory: $WEBROOT"
if ! systemctl is-active --quiet rsvp-radio.service; then
  echo "STOP: production service is not active." >&2
  exit 2
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/base/public/app" "$TMP/fix/public/app" "$TMP/served/public/app" "$TMP/merged/public/app"

echo "Checking live port 3000 and existing frontend files..."
for file in "${FILES[@]}"; do
  localfile="$WEBROOT/${file#public/}"
  [[ -f "$localfile" && -w "$localfile" ]] || {
    echo "STOP: $localfile missing or not writable." >&2
    exit 3
  }
  curl -fsSL --retry 2 "$REMOTE/$BASE/$file" -o "$TMP/base/$file"
  curl -fsSL --retry 2 "$REMOTE/$FIX/$file" -o "$TMP/fix/$file"
  curl -fsSL --max-time 8 "http://127.0.0.1:3000/${file#public/}" -o "$TMP/served/$file"
  if ! cmp -s "$TMP/served/$file" "$localfile"; then
    echo "STOP: port 3000 serves a different $file; no files changed." >&2
    exit 3
  fi

  if [[ "$file" == "public/tv-refined.css" ]]; then
    # The Pi has owner-approved drawer/lighting styles APPENDED to the base
    # stylesheet. Keep that tail byte-for-byte, but refuse changes anywhere
    # inside the original base. This avoids clobbering uncommitted design work.
    base_bytes="$(wc -c < "$TMP/base/$file")"
    local_bytes="$(wc -c < "$localfile")"
    if (( local_bytes < base_bytes )) ||
       ! head -c "$base_bytes" "$localfile" | cmp -s - "$TMP/base/$file"; then
      echo "STOP: CSS differs inside the reviewed base, not just appended styling; no files changed." >&2
      exit 3
    fi

    cp "$TMP/fix/$file" "$TMP/merged/$file"
    if (( local_bytes > base_bytes )); then
      tail -c +"$((base_bytes + 1))" "$localfile" >> "$TMP/merged/$file"
      echo "Preserved appended RSVP TV drawer CSS ($((local_bytes - base_bytes)) bytes)."
    fi
  else
    if ! cmp -s "$localfile" "$TMP/base/$file"; then
      echo "STOP: local $file differs from the GitHub base; no files changed." >&2
      exit 3
    fi
    cp "$TMP/fix/$file" "$TMP/merged/$file"
  fi
done

node --check "$TMP/fix/public/app/background.js"

BACKUP="$HOME/rsvp-tv-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP/public/app"
for file in "${FILES[@]}"; do
  cp -p "$WEBROOT/${file#public/}" "$BACKUP/$file"
done
printf '%s\n' "$APP" > "$BACKUP/app-dir.txt"
printf '%s\n' "$WEBROOT" > "$BACKUP/web-root.txt"

restore() {
  echo "Deployment check failed. Restoring original frontend files..." >&2
  for file in "${FILES[@]}"; do
    cp -p "$BACKUP/$file" "$WEBROOT/${file#public/}"
  done
}

for file in "${FILES[@]}"; do
  if ! cp "$TMP/merged/$file" "$WEBROOT/${file#public/}"; then
    restore
    exit 4
  fi
done
for file in "${FILES[@]}"; do
  if ! curl -fsSL --max-time 8 "http://127.0.0.1:3000/${file#public/}" -o "$TMP/served/$file" ||
     ! cmp -s "$TMP/served/$file" "$TMP/merged/$file"; then
    restore
    exit 4
  fi
done

echo "PASS: both corrected TV files are served on port 3000, preserving appended custom CSS."
echo "BACKUP: $BACKUP"
echo "No server or Hue restart was performed."
echo "Reload the actual Pi Chromium kiosk page to activate the new code."
echo "Rollback (if needed):"
printf '  cp -p %q %q\n' "$BACKUP/public/app/background.js" "$WEBROOT/app/background.js"
printf '  cp -p %q %q\n' "$BACKUP/public/tv-refined.css" "$WEBROOT/tv-refined.css"

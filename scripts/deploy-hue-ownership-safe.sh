#!/usr/bin/env bash
# Only update the RSVP Hue adapter's false-takeover detector.
# Stop without writing if the Pi's actual Hue files differ from the audited
# October 19 production base. No TV, Radio, Plex or Hue configuration changes.
set -euo pipefail

BASE="18075caa8c2cae131685a9b19ab55fcf7dbfbcd9"
FIX="1dc9072cffffcba98726cfc56dd12e1e3a362af8"
REMOTE="https://raw.githubusercontent.com/JNHolman/rsvp-radio"
FILES=(hue-adapter.js hue/ownership.js)

if (( EUID == 0 )); then echo "STOP: run as pi, not sudo."; exit 2; fi
for cmd in systemctl curl cmp mktemp cp node sudo; do
  command -v "$cmd" >/dev/null 2>&1 || { echo "STOP: missing $cmd"; exit 2; }
done
APP="$(systemctl show -p WorkingDirectory --value rsvp-hue.service 2>/dev/null)"
RADIO_APP="$(systemctl show -p WorkingDirectory --value rsvp-radio.service 2>/dev/null)"
HUE_EXEC="$(systemctl show -p ExecStart --value rsvp-hue.service 2>/dev/null)"
if [[ -z "$APP" || "$APP" != "$RADIO_APP" || ! -f "$APP/hue-adapter.js" ||
      ! -f "$APP/hue/ownership.js" || "$HUE_EXEC" != *"$APP/hue-adapter.js"* ]]; then
  echo "STOP: Hue service is not using the expected production directory." >&2; exit 3
fi
if ! systemctl is-active --quiet rsvp-radio.service ||
   ! systemctl is-active --quiet rsvp-hue.service; then
  echo "STOP: both production services must be running." >&2; exit 3
fi
if ! curl -fsS --max-time 8 http://127.0.0.1:5005/health >/dev/null; then
  echo "STOP: Hue Bridge health was not OK before install." >&2; exit 3
fi

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
mkdir -p "$TMP/base/hue" "$TMP/fix/hue"
echo "Checking Hue adapter against the reviewed October 19 base..."
for file in "${FILES[@]}"; do
  [[ -f "$APP/$file" && -w "$APP/$file" ]] ||
    { echo "STOP: Hue file missing or unwritable: $file"; exit 3; }
  curl -fsSL --retry 2 "$REMOTE/$BASE/$file" -o "$TMP/base/$file"
  curl -fsSL --retry 2 "$REMOTE/$FIX/$file" -o "$TMP/fix/$file"
  if ! cmp -s "$APP/$file" "$TMP/base/$file"; then
    echo "STOP: local $file differs from reviewed production base; no files changed." >&2
    exit 3
  fi
done
node --check "$TMP/fix/hue-adapter.js"
node --check "$TMP/fix/hue/ownership.js"
BACKUP="$HOME/rsvp-hue-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP/hue"
for file in "${FILES[@]}"; do cp -p "$APP/$file" "$BACKUP/$file"; done
printf '%s\n' "$APP" > "$BACKUP/app-dir.txt"
echo "Hue-only backup: $BACKUP"

restore() {
  echo "Restoring original Hue files..." >&2
  for file in "${FILES[@]}"; do cp -p "$BACKUP/$file" "$APP/$file"; done
  sudo systemctl restart rsvp-hue.service || echo "WARNING: manual Hue restart needed." >&2
}

for file in "${FILES[@]}"; do
  if ! cp "$TMP/fix/$file" "$APP/$file"; then restore; exit 4; fi
done

if ! sudo systemctl restart rsvp-hue.service; then restore; exit 4; fi
if ! systemctl is-active --quiet rsvp-hue.service ||
   ! curl --retry 8 --retry-connrefused --retry-delay 1 -fsS --max-time 8 \
       http://127.0.0.1:5005/health >/dev/null; then
  restore
  echo "STOP: new Hue adapter failed health; originals restored." >&2
  exit 4
fi

echo "PASS: Hue takeover detection updated and Hue adapter healthy on port 5005."
echo "Unchanged: RSVP Radio on 3000, Plexamp, TV, Hue scenes, palette files and settings."
echo "BACKUP: $BACKUP"
echo "Original-file rollback:"
printf '  cp -p %q %q\n' "$BACKUP/hue-adapter.js" "$APP/hue-adapter.js"
printf '  cp -p %q %q\n' "$BACKUP/hue/ownership.js" "$APP/hue/ownership.js"
echo "  sudo systemctl restart rsvp-hue.service"

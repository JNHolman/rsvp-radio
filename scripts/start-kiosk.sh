#!/usr/bin/env bash
set -euo pipefail

URL="${RSVP_KIOSK_URL:-http://127.0.0.1:3000}"
HEALTH_URL="${RSVP_KIOSK_HEALTH_URL:-http://127.0.0.1:3000/health}"

browser=""
for candidate in chromium chromium-browser; do
  if command -v "$candidate" >/dev/null 2>&1; then
    browser="$candidate"
    break
  fi
done

if [[ -z "$browser" ]]; then
  echo "RSVP kiosk: Chromium is not installed." >&2
  exit 3
fi

# A desktop session can start before network/system services finish. Do not open
# an error page and depend on a human refresh; wait until RSVP is actually live.
rsvp_ready() {
  curl -fsS --max-time 2 "$HEALTH_URL" 2>/dev/null |
    python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("ok") else 1)' 2>/dev/null
}

for _ in $(seq 1 90); do
  if rsvp_ready; then
    exec "$browser" \
      --kiosk \
      --noerrdialogs \
      --disable-session-crashed-bubble \
      --autoplay-policy=no-user-gesture-required \
      --disable-infobars \
      "$URL"
  fi
  sleep 1
done

echo "RSVP kiosk: server health never became ready." >&2
exit 4

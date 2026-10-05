#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(pwd)}"
APP_HOME="${APP_HOME:-$HOME}"
cd "$APP_DIR"

fail=0
check() {
  local label="$1"; shift
  if "$@" >/dev/null 2>&1; then
    printf 'PASS  %s\n' "$label"
  else
    printf 'FAIL  %s\n' "$label"
    fail=1
  fi
}

check "Node.js available" node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 18 ? 0 : 1)'
check "Python analyzer dependency" python3 -c 'import numpy'
check "Pulse monitor tools available" bash -lc 'command -v pactl >/dev/null && command -v parec >/dev/null'
check ".env exists" test -f .env
check "Environment preflight" node scripts/preflight.js .env
check "Hue service active" systemctl is-active --quiet rsvp-hue.service
check "RSVP service active" systemctl is-active --quiet rsvp-radio.service
check "Audio analyzer active" systemctl --user is-active --quiet rsvp-analyzer.service
check "Hue adapter/bridge health" curl -fsS --max-time 4 http://127.0.0.1:5005/health
rsvp_health_ok() {
  curl -fsS --max-time 4 http://127.0.0.1:3000/health |
    python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("ok") else 1)'
}
check "RSVP health" rsvp_health_ok
check "Kiosk autostart installed" test -f "$APP_HOME/.config/autostart/rsvp-kiosk.desktop"
check "Chromium available" bash -lc 'command -v chromium >/dev/null || command -v chromium-browser >/dev/null'

analyzer_fresh=0
for _ in {1..20}; do
  if curl -fsS --max-time 2 http://127.0.0.1:3000/health | python3 -c 'import json,sys; d=json.load(sys.stdin); raise SystemExit(0 if d.get("analyzer",{}).get("fresh") else 1)' 2>/dev/null; then
    analyzer_fresh=1
    break
  fi
  sleep 0.5
done
if (( analyzer_fresh )); then
  printf 'PASS  %s\n' "Audio features reaching RSVP"
else
  printf 'FAIL  %s\n' "Audio features reaching RSVP"
  fail=1
fi

if (( fail )); then
  echo
  echo "Verification failed. Inspect:"
  echo "  journalctl -u rsvp-hue -n 100 --no-pager"
  echo "  journalctl -u rsvp-radio -n 100 --no-pager"
  echo "  journalctl --user -u rsvp-analyzer -n 100 --no-pager"
  exit 1
fi

echo "All Pi runtime checks passed."
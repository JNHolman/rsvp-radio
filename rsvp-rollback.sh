#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/pi/rsvp-radio"
SNAPDIR="${ROOT}/_snapshots"

SNAP="${1:-${SNAPDIR}/latest}"

if [ ! -d "${SNAP}/app" ]; then
  echo "ERROR: snapshot not found or invalid: ${SNAP}"
  exit 1
fi

echo "ROLLING_BACK_FROM ${SNAP}"

# Stop services first (ignore failures)
sudo systemctl stop rsvp-radio 2>/dev/null || true
sudo systemctl stop rsvp-lights 2>/dev/null || true

# Restore app (preserve snapshot, exclude node_modules)
rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude '_snapshots/' \
  "${SNAP}/app/" "${ROOT}/"

# Restore systemd units (if snapshot has them)
if [ -d "${SNAP}/systemd" ]; then
  for f in "${SNAP}/systemd/"*.service; do
    [ -f "$f" ] && sudo cp -a "$f" /etc/systemd/system/
  done
fi

# Restore lights state (if snapshot has it)
if [ -f "${SNAP}/state/.rsvp_lights_state.json" ]; then
  cp -a "${SNAP}/state/.rsvp_lights_state.json" /home/pi/.rsvp_lights_state.json
fi

sudo systemctl daemon-reload
sudo systemctl start rsvp-lights 2>/dev/null || true
sudo systemctl start rsvp-radio 2>/dev/null || true

echo "ROLLBACK_OK"

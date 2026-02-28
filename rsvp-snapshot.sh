#!/usr/bin/env bash
set -euo pipefail

ROOT="/home/pi/rsvp-radio"
SNAPDIR="${ROOT}/_snapshots"
TS="$(date +%Y%m%d-%H%M%S)"
OUT="${SNAPDIR}/${TS}"

mkdir -p "${OUT}"

# 1) App folder (exclude heavy/volatile)
rsync -a --delete \
  --exclude 'node_modules/' \
  --exclude '_snapshots/' \
  --exclude '.git/' \
  "${ROOT}/" "${OUT}/app/"

# 2) Systemd units (if present)
mkdir -p "${OUT}/systemd"
for f in /etc/systemd/system/rsvp-radio.service /etc/systemd/system/rsvp-lights.service; do
  [ -f "$f" ] && sudo cp -a "$f" "${OUT}/systemd/"
done

# 3) Lights persisted state (if present)
mkdir -p "${OUT}/state"
[ -f /home/pi/.rsvp_lights_state.json ] && cp -a /home/pi/.rsvp_lights_state.json "${OUT}/state/"

# 4) Quick manifest
(
  echo "timestamp=${TS}"
  echo "root=${ROOT}"
  echo "kernel=$(uname -a)"
  echo "node=$(node -v 2>/dev/null || true)"
  echo "python=$(python3 --version 2>/dev/null || true)"
) > "${OUT}/MANIFEST.txt"

# 5) Point "latest" at this snapshot
ln -sfn "${OUT}" "${SNAPDIR}/latest"

echo "SNAPSHOT_OK ${OUT}"

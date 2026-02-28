#!/bin/bash
# rsvp-radio-backup.sh
# Run from your Mac to pull a backup of rsvp-radio from the Pi.
# Videos are excluded by default (large files, stored on Pi only).
# Usage:
#   bash rsvp-radio-backup.sh           → backs up to ~/Desktop
#   bash rsvp-radio-backup.sh --videos  → includes video files too

PI="pi@rsvp-radio.local"
PI_PATH="/home/pi/rsvp-radio"
DEST="$HOME/Desktop/rsvp-radio-backup-$(date +%Y%m%d-%H%M)"
INCLUDE_VIDEOS=false

for arg in "$@"; do
  [[ "$arg" == "--videos" ]] && INCLUDE_VIDEOS=true
done

echo "→ Backing up rsvp-radio from $PI to $DEST"
mkdir -p "$DEST"

# Always exclude
EXCLUDES=(
  "--exclude=node_modules"
  "--exclude=.DS_Store"
  "--exclude=*.log"
)

# Exclude videos unless --videos flag passed
if [ "$INCLUDE_VIDEOS" = false ]; then
  EXCLUDES+=("--exclude=*.mp4")
  echo "  (videos excluded — use --videos to include them)"
fi

rsync -avz "${EXCLUDES[@]}" \
  -e ssh \
  "$PI:$PI_PATH/" \
  "$DEST/rsvp-radio/"

# Also grab the systemd service file
echo "→ Backing up systemd unit file"
ssh "$PI" "sudo cat /etc/systemd/system/rsvp-radio.service" > "$DEST/rsvp-radio.service"

echo ""
echo "✓ Backup complete: $DEST"
echo ""
echo "Contents:"
find "$DEST" -type f | sort

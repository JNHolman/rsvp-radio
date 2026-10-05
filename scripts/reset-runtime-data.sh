#!/usr/bin/env bash
set -euo pipefail
cat > data/session.json <<'JSON'
{
  "lastPlayedAt": 0,
  "seedRatingKey": null,
  "seedTitle": "",
  "seedArtist": "",
  "seedMode": null,
  "sessionCount": 0
}
JSON
printf '{}\n' > data/skip-data.json
rm -f data/runtime-state.json data/video-skip-data.json data/*.tmp-*
echo "Runtime data reset."
#!/usr/bin/env bash
set -euo pipefail

APP_DIR="${APP_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
cd "$APP_DIR"

command -v pactl >/dev/null || { echo "pactl is required for audio monitor discovery" >&2; exit 3; }
command -v parec >/dev/null || { echo "parec is required for audio capture" >&2; exit 3; }
PYTHON_BIN="$(command -v python3 || true)"
[[ -n "$PYTHON_BIN" ]] || { echo "python3 is required for the audio analyzer" >&2; exit 3; }

exec "$PYTHON_BIN" "$APP_DIR/analyzer/rsvp_audio_analyzer.py"

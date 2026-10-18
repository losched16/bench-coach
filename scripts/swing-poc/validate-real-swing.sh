#!/usr/bin/env bash
# Swing mechanics POC — real-swing validation run (private; nothing leaves this machine).
#
#   bash scripts/swing-poc/validate-real-swing.sh VIDEO --contact-ms MS --handedness R|L \
#        --view face_on (--not-slowmo | --capture-fps 240) [--foot-strike-ms MS]
#
#   Don't know the contact time yet? Make a labelled contact sheet first:
#   bash scripts/swing-poc/validate-real-swing.sh --contact-sheet VIDEO --around-ms 1500
#
# Output: analyzer/out/private/<run>/report.md (+ evidence, overlay, JSON).
# That folder is git-ignored and owner-only. Delete it after the review.
# See docs/swing-mechanics-poc/RUNBOOK.md, "Real-swing validation".

set -euo pipefail
cd "$(dirname "$0")/../.."
_py="${ANALYZER_PYTHON:-analyzer/.venv/bin/python}"
PY="$(cd "$(dirname "$_py")" && pwd)/$(basename "$_py")"
[ -x "$PY" ] || { echo "analyzer python not found at $_py — see RUNBOOK.md setup (or set ANALYZER_PYTHON)" >&2; exit 2; }
[ -f analyzer/models/pose_landmarker_full.task ] || { echo "pose model missing — run analyzer/scripts/fetch_model.sh" >&2; exit 2; }

if [ "${1:-}" = "--contact-sheet" ]; then
  shift
  video="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; shift
  cd analyzer && exec "$PY" -m swing_analyzer contact-sheet "$video" "$@"
fi
[ $# -ge 1 ] || { sed -n 2,12p "$0"; exit 2; }
video="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"; shift
cd analyzer && exec "$PY" -m swing_analyzer validate "$video" "$@"

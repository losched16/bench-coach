#!/usr/bin/env bash
# Download the adult test image the synthetic fixtures are built from
# (MediaPipe's own pose test asset) and check it is the exact file
# the tests were written against. Not a swing; not a child; not committed.
set -euo pipefail
OUT="${1:-$(dirname "$0")/../.cache/pose.jpg}"
mkdir -p "$(dirname "$OUT")"
URL="https://storage.googleapis.com/mediapipe-assets/pose.jpg"
SHA="c8a830ed683c0276d713dd5aeda28f415f10cd6291972084a40d0d8b934ed62b"
curl -fsSL -o "$OUT" "$URL"
echo "$SHA  $OUT" | sha256sum -c -

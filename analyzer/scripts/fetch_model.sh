#!/usr/bin/env bash
# Download the MediaPipe Pose Landmarker model and check it is the exact file
# this analyzer was tested with. The model is not committed (9 MB binary).
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p models
URL="https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_full/float16/latest/pose_landmarker_full.task"
SHA="4eaa5eb7a98365221087693fcc286334cf0858e2eb6e15b506aa4a7ecdcec4ad"
curl -fsSL -o models/pose_landmarker_full.task "$URL"
echo "$SHA  models/pose_landmarker_full.task" | sha256sum -c -

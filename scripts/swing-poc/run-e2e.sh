#!/usr/bin/env bash
# Swing mechanics POC — run the whole thing locally and prove it end to end.
#
#   bash scripts/swing-poc/run-e2e.sh
#
# Starts: the fixture Supabase (127.0.0.1 only), a dev server with the POC
# flag on and a throwaway private data dir, and the Python worker. Then drives
# Chromium through upload → contact → analyse → overlay → review → drills, and
# a second coach trying to read the capture. Nothing touches production.
#
# Needs: analyzer set up (see docs/swing-mechanics-poc/RUNBOOK.md) and the
# fixtures built. ANALYZER_PYTHON points at its virtualenv's python.

set -euo pipefail
cd "$(dirname "$0")/../.."

# Absolute, but NOT symlink-resolved: a venv's python is a symlink to the
# system interpreter, and resolving it would lose the venv's packages.
_py="${ANALYZER_PYTHON:-analyzer/.venv/bin/python}"
PY="$(cd "$(dirname "$_py")" && pwd)/$(basename "$_py")"
PORT="${APP_PORT:-3100}"
FIXTURE_PORT="${FIXTURE_PORT:-54321}"
DATA="$(mktemp -d)"
OUT="${OUT:-analyzer/out/e2e}"
export FIXTURE_PORT OUT

if [ -z "${CHROMIUM_PATH:-}" ]; then
  CHROMIUM_PATH="$(find /opt/pw-browsers -maxdepth 3 -path '*chrome-linux/chrome' -type f 2>/dev/null | head -1 || true)"
fi
export CHROMIUM_PATH

pids=()
cleanup() { for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; [ -n "${KEEP_DATA:-}" ] && echo "data kept in $DATA" || rm -rf "$DATA"; }
trap cleanup EXIT

node scripts/browser/fixture-supabase.mjs > "$OUT.fixture.log" 2>&1 & pids+=($!)

SWING_MECHANICS_POC=1 \
SWING_POC_DATA_DIR="$DATA" \
SWING_POC_SIGNING_SECRET="$(head -c 48 /dev/urandom | base64)" \
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${FIXTURE_PORT}" \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
SUPABASE_SERVICE_ROLE_KEY=fixture-service-key \
  npx next dev -p "$PORT" > "$OUT.next.log" 2>&1 & pids+=($!)

(cd analyzer && "$PY" -m swing_analyzer worker --data-dir "$DATA") > "$OUT.worker.log" 2>&1 & pids+=($!)

for _ in $(seq 1 90); do
  curl -s -o /dev/null --max-time 60 "http://127.0.0.1:${PORT}/auth/login" && break
  sleep 2
done

APP_URL="http://127.0.0.1:${PORT}" FIXTURE_URL="http://127.0.0.1:${FIXTURE_PORT}" \
  npx --yes tsx scripts/swing-poc/e2e.ts

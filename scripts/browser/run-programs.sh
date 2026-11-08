#!/usr/bin/env bash
# Browser validation for the Development Program screens.
#
#   npm run test:programs-browser
#
# Real Chromium + real Next.js + the real pages and components. The backend is
# NOT real: Supabase is the in-memory fixture, and /api/development-program/*
# is a mock that serves a draft produced by the REAL generator (so the data is
# realistic) but implements the routes' contract in a few dozen lines. So this
# proves the screens and the client-side workflow; the routes' authorisation,
# the SQL functions and the generator are covered by verify:authz,
# test:migration-085 and test:programs respectively.
set -euo pipefail
cd "$(dirname "$0")/../.."
PORT="${APP_PORT:-3101}"; FIXTURE_PORT="${FIXTURE_PORT:-54322}"; export FIXTURE_PORT
if [ -z "${CHROMIUM_PATH:-}" ]; then
  CHROMIUM_PATH="$(find /opt/pw-browsers -maxdepth 3 -path '*chrome-linux/chrome' -type f 2>/dev/null | head -1 || true)"
fi
export CHROMIUM_PATH
pids=(); cleanup(){ for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done; }; trap cleanup EXIT

W="$(mktemp -d)"
npx --yes tsx --tsconfig tsconfig.json scripts/emit-program-fixture.ts "$W/payload.json" "$W/draft.json"
export PROGRAM_DRAFT_JSON="$W/draft.json" PROGRAM_PAYLOAD_JSON="$W/payload.json"

node scripts/browser/fixture-supabase.mjs >/tmp/bc-fixture-programs.log 2>&1 & pids+=($!)
NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${FIXTURE_PORT}" NEXT_PUBLIC_SUPABASE_ANON_KEY="fixture-anon-key" \
SUPABASE_SERVICE_ROLE_KEY="fixture-service-key" ADMIN_EMAIL="coach@example.test" NEXT_PUBLIC_DEVELOPMENT_PROGRAMS=on \
npx next dev -p "$PORT" >/tmp/bc-dev-programs.log 2>&1 & pids+=($!)
for i in $(seq 1 60); do curl -sf -o /dev/null "http://127.0.0.1:${PORT}/auth/login" && break; sleep 2; done
curl -sf -o /dev/null "http://127.0.0.1:${PORT}/auth/login" || { echo "dev server never came up"; tail -20 /tmp/bc-dev-programs.log; exit 1; }
APP_URL="http://127.0.0.1:${PORT}" FIXTURE_URL="http://127.0.0.1:${FIXTURE_PORT}" node scripts/browser/programs.spec.mjs

#!/usr/bin/env bash
# Speed, Agility & Explosiveness program: browser end-to-end.
#
#   npm run test:speed-program-e2e
#
# Starts the fixture Supabase and a dev server with SPEED_PROGRAM=1, all on
# 127.0.0.1, then drives Chromium through the real login page. Nothing touches
# production. Screenshots go to .speed-program-e2e/ (git-ignored).
set -euo pipefail
cd "$(dirname "$0")/../.."

# MODE=on (default) runs the full flow with SPEED_PROGRAM=1.
# MODE=off runs the flag-off smoke: SPEED_PROGRAM is set to "true" (anything but
# exactly "1" must leave the feature off) and every surface must not exist.
MODE="${MODE:-on}"
PORT="${APP_PORT:-3300}"
FIXTURE_PORT="${FIXTURE_PORT:-54323}"
export FIXTURE_PORT

if [ -z "${CHROMIUM_PATH:-}" ]; then
  CHROMIUM_PATH="$(find /opt/pw-browsers -maxdepth 3 -path '*chrome-linux/chrome' -type f 2>/dev/null | head -1 || true)"
fi
export CHROMIUM_PATH

for p in "$PORT" "$FIXTURE_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "port $p is already in use; stop the old run first" >&2; exit 2; fi
done

mkdir -p .speed-program-e2e
pids=()
cleanup() { for p in "${pids[@]:-}"; do [ -n "$p" ] && kill -- "-$p" 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'exit 130' INT TERM

setsid node scripts/browser/fixture-supabase.mjs > .speed-program-e2e/fixture.log 2>&1 & pids+=($!)

NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${FIXTURE_PORT}" \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
SUPABASE_SERVICE_ROLE_KEY=fixture-service-key \
NEXT_PUBLIC_APP_URL="http://127.0.0.1:${PORT}" \
SPEED_PROGRAM="$([ "$MODE" = on ] && echo 1 || echo true)" \
  setsid npx next dev -p "$PORT" > .speed-program-e2e/next.log 2>&1 & pids+=($!)

for _ in $(seq 1 90); do
  curl -s -o /dev/null --max-time 60 "http://127.0.0.1:${PORT}/auth/login" && break
  sleep 2
done
for u in /api/speed-program "/dashboard/roster/x/speed-program"; do curl -s -o /dev/null --max-time 120 "http://127.0.0.1:${PORT}$u" || true; done

SCRIPT=scripts/speed-program/e2e.ts
[ "$MODE" = off ] && SCRIPT=scripts/speed-program/smoke-off.ts
APP_URL="http://127.0.0.1:${PORT}" FIXTURE_URL="http://127.0.0.1:${FIXTURE_PORT}" OUT=.speed-program-e2e \
  npx --yes tsx --tsconfig tsconfig.json "$SCRIPT"

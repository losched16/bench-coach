#!/usr/bin/env bash
# Browser validation for the help and onboarding surfaces.
#
#   npm run test:browser
#
# Brings up a fixture Supabase and a dev server pointed at it, drives real
# Chromium against them, and tears both down. Nothing here touches production:
# the only Supabase URL involved is 127.0.0.1, and the anon key is the string
# "fixture-anon-key".
#
# This machine's Chromium does not match the revision the installed playwright
# package expects and there is no network to fetch the matching one, so the
# path is passed explicitly. Override CHROMIUM_PATH elsewhere.

set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${APP_PORT:-3100}"
FIXTURE_PORT="${FIXTURE_PORT:-54321}"
export FIXTURE_PORT

# Chromium. Three cases, in order:
#
#   1. CHROMIUM_PATH is set and real — use it.
#   2. This sandbox's preinstalled build, whose revision does not match the
#      playwright package's expectation, so it has to be named explicitly.
#   3. Neither — leave CHROMIUM_PATH empty and let Playwright resolve its own
#      browser. That is the CI case, after `npx playwright install chromium`,
#      and passing a guessed path there would break a working install.
if [ -z "${CHROMIUM_PATH:-}" ]; then
  CHROMIUM_PATH="$(find /opt/pw-browsers -maxdepth 3 \
    -path '*chrome-linux/chrome' -type f 2>/dev/null | head -1 || true)"
fi
if [ -n "${CHROMIUM_PATH:-}" ] && [ ! -x "$CHROMIUM_PATH" ]; then
  echo "CHROMIUM_PATH is set but not executable: $CHROMIUM_PATH"
  exit 1
fi
export CHROMIUM_PATH
echo "chromium: ${CHROMIUM_PATH:-<playwright default>}"

pids=()
cleanup() {
  for p in "${pids[@]:-}"; do kill "$p" 2>/dev/null || true; done
}
trap cleanup EXIT

# A leftover dev server on this port serves a stale build and answers 404 for
# every chunk, which looks exactly like the app being broken. Refuse to start
# on top of one rather than debugging a ghost.
for port in "$PORT" "$FIXTURE_PORT"; do
  if curl -sf -o /dev/null --max-time 2 "http://127.0.0.1:${port}/" 2>/dev/null \
     || curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${port}/" 2>/dev/null; then
    if (exec 3<>"/dev/tcp/127.0.0.1/${port}") 2>/dev/null; then
      exec 3<&- 3>&-
      echo "Something is already listening on ${port}. Stop it first:"
      echo "  fuser -k ${port}/tcp    # or: pkill -f 'next dev'"
      exit 1
    fi
  fi
done

node scripts/browser/fixture-supabase.mjs >/tmp/bc-fixture.log 2>&1 &
pids+=($!)

NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${FIXTURE_PORT}" \
NEXT_PUBLIC_SUPABASE_ANON_KEY="fixture-anon-key" \
SUPABASE_SERVICE_ROLE_KEY="fixture-service-key" \
ADMIN_EMAIL="coach@example.test" \
npx next dev -p "$PORT" >/tmp/bc-dev.log 2>&1 &
pids+=($!)

echo "waiting for the dev server on :${PORT}..."
for i in $(seq 1 60); do
  if curl -sf -o /dev/null "http://127.0.0.1:${PORT}/auth/login"; then break; fi
  sleep 2
done
curl -sf -o /dev/null "http://127.0.0.1:${PORT}/auth/login" || {
  echo "the dev server never came up; see /tmp/bc-dev.log"; tail -20 /tmp/bc-dev.log; exit 1
}

APP_URL="http://127.0.0.1:${PORT}" \
FIXTURE_URL="http://127.0.0.1:${FIXTURE_PORT}" \
node scripts/browser/help.spec.mjs

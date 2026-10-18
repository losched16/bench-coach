#!/usr/bin/env bash
# BenchCoach Academy — browser end-to-end.
#
#   npm run test:academy-e2e
#   ACADEMY_MANUSCRIPT=/private/course.md npm run test:academy-e2e   # real course text
#
# Starts the fixture Supabase, a fake Stripe and a dev server, all on
# 127.0.0.1, then drives Chromium. Nothing touches production or Stripe.
# Screenshots and results go to .academy-content/e2e/ (git-ignored: with the
# real manuscript they show paid course text).
set -euo pipefail
cd "$(dirname "$0")/../.."

PORT="${APP_PORT:-3200}"
FIXTURE_PORT="${FIXTURE_PORT:-54322}"
STRIPE_PORT="${FAKE_STRIPE_PORT:-12111}"
export FIXTURE_PORT FAKE_STRIPE_PORT="$STRIPE_PORT"
WEBHOOK_SECRET="whsec_test_$(head -c 12 /dev/urandom | od -An -tx1 | tr -d ' \n')"

if [ -z "${CHROMIUM_PATH:-}" ]; then
  CHROMIUM_PATH="$(find /opt/pw-browsers -maxdepth 3 -path '*chrome-linux/chrome' -type f 2>/dev/null | head -1 || true)"
fi
export CHROMIUM_PATH

for p in "$PORT" "$FIXTURE_PORT" "$STRIPE_PORT"; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$p") 2>/dev/null; then echo "port $p is already in use — stop the old run first" >&2; exit 2; fi
done

mkdir -p .academy-content/e2e
pids=()
cleanup() { for p in "${pids[@]:-}"; do [ -n "$p" ] && kill -- "-$p" 2>/dev/null || true; done; }
trap cleanup EXIT
trap 'exit 130' INT TERM

setsid node scripts/browser/fixture-supabase.mjs > .academy-content/e2e/fixture.log 2>&1 & pids+=($!)
APP_URL="http://127.0.0.1:${PORT}" STRIPE_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
  setsid node scripts/academy/fake-stripe.mjs > .academy-content/e2e/stripe.log 2>&1 & pids+=($!)

NEXT_PUBLIC_SUPABASE_URL="http://127.0.0.1:${FIXTURE_PORT}" \
NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key \
SUPABASE_SERVICE_ROLE_KEY=fixture-service-key \
NEXT_PUBLIC_APP_URL="http://127.0.0.1:${PORT}" \
STRIPE_SECRET_KEY=sk_test_fixture \
STRIPE_WEBHOOK_SECRET="$WEBHOOK_SECRET" \
STRIPE_API_BASE="http://127.0.0.1:${STRIPE_PORT}" \
ADMIN_EMAIL=owner@example.test \
  setsid npx next dev -p "$PORT" > .academy-content/e2e/next.log 2>&1 & pids+=($!)

for _ in $(seq 1 90); do
  curl -s -o /dev/null --max-time 60 "http://127.0.0.1:${PORT}/auth/login" && break
  sleep 2
done
# Compile the Academy routes once before timing anything.
for u in /academy /academy/build-a-better-baseball-swing /learn /api/academy/track; do curl -s -o /dev/null --max-time 120 "http://127.0.0.1:${PORT}$u" || true; done

APP_URL="http://127.0.0.1:${PORT}" FIXTURE_URL="http://127.0.0.1:${FIXTURE_PORT}" FAKE_STRIPE_URL="http://127.0.0.1:${STRIPE_PORT}" \
  OUT=.academy-content/e2e npx --yes tsx --tsconfig tsconfig.json scripts/academy/e2e.ts

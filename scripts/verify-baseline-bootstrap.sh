#!/usr/bin/env bash
# Can this repository build a working BenchCoach database, and how far short
# does it fall?
#
#   npm run verify:bootstrap
#
# WHAT IT DOES
#
# Stands up a THROWAWAY PostgreSQL cluster in a temp directory, on a unix
# socket with listen_addresses empty — no network, no real database, torn down
# on exit whether it passes or fails. Then runs the repository's bootstrap
# sequence against it, dumps the result, and compares that against the surface
# recorded from production in docs/schema/expected-surface.json.
#
# The output is the manifest for migrations/000_baseline.sql: every object
# production has that the repository cannot create.
#
# It also runs the security assertions that only a real database can answer:
# which roles can execute which functions, which tables have RLS on, and which
# SECURITY DEFINER functions pin their search_path.
#
# WHY A LOCAL CLUSTER AND NOT STAGING
#
# Because this has to be runnable before a staging project exists, and because
# a bootstrap test that needs a database to already be correct is not a test.

set -euo pipefail

PGBIN=/usr/lib/postgresql/16/bin
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK=$(mktemp -d /tmp/bc-bootstrap-XXXXXX)
PORT=${PGPORT_TEST:-55437}
SOCK="$WORK/sock"
OUT="${BASELINE_OUT:-$WORK/reconstructed.sql}"

if [ ! -x "$PGBIN/initdb" ]; then
  echo "SKIP: no local PostgreSQL 16 at $PGBIN — this check needs a server." >&2
  exit 0
fi

RUNAS=""
if [ "$(id -u)" = "0" ]; then
  for c in ubuntu postgres; do if id "$c" >/dev/null 2>&1; then RUNAS="$c"; break; fi; done
  [ -n "$RUNAS" ] || { echo "SKIP: running as root with no unprivileged user." >&2; exit 0; }
  chown -R "$RUNAS" "$WORK"
fi
run() { if [ -n "$RUNAS" ]; then su "$RUNAS" -c "$1"; else bash -c "$1"; fi; }
cleanup() {
  run "$PGBIN/pg_ctl -D $WORK/data stop -m immediate" >/dev/null 2>&1 || true
  [ -n "${BASELINE_OUT:-}" ] && [ -f "$OUT" ] && cp "$OUT" "$OUT.kept" 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

mkdir -p "$SOCK"
[ -n "$RUNAS" ] && chown -R "$RUNAS" "$WORK"
run "$PGBIN/initdb -D $WORK/data -U postgres --auth=trust" > "$WORK/initdb.log" 2>&1
run "$PGBIN/pg_ctl -D $WORK/data -o '-p $PORT -k $SOCK -c listen_addresses=' -l $WORK/pg.log start" >/dev/null 2>&1
sleep 2

PSQL="$PGBIN/psql -h $SOCK -p $PORT -U postgres -v ON_ERROR_STOP=1 -q"
Q() { $PGBIN/psql -h "$SOCK" -p "$PORT" -U postgres -tAc "$1"; }
pass() { echo "  PASS  $1"; }
warn() { echo "  ----  $1"; }
fail() { echo ""; echo "FAILED: $1"; exit 1; }

echo ""
echo "bootstrap a BenchCoach database from this repository alone"
echo ""

# ---------------------------------------------------------------------------
# 1. The Supabase stand-in: the roles, schema and helpers a real project has
#    before any BenchCoach SQL runs.
# ---------------------------------------------------------------------------
cat > "$WORK/00_supabase.sql" <<'SQL'
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN CREATE ROLE anon NOLOGIN;          EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE authenticated NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE service_role NOLOGIN;  EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE IF NOT EXISTS auth.users (
  id    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email TEXT
);
-- Supabase resolves this from the request JWT. Here it reads a GUC so a test
-- can say who it is.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::UUID;
$$ LANGUAGE sql STABLE;

-- Supabase grants these by default on everything created in public afterwards.
-- Reproduced so the bootstrap sees the same starting privileges production had.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL
$PSQL -f "$WORK/00_supabase.sql" > "$WORK/supabase.log" 2>&1 || fail "Supabase stand-in did not apply"
pass "Supabase stand-in: roles, auth schema, auth.uid(), default privileges"

# ---------------------------------------------------------------------------
# 2. The repository's own bootstrap, in order.
# ---------------------------------------------------------------------------
if [ -f "$ROOT/migrations/000_baseline.sql" ]; then
  $PSQL -f "$ROOT/migrations/000_baseline.sql" > "$WORK/000.log" 2>&1 \
    || { tail -20 "$WORK/000.log"; fail "000_baseline.sql did not apply"; }
  pass "000_baseline.sql applied"
  HAVE_BASELINE=1
else
  warn "migrations/000_baseline.sql does not exist — using supabase-schema.sql, which is partial"
  HAVE_BASELINE=0
  $PSQL -f "$ROOT/supabase-schema.sql" > "$WORK/schema.log" 2>&1 \
    || { tail -20 "$WORK/schema.log"; fail "supabase-schema.sql did not apply"; }
  pass "supabase-schema.sql applied (14 tables)"
fi

# ---------------------------------------------------------------------------
# 3. The numbered migrations, in order, each one reported.
# ---------------------------------------------------------------------------
echo ""
echo "  migrations"
APPLIED=0; FAILED=0; FAILED_LIST=""
for f in $(ls "$ROOT"/migrations/[0-9][0-9][0-9]_*.sql | sort); do
  name=$(basename "$f")
  [ "$name" = "000_baseline.sql" ] && continue
  # 050_VERIFY.sql is a test harness for 050, not a migration. It sorts before
  # the migration it verifies, so running it here fails for the wrong reason.
  case "$name" in *_VERIFY.sql) continue;; esac
  if $PSQL -f "$f" > "$WORK/$name.log" 2>&1; then
    APPLIED=$((APPLIED + 1))
    echo "    ok    $name"
  else
    FAILED=$((FAILED + 1)); FAILED_LIST="$FAILED_LIST $name"
    reason=$(grep -m1 -oE 'ERROR:.*' "$WORK/$name.log" | head -c 120)
    echo "    FAIL  $name    ${reason:-see log}"
  fi
done
echo ""
echo "  $APPLIED applied, $FAILED failed"

# ---------------------------------------------------------------------------
# 4. What did we end up with, and what does production have that this does not?
# ---------------------------------------------------------------------------
echo ""
echo "  coverage against production (docs/schema/expected-surface.json)"
Q "SELECT tablename FROM pg_tables WHERE schemaname='public'
   UNION SELECT viewname FROM pg_views WHERE schemaname='public'
   ORDER BY 1" > "$WORK/built.txt"

node -e "
const fs=require('fs');
const want=JSON.parse(fs.readFileSync('$ROOT/docs/schema/expected-surface.json','utf8'));
const got=new Set(fs.readFileSync('$WORK/built.txt','utf8').split('\n').map(s=>s.trim()).filter(Boolean));
const prod=Object.keys(want.tables);
const missing=prod.filter(t=>!got.has(t));
const bwc=missing.filter(t=>t.startsWith('bwc_'));
const ours=missing.filter(t=>!t.startsWith('bwc_'));
const extra=[...got].filter(t=>!want.tables[t]);
console.log('    built:            '+got.size);
console.log('    production has:   '+prod.length);
console.log('');
// Two different questions. \"No file creates this\" is what the baseline must
// contain. \"A migration would have created it but could not run\" is a
// consequence of the first, and will fix itself once the baseline exists.
const fs2=require('fs');
const src=(f)=>{const x=fs2.readFileSync(f,'utf8');const o=new Set();
  for (const m of x.matchAll(/CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(?:public\\.)?\"?([a-z_][a-z0-9_]*)\"?/gi)) o.add(m[1].toLowerCase());
  return o;};
const creatable=new Set([...src('$ROOT/supabase-schema.sql')]);
for (const f of fs2.readdirSync('$ROOT/migrations').filter(f=>/^[0-9]{3}_/.test(f)&&f.endsWith('.sql')&&!/_VERIFY/.test(f)))
  for (const t of src('$ROOT/migrations/'+f)) creatable.add(t);
const noSource=ours.filter(t=>!creatable.has(t));
const cascade=ours.filter(t=>creatable.has(t));
console.log('    NO FILE CREATES THESE ('+noSource.length+') — the required contents of 000_baseline.sql:');
for (const t of noSource) console.log('      '+t);
console.log('');
console.log('    a migration would create these, but could not run ('+cascade.length+'):');
console.log('      '+cascade.join(', '));
console.log('      These resolve themselves once the baseline exists.');
console.log('');
console.log('    MISSING, bwc_* ('+bwc.length+') — a different application, deliberately excluded');
if (extra.length) { console.log(''); console.log('    built but not in production ('+extra.length+'): '+extra.join(', ')); }
fs.writeFileSync('$WORK/missing.json', JSON.stringify({noSource,cascade,bwc,extra},null,2));
"

# ---------------------------------------------------------------------------
# 5. Security assertions a real database can answer and a file cannot.
# ---------------------------------------------------------------------------
echo ""
echo "  security"

RLS_ON=$(Q "SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
            WHERE t.schemaname='public' AND c.relrowsecurity")
RLS_OFF=$(Q "SELECT count(*) FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
             WHERE t.schemaname='public' AND NOT c.relrowsecurity")
echo "    RLS enabled on $RLS_ON table(s), off on $RLS_OFF"
if [ "$RLS_OFF" != "0" ]; then
  echo "    without RLS:"
  Q "SELECT '      '||t.tablename FROM pg_tables t JOIN pg_class c ON c.relname=t.tablename
     WHERE t.schemaname='public' AND NOT c.relrowsecurity ORDER BY 1"
fi

POLICIES=$(Q "SELECT count(*) FROM pg_policies WHERE schemaname='public'")
echo "    $POLICIES policies"

UNCONDITIONAL=$(Q "SELECT count(*) FROM pg_policies
                   WHERE schemaname='public' AND coalesce(qual,'') IN ('true','(true)')")
if [ "$UNCONDITIONAL" != "0" ]; then
  echo "    $UNCONDITIONAL policy/policies with USING (true):"
  Q "SELECT '      '||tablename||'.'||policyname||'  '||cmd||'  to '||array_to_string(roles,',')
     FROM pg_policies WHERE schemaname='public' AND coalesce(qual,'') IN ('true','(true)') ORDER BY 1"
fi

# SECURITY DEFINER functions and their search_path.
echo ""
UNPINNED=$(Q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.prosecdef
                AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')")
TOTAL_SD=$(Q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.prosecdef")
echo "    $TOTAL_SD SECURITY DEFINER function(s); $UNPINNED do not pin search_path"
if [ "$UNPINNED" != "0" ]; then
  Q "SELECT '      '||p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public' AND p.prosecdef
       AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig,'{}')) c WHERE c LIKE 'search_path=%')
     ORDER BY 1"
fi

# Which SECURITY DEFINER functions can the browser roles execute? A mutating
# one reachable by `authenticated` is a hole straight through every policy.
echo ""
echo "    SECURITY DEFINER functions executable by anon or authenticated:"
Q "SELECT '      '||p.proname||'  ('||
          CASE WHEN has_function_privilege('anon', p.oid, 'EXECUTE') THEN 'anon ' ELSE '' END||
          CASE WHEN has_function_privilege('authenticated', p.oid, 'EXECUTE') THEN 'authenticated' ELSE '' END||')'
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.prosecdef
     AND (has_function_privilege('anon', p.oid,'EXECUTE') OR has_function_privilege('authenticated', p.oid,'EXECUTE'))
   ORDER BY 1"

# The two League mutations must NOT be in that list.
for fn in bc_claim_league_seat bc_release_league_seat bc_provision_league; do
  EXISTS=$(Q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
              WHERE n.nspname='public' AND p.proname='$fn'")
  if [ "$EXISTS" = "0" ]; then warn "$fn not present"; continue; fi
  BAD=$(Q "SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
           WHERE n.nspname='public' AND p.proname='$fn'
             AND (has_function_privilege('anon', p.oid,'EXECUTE')
               OR has_function_privilege('authenticated', p.oid,'EXECUTE'))")
  [ "$BAD" = "0" ] || fail "$fn is EXECUTE-able by a browser role — it can mutate past every policy"
  pass "$fn is revoked from anon and authenticated"
done

# ---------------------------------------------------------------------------
# 6. Dump what we built and read it back, exactly as the real capture will.
# ---------------------------------------------------------------------------
echo ""
echo "  dump and inspect"
run "$PGBIN/pg_dump -h $SOCK -p $PORT -U postgres --schema-only --no-owner --schema=public postgres" > "$OUT" 2>"$WORK/dump.log" \
  || { tail -5 "$WORK/dump.log"; fail "pg_dump of the reconstructed database failed"; }
echo "    wrote $(wc -c < "$OUT") bytes"
node "$ROOT/scripts/inspect-baseline.mjs" "$OUT" || fail "the reconstructed dump did not pass the secret scan"

echo ""
if [ "$FAILED" != "0" ]; then
  echo "  $FAILED migration(s) could not apply:$FAILED_LIST"
fi
if [ "$HAVE_BASELINE" = "0" ]; then
  echo "  No 000_baseline.sql yet. The MISSING list above is its required contents."
fi
echo ""
